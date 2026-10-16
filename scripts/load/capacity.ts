// Ensayo de capacidad con participación simultánea. 50 participantes y una administradora conectados a un servidor REAL (proceso aparte,
// SQLite real), todos explorando a la vez. Recorre lo que SPECS 11.2 pide medir: entrada, apertura de la ronda, el registro de las
// posiciones de la linterna de todas las personas, las pruebas de rampa simultáneas con sus muestras de reloj, el contador de personas
// listas, las transiciones de ronda, entradas tardías, desconexiones y reconexiones; y comprueba que cada persona recibe SOLO su estado.
// Usa relojes reales: tarda ~1 minuto.
//
//   npm run test:load                 → informe en la consola
//   LOAD_REPORT=1 npm run test:load   → además escribe docs/evidencia/fase7/capacidad.{json,md}
//   LOAD_PARTICIPANTS=30 npm run test:load                        → con 30 participantes (por defecto, 50)
//   LOAD_URL=https://… LOAD_PARTICIPANTS=30 npm run test:load     → contra un servidor ya publicado (no arranca uno propio; crea una
//                                                                   sala de prueba y la cierra al terminar). Sin CPU ni memoria del
//                                                                   servidor: esas solo se miden en local.
//
// Qué NO mide: celulares reales, red inalámbrica ni FPS. Los clientes y el servidor comparten computadora y red de bucle local (ver el
// informe). Sirve para el comportamiento del protocolo y del servidor con 51 conexiones; los celulares reales se ensayan aparte (P7-06).
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join, resolve } from "node:path";
import type { LaboratorioConfig } from "../../shared/contracts/config";
import { PARTICIPANT_COLOR_IDS } from "../../shared/contracts/limits";
import type { RampsState, ShadowsState } from "../../shared/contracts/state";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";
import { LoadClient, now, stats, type Stats } from "./client";

const TOTAL = Number(process.env.LOAD_PARTICIPANTS ?? 50);
if (!Number.isInteger(TOTAL) || TOTAL < 10 || TOTAL > 100) throw new Error("LOAD_PARTICIPANTS debe ser un entero entre 10 y 100");
/** Entradas tardías: ~12 % (6 de 50, 4 de 30). */
const LATE = Math.max(1, Math.round(TOTAL * 0.12));
/** Servidor publicado (Render, Docker…) en lugar de uno local. */
const REMOTE = process.env.LOAD_URL?.replace(/\/$/, "") ?? null;
const INITIAL = TOTAL - LATE;
// Metas de SPECS 11.2 que esta prueba puede comprobar (en bucle local).
const GOALS = { entryMs: 5000, transitionMs: 1000, reflectMs: 250, counterMs: 1000, clockGapP95Ms: 700 };

const dir = mkdtempSync(join(os.tmpdir(), "laboratorio-capacidad-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
const check = (cond: unknown, m: string) => {
  if (cond) console.log(`  ✔ ${m}`);
  else {
    failures.push(m);
    console.log(`  ✖ ${m}`);
  }
};
const fmt = (s: Stats) => `n=${s.n} · mín ${s.min.toFixed(1)} · p50 ${s.p50.toFixed(1)} · p95 ${s.p95.toFixed(1)} · p99 ${s.p99.toFixed(1)} · máx ${s.max.toFixed(1)} ms`;
const until = async (cond: () => boolean, what: string, ms = 10_000) => {
  const start = now();
  while (!cond()) {
    if (now() - start > ms) throw new Error(`Tiempo agotado: ${what}`);
    await sleep(1);
  }
  return now() - start;
};

const serverErrors: string[] = [];
const cpuSamples: number[] = [];
const rssSamples: number[] = [];
let server: ChildProcess | null = null;
let sampler: ReturnType<typeof setInterval> | undefined;
let BASE: string;
if (REMOTE) {
  BASE = REMOTE;
  const t0 = now();
  const health = await fetch(`${BASE}/api/health`).catch((e: unknown) => ({ ok: false, status: String(e) }) as const);
  if (!health.ok) throw new Error(`el servidor remoto no responde en /api/health (${health.status})`);
  console.log(`Servidor remoto: ${BASE} (salud en ${(now() - t0).toFixed(0)} ms)`);
} else {
  const port = await new Promise<number>((resolvePort) => {
    const sock = net.createServer();
    sock.listen(0, "127.0.0.1", () => {
      const p = (sock.address() as net.AddressInfo).port;
      sock.close(() => resolvePort(p));
    });
  });
  BASE = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_PATH: join(dir, "capacidad.sqlite"), DIST_DIR: join(dir, "sin-dist") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server = child;
  child.stderr!.on("data", (d: Buffer) => serverErrors.push(String(d).trim()));
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("el servidor no arrancó")), 20_000);
    child.stdout!.on("data", (d: Buffer) => String(d).includes("Servidor escuchando") && (clearTimeout(t), res()));
    child.once("exit", () => rej(new Error("el servidor terminó antes de escuchar")));
  });

  // ---- muestreo del proceso del servidor (CPU y memoria) ----
  sampler = setInterval(() => {
    execFile("ps", ["-o", "%cpu=,rss=", "-p", String(child.pid)], (err, out) => {
      if (err) return;
      const [cpu, rss] = out.trim().split(/\s+/).map(Number);
      if (Number.isFinite(cpu)) cpuSamples.push(cpu!);
      if (Number.isFinite(rss)) rssSamples.push(rss! / 1024);
    });
  }, 500);
}

const clients: LoadClient[] = [];
const post = async <T>(path: string, body: unknown): Promise<{ status: number; body: T }> => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as T };
};
interface Person {
  id: string;
  name: string;
  token: string;
  client: LoadClient;
  index: number;
}

try {
  const created = await post<{ code: string; adminToken: string; adminId: string }>("/api/rooms", { contentSetId: "laboratorio-cosas-cotidianas" });
  const code = created.body.code;
  const admin = new LoadClient(BASE, created.body.adminToken, "Vanessa");
  clients.push(admin);
  await admin.ready();

  const people: Person[] = [];
  const entryMs: number[] = [];
  const joinOne = async (i: number): Promise<Person> => {
    const t0 = now();
    const name = `Persona ${String(i + 1).padStart(2, "0")}`;
    const j = await post<{ principalId: string; token: string }>(`/api/rooms/${code}/join`, { name, color: PARTICIPANT_COLOR_IDS[i % PARTICIPANT_COLOR_IDS.length] });
    if (j.status !== 201) throw new Error(`entrada ${name}: HTTP ${j.status} ${JSON.stringify(j.body)}`);
    const client = new LoadClient(BASE, j.body.token, name);
    clients.push(client);
    await client.ready();
    entryMs.push(now() - t0);
    return { id: j.body.principalId, name, token: j.body.token, client, index: i };
  };
  const joinMany = async (from: number, count: number) => {
    // Llegan en oleadas, como al escanear un QR proyectado: 10 a la vez.
    for (let start = 0; start < count; start += 10) {
      const batch = await Promise.all(Array.from({ length: Math.min(10, count - start) }, (_, k) => joinOne(from + start + k)));
      people.push(...batch);
    }
  };
  const must = async (r: Promise<{ ok: boolean; code?: string; message?: string }>, what: string) => {
    const res = await r;
    if (!res.ok) throw new Error(`${what}: ${res.code} ${res.message}`);
  };
  /** Tiempo hasta que TODAS las pantallas conectadas cumplen la condición, contado desde `t0`. */
  const everywhere = async (what: string, pred: (c: LoadClient) => boolean, t0: number) => {
    const all = [admin, ...people.map((p) => p.client)].filter((c) => c.socket.connected);
    await until(() => all.every(pred), what, 8000);
    return now() - t0;
  };
  const inRoster = () => people.filter((p) => p.index < INITIAL);

  console.log(`\n1. Entrada: ${INITIAL} participantes + administradora`);
  await joinMany(0, INITIAL);
  await until(() => admin.presence?.connectedCount === INITIAL, "presencia completa en la administradora");
  const entryStats = stats(entryMs);
  console.log(`  ℹ entrada (unirse + conectar + recibir su resumen): ${fmt(entryStats)}`);
  check(entryStats.p95 <= GOALS.entryMs, `la entrada tarda ≤ ${GOALS.entryMs} ms en el p95 (${entryStats.p95.toFixed(0)} ms), con ${INITIAL} entradas en oleadas de 10`);
  check(people.every((p) => p.client.me !== null), "cada persona recibió su propio estado personal al entrar (y lo recibe solo ella)");

  // ---- 2. abrir la ronda: todas exploran a la vez ----
  console.log(`\n2. Sombras: ${INITIAL} personas exploran a la vez`);
  await must(admin.admin({ type: "room.start" }), "room.start");
  await until(() => people.every((p) => p.client.summary?.phase === "running"), "sala en curso");
  const transitions: number[] = [];
  const t0Open = now();
  await must(admin.admin({ type: "round.open" }), "round.open");
  transitions.push(await everywhere("la ronda abierta en todas las pantallas", (c) => c.group?.adventure.round.stage === "exploration", t0Open));
  check(admin.presence?.round.total === INITIAL && admin.presence.round.ready === 0, `el contador queda en «0 de ${INITIAL}»: la lista se fija al abrir la ronda`);

  const openAck: number[] = [];
  await Promise.all(
    inRoster().map(async (p) => {
      const t = now();
      await must(p.client.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "station.open");
      openAck.push(now() - t);
    }),
  );
  console.log(`  ℹ ${INITIAL} personas abren la mesa a la vez (acuse): ${fmt(stats(openAck))}`);

  // Cada persona mueve la linterna a dos posiciones separadas, a ritmos distintos (como quien explora a su ritmo), y mientras tanto
  // llegan las entradas tardías: acompañan sin contar en la ronda.
  const sentAt = new Map<string, number>();
  const reflect: number[] = [];
  const seen = new Set<string>();
  const offs = inRoster().map((p) =>
    p.client.onMe((m, t) => {
      const st = m.participant.activities.sombras as ShadowsState | undefined;
      for (const sample of st?.samples ?? []) {
        const key = `${p.id}:${sample.distanceCm}`;
        const t0 = sentAt.get(key);
        if (t0 !== undefined && !seen.has(key)) {
          seen.add(key);
          reflect.push(t - t0);
        }
      }
    }),
  );
  const ackStats: number[] = [];
  const lastActionAt = { t: 0 };
  const exploring = Promise.all(
    inRoster().map(async (p) => {
      await sleep((p.index * 173) % 3000);
      for (const d of [20 + (p.index % 5), 45 + (p.index % 7)]) {
        const key = `${p.id}:${d}`;
        sentAt.set(key, now());
        const t = now();
        await must(p.client.act({ type: "shadows.sample", distanceCm: d }), "shadows.sample");
        ackStats.push(now() - t);
        lastActionAt.t = Math.max(lastActionAt.t, now());
        await sleep(1500 + ((p.index * 91) % 1500));
      }
    }),
  );
  await sleep(2000);
  const lateEntries = joinMany(INITIAL, LATE);
  await Promise.all([exploring, lateEntries]);
  const counterMs = await until(() => admin.presence?.round.ready === INITIAL, `el contador llega a ${INITIAL} de ${INITIAL}`, 5000);
  await sleep(300);
  for (const off of offs) off();
  const ack = stats(ackStats);
  const refl = stats(reflect);
  const lateStats = stats(entryMs.slice(INITIAL));
  console.log(`  ℹ acuse de cada posición registrada: ${fmt(ack)}`);
  console.log(`  ℹ acción → el propio teléfono (su estado personal): ${fmt(refl)}`);
  console.log(`  ℹ entradas tardías (durante la exploración): ${fmt(lateStats)}`);
  check(refl.p95 < GOALS.reflectMs, `reflejo del registro en el propio teléfono < ${GOALS.reflectMs} ms en el p95 (${refl.p95.toFixed(1)} ms; p99 ${refl.p99.toFixed(1)} ms)`);
  check(lateStats.max <= GOALS.entryMs, `las ${LATE} entradas tardías, durante la exploración, tardan ≤ ${GOALS.entryMs} ms (máx ${lateStats.max.toFixed(0)} ms)`);
  check(people.length === TOTAL, `hay ${TOTAL} participantes conectados y una administradora`);
  check(admin.presence?.round.total === INITIAL && admin.presence.participants.filter((p) => !p.inRound && !p.observer).length === LATE, `quienes llegaron tarde acompañan sin contar: el total sigue en ${INITIAL} y ${LATE} figuran fuera de la ronda`);
  check(inRoster().every((p) => (p.client.me!.participant.activities.sombras as ShadowsState).samples.length === 2), "cada persona tiene exactamente SUS dos posiciones: nada de otra persona se mezcló en su estado");
  console.log(`  ℹ el contador de Vanessa llegó a ${INITIAL} de ${INITIAL} ${counterMs.toFixed(0)} ms después de la última acción`);
  check(counterMs <= GOALS.counterMs, `el contador de personas listas llega al total en ≤ ${GOALS.counterMs} ms tras la última acción (${counterMs.toFixed(0)} ms)`);

  const t0Conv = now();
  await must(admin.admin({ type: "round.converse" }), "round.converse");
  transitions.push(await everywhere("la conversación en todas las pantallas", (c) => c.group?.adventure.round.stage === "conversation", t0Conv));
  await must(admin.admin({ type: "round.showFreire" }), "round.showFreire");
  await until(() => people.every((p) => p.client.group?.adventure.round.freireShown === true), "la frase de Freire llega a todas las pantallas", 3000);
  check(true, `lo que Vanessa proyecta en la conversación (la frase de Freire) llega a las ${TOTAL} pantallas`);
  const t0Next = now();
  await must(admin.admin({ type: "round.next" }), "round.next");
  transitions.push(await everywhere("la siguiente mesa en todas las pantallas", (c) => c.group?.adventure.round.index === 1 && c.group.adventure.round.stage === "preparation", t0Next));

  // ---- 3. rampas simultáneas ----
  console.log(`\n3. Rampas: ahora la lista incluye a las ${TOTAL} personas (las ${LATE} que llegaron tarde ya cuentan); ${TOTAL} pelotas rodando a la vez`);
  await must(admin.admin({ type: "round.open" }), "round.open");
  await everywhere("Rampas abierta", (c) => c.group?.adventure.round.stage === "exploration" && c.group.adventure.round.index === 1, now());
  await Promise.all(people.map((p) => must(p.client.act({ type: "station.open", stationId: "rampas", origin: "quickNav" }), "station.open")));
  const adminClock: number[] = [];
  const phoneClock: number[] = [];
  const offClockA = admin.onClock((_c, t) => adminClock.push(t));
  const sample = people[3]!;
  const offClockP = sample.client.onClock((_c, t) => phoneClock.push(t));
  const releaseAck: number[] = [];
  const releaseAll = (angleOf: (i: number) => number) =>
    Promise.all(
      people.map(async (p) => {
        const t = now();
        await must(p.client.act({ type: "ramps.trial.start", angleDeg: angleOf(p.index) }), "ramps.trial.start");
        releaseAck.push(now() - t);
      }),
    );
  await releaseAll((i) => 20 + 5 * (i % 3)); // las tres inclinaciones más bajas (20°, 25° y 30°)
  const trialsOf = (p: Person) => (p.client.me!.participant.activities.rampas as RampsState).trials;
  await until(() => people.every((p) => trialsOf(p).length === 1 && trialsOf(p)[0]!.state === "finished"), "las primeras pruebas terminan", 12000);
  await releaseAll((i) => 40 + 5 * (i % 2)); // 40° o 45°: la diferencia con la primera es ≥ 5°
  const tLast = now();
  await until(() => people.every((p) => trialsOf(p).length === 2 && trialsOf(p)[1]!.state === "finished"), "las segundas pruebas terminan", 12000);
  const ramps = stats(releaseAck);
  await until(() => admin.presence?.round.ready === TOTAL, `el contador de rampas llega a ${TOTAL}`, 3000);
  offClockA();
  offClockP();
  console.log(`  ℹ acuse de «soltar la pelota» (${TOTAL * 2} pruebas): ${fmt(ramps)}`);
  const gaps = adminClock.slice(1).map((t, i) => t - adminClock[i]!);
  const gapStats = stats(gaps);
  console.log(`  ℹ ${adminClock.length} muestras de reloj en la proyección; separación: ${fmt(gapStats)}; un teléfono recibió ${phoneClock.length}`);
  check(adminClock.length >= 8 && gapStats.p95 <= GOALS.clockGapP95Ms, `la proyección recibe el reloj a ~2 Hz sin huecos mientras ruedan ${TOTAL} pelotas (cada 500 ms por diseño; p95 de separación ${gapStats.p95.toFixed(0)} ms ≤ ${GOALS.clockGapP95Ms} ms; el cliente interpola entre muestras)`);
  check(people.every((p) => trialsOf(p).every((t) => t.state === "finished" && t.endedActiveMs !== undefined && Math.abs(t.endedActiveMs - t.startActiveMs - t.durationMs) < 1e-6)), `las ${TOTAL * 2} pruebas terminaron en su instante exacto de simulación, cada una en el estado de su dueña`);
  void tLast;

  // Conversar y avanzar al observatorio.
  const tConv2 = now();
  await must(admin.admin({ type: "round.converse" }), "round.converse");
  transitions.push(await everywhere("conversación de Rampas", (c) => c.group?.adventure.round.stage === "conversation" && c.group.adventure.round.index === 1, tConv2));
  const tNext2 = now();
  await must(admin.admin({ type: "round.next" }), "round.next");
  transitions.push(await everywhere("siguiente mesa", (c) => c.group?.adventure.round.index === 2, tNext2));

  // ---- 4. El observatorio, con desconexiones y reconexiones ----
  console.log("\n4. El observatorio y las desconexiones");
  const observe = async (c: LoadClient) => {
    const { moon, stars } = TELESCOPE_TARGETS;
    await must(c.act({ type: "station.open", stationId: "cajas", origin: "quickNav" }), "station.open");
    await must(c.act({ type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "telescope.aim (Luna)");
    await must(c.act({ type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "telescope.aim (estrellas)");
  };
  await must(admin.admin({ type: "round.open" }), "round.open");
  await everywhere("El observatorio abierto", (c) => c.group?.adventure.round.stage === "exploration" && c.group.adventure.round.index === 2, now());
  const droppers = people.slice(5, 8);
  for (const p of droppers) p.client.close();
  await until(() => admin.presence?.connectedCount === TOTAL - droppers.length, "la presencia refleja las caídas", 3000);
  check(admin.presence?.round.total === TOTAL, `con ${droppers.length} personas caídas el total de la ronda NO baja: sigue en ${TOTAL}`);
  await Promise.all(
    people
      .filter((p) => !droppers.includes(p))
      .map((p) => observe(p.client)),
  );
  await until(() => admin.presence?.round.ready === TOTAL - droppers.length, "el contador cuenta a quienes siguen conectadas", 3000);
  const rejoinMs: number[] = [];
  for (const p of droppers) {
    const t0 = now();
    const c = new LoadClient(BASE, p.token, `${p.name} (de vuelta)`);
    clients.push(c);
    await c.ready();
    await until(() => c.me !== null && c.group !== null, "recupera su estado", 3000);
    rejoinMs.push(now() - t0);
    p.client = c;
    check(((c.me!.participant.activities.sombras as ShadowsState).samples.length === 2) && (c.me!.participant.activities.rampas as RampsState).trials.length === 2, `${p.name} vuelve y recupera su trabajo anterior (sus 2 posiciones y sus 2 pruebas)`);
  }
  console.log(`  ℹ ${droppers.length} personas se cayeron y volvieron: ${fmt(stats(rejoinMs))}`);
  for (const p of droppers) await observe(p.client);
  await until(() => admin.presence?.round.ready === TOTAL, "todas listas tras volver", 3000);
  check(true, `al volver, las ${droppers.length} personas terminan la mesa y el contador llega a ${TOTAL} de ${TOTAL}`);

  // La administradora se cae: la sala se pausa para todas las pantallas; vuelve y reanuda.
  const tDrop = now();
  admin.close();
  const pausedMs = await until(() => people.filter((p) => p.client.socket.connected).every((p) => p.client.summary?.phase === "paused"), "todas las personas ven la pausa", 5000);
  check(pausedMs < GOALS.transitionMs, `si Vanessa se desconecta, las ${TOTAL} personas ven la pausa en ${pausedMs.toFixed(0)} ms (cierre de socket; el corte silencioso se mide en detection.test.ts)`);
  const admin2 = new LoadClient(BASE, created.body.adminToken, "Vanessa (de vuelta)");
  clients.push(admin2);
  await admin2.ready();
  await until(() => admin2.presence !== null && admin2.group !== null, "la administradora recupera presencia y estado", 3000);
  check(admin2.presence!.round.total === TOTAL && admin2.group!.adventure.round.index === 2, "al volver, Vanessa recupera la ronda con su lista y su contador intactos");
  await must(admin2.admin({ type: "room.resume" }), "room.resume");
  await until(() => people.every((p) => p.client.summary?.phase === "running"), "la sala se reanuda", 3000);
  void tDrop;

  const tConv3 = now();
  await must(admin2.admin({ type: "round.converse" }), "round.converse");
  await must(admin2.admin({ type: "round.next" }), "round.next");
  transitions.push(await everywhere("el cierre", (c) => c.group?.adventure.round.stage === "closing", tConv3));
  // El inventor, como una mesa: Vanessa lo abre y todas las personas entran a la vez y registran su pregunta (sugerida o escrita).
  const tInventor = now();
  await must(admin2.admin({ type: "inventor.open" }), "inventor.open");
  transitions.push(await everywhere("el inventor abierto", (c) => c.group?.adventure.inventor.open === true, tInventor));
  const presets = (JSON.parse(readFileSync(resolve("public/config/laboratorio.json"), "utf8")) as LaboratorioConfig).inventor.questions;
  await Promise.all(
    people.map(async (p) => {
      await must(p.client.act({ type: "station.open", stationId: "inventor", origin: "quickNav" }), "station.open (inventor)");
      const question = p.index % 3 === 0 ? { kind: "written" as const, text: `¿Qué más podríamos investigar? (${p.index})` } : { kind: "preset" as const, presetId: presets[p.index % presets.length]!.id };
      await must(p.client.act({ type: "inventor.question", question }), "inventor.question");
    }),
  );
  await until(() => admin2.presence!.participants.filter((x) => x.question !== null).length === TOTAL, "Vanessa ve las preguntas de todas las personas", 5000);
  check(true, `las ${TOTAL} personas entran al inventor a la vez y Vanessa ve sus ${TOTAL} preguntas`);
  await must(admin2.admin({ type: "final.confirm", value: { kind: "written", text: "¿Cómo seguimos investigando con respeto?" } }), "final.confirm");
  await everywhere("la aventura terminó", (c) => c.summary?.phase === "finished", now());
  check(true, `la pregunta final llega a las ${TOTAL} pantallas y la aventura termina para todas`);
  const transStats = stats(transitions);
  console.log(`  ℹ cada transición de ronda visible en todas las pantallas (${transitions.length} medidas): ${fmt(transStats)}`);
  check(transStats.max <= GOALS.transitionMs, `cada transición de ronda es visible en < ${GOALS.transitionMs} ms en las ${TOTAL + 1} pantallas (máx ${transStats.max.toFixed(0)} ms)`);

  // ---- 5. cada persona recibe solo lo suyo ----
  console.log("\n5. Cada audiencia recibe solo lo suyo");
  const sum = (cs: LoadClient[], ev: string) => cs.reduce((a, c) => a + c.count(ev), 0);
  const phones = people.map((p) => p.client);
  check(sum(phones, "presence.updated") === 0, "ninguna persona recibió el listado de presencia ni el contador (solo los recibe la administradora)");
  check(admin2.count("me.state") === 0, "la administradora no recibe ningún estado personal");
  const meCounts = phones.map((c) => c.count("me.state"));
  console.log(`  ℹ estados personales recibidos por persona: mín ${Math.min(...meCounts)} · máx ${Math.max(...meCounts)} (todos los suyos)`);
  const phoneBytes = phones.map((c) => c.bytes());
  const adminBytes = admin.bytes() + admin2.bytes();
  console.log(`  ℹ bytes recibidos por persona: mín ${Math.min(...phoneBytes)} · prom ${Math.round(phoneBytes.reduce((a, b) => a + b, 0) / phoneBytes.length)} · máx ${Math.max(...phoneBytes)}; la administradora: ${adminBytes}`);
  if (REMOTE) console.log("  ℹ los errores del servidor remoto no se ven desde aquí: revisa sus registros (Render › Logs)");
  else check(serverErrors.length === 0, `el servidor no escribió errores${serverErrors.length ? `: ${serverErrors.slice(0, 2).join(" | ")}` : ""}`);
  // La sala de prueba no se queda abierta en un servidor publicado.
  if (REMOTE) await must(admin2.admin({ type: "room.close", confirm: true }), "room.close");

  // ---- informe ----
  clearInterval(sampler);
  const cpu = stats(cpuSamples.length ? cpuSamples : [0]);
  const rss = stats(rssSamples.length ? rssSamples : [0]);
  if (!REMOTE) console.log(`\n  ℹ servidor durante el ensayo: CPU máx ${cpu.max.toFixed(0)} % (p95 ${cpu.p95.toFixed(0)} %), memoria máx ${rss.max.toFixed(0)} MiB`);
  const report = {
    fecha: new Date().toISOString(),
    equipo: { sistema: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`, procesador: os.cpus()[0]?.model ?? "?", nucleos: os.cpus().length, memoriaGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version },
    red: REMOTE ? `Internet hasta ${REMOTE}: los clientes salen de una sola computadora (una IP) y el servidor es el publicado` : "bucle local (127.0.0.1): clientes y servidor en la misma computadora; no hay red inalámbrica ni celulares reales",
    escenario: { participantes: TOTAL, administradoras: 1, enLaRonda: INITIAL, entradasTardias: LATE, desconectadasYReconectadas: droppers.length, rondas: 3, enLaRondaDeRampasYObservatorio: TOTAL },
    metas: GOALS,
    entradaMs: entryStats,
    transicionesDeRondaMs: transStats,
    acuseRegistroPosicionMs: ack,
    reflejoEnElPropioTelefonoMs: refl,
    acuseSoltarPelotaMs: ramps,
    entradasTardiasMs: lateStats,
    separacionMuestrasDeRelojMs: gapStats,
    muestrasDeRelojEnLaProyeccion: adminClock.length,
    contadorLlegaAlTotalMs: Math.round(counterMs),
    reanudacionTrasCaerLaAdministradoraMs: Math.round(pausedMs),
    servidor: REMOTE ? { remoto: REMOTE } : { cpuMaxPct: cpu.max, cpuP95Pct: cpu.p95, memoriaMaxMiB: rss.max },
    bytes: { maxPorPersona: Math.max(...phoneBytes), promedioPorPersona: Math.round(phoneBytes.reduce((a, b) => a + b, 0) / phoneBytes.length), administradora: adminBytes },
    incumplidas: failures,
  };
  if (process.env.LOAD_REPORT) {
    const out = resolve("docs/evidencia/fase7");
    mkdirSync(out, { recursive: true });
    const name = REMOTE ? `capacidad-remota-${TOTAL}` : TOTAL === 50 ? "capacidad" : `capacidad-${TOTAL}`;
    writeFileSync(join(out, `${name}.json`), JSON.stringify(report, null, 2) + "\n");
    const row = (name: string, st: Stats, goal: string) => `| ${name} | ${st.n} | ${st.p50.toFixed(1)} | ${st.p95.toFixed(1)} | ${st.p99.toFixed(1)} | ${st.max.toFixed(1)} | ${goal} |`;
    writeFileSync(
      join(out, `${name}.md`),
      [
        "# Ensayo de capacidad con participación simultánea (P7-05)",
        "",
        `Fecha: ${report.fecha}`,
        `Equipo: ${report.equipo.sistema}, ${report.equipo.procesador}, ${report.equipo.nucleos} núcleos, ${report.equipo.memoriaGiB} GiB, Node ${report.equipo.node}.`,
        `Red: ${report.red}.`,
        `Escenario: ${TOTAL} participantes y 1 administradora; ${INITIAL} en la lista de la ronda y ${LATE} entradas tardías que acompañan; las tres mesas completas con todas las personas explorando a la vez (${INITIAL} personas con 2 posiciones de linterna cada una; después las ${TOTAL} con 2 pruebas de rampa simultáneas; el observatorio, con la Luna y las estrellas; el inventor, con la pregunta de cada persona); ${droppers.length} desconexiones y reconexiones; caída y regreso de la administradora; pregunta final.`,
        "",
        "| Medida (ms) | n | p50 | p95 | p99 | máx | Meta (SPECS 11.2) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        row("Entrada (unirse + conectar + resumen)", entryStats, `≤ ${GOALS.entryMs}`),
        row("Transición de ronda visible en todas las pantallas", transStats, `< ${GOALS.transitionMs}`),
        row("Acuse de cada posición de la linterna", ack, "—"),
        row("Acción → el propio teléfono", refl, `< ${GOALS.reflectMs}`),
        row("Acuse de «soltar la pelota»", ramps, "—"),
        row("Entradas tardías (durante la exploración)", lateStats, `≤ ${GOALS.entryMs}`),
        row("Separación entre muestras de reloj (cada 500 ms)", gapStats, `≈ 500 (≤ ${GOALS.clockGapP95Ms})`),
        "",
        `El contador de la administradora llegó al total ${report.contadorLlegaAlTotalMs} ms después de la última acción (meta ≤ ${GOALS.counterMs}). Las ${TOTAL} personas vieron la pausa ${report.reanudacionTrasCaerLaAdministradoraMs} ms después de caer la administradora.`,
        REMOTE ? `Servidor: el publicado en ${REMOTE} (CPU y memoria: ver su panel).` : `Servidor: CPU máx ${cpu.max.toFixed(0)} % (p95 ${cpu.p95.toFixed(0)} %), memoria máx ${rss.max.toFixed(0)} MiB.`,
        `Bytes recibidos por persona: promedio ${report.bytes.promedioPorPersona}, máx ${report.bytes.maxPorPersona}; la administradora, ${adminBytes}. Nadie recibió el listado de presencia ni estados personales ajenos.`,
        "",
        failures.length ? `**Metas incumplidas:** ${failures.join("; ")}` : "Ninguna meta comprobable aquí quedó incumplida.",
        "",
        REMOTE
          ? "**Limitaciones:** todos los clientes salen de una misma computadora y red (una IP), sin celulares reales y sin FPS; los clientes no renderizan."
          : "**Limitaciones:** bucle local, sin celulares reales, sin red inalámbrica y sin FPS; los clientes no renderizan. Los celulares reales se ensayan por separado (P7-06 y fase 8).",
        "",
      ].join("\n"),
    );
    console.log(`  ℹ informe escrito en ${out}`);
  }
  console.log(failures.length === 0 ? "\nEnsayo de capacidad con participación simultánea: OK" : `\nEnsayo de capacidad: ${failures.length} meta(s) NO cumplida(s)`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  clearInterval(sampler);
  for (const c of clients) c.close();
  server?.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}
