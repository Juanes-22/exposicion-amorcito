// Fase 7 (P7-05): ensayo de capacidad. 50 participantes y una administradora conectados a un servidor REAL (proceso aparte, SQLite
// real), con un solo controlador. Recorre lo que SPECS 11.2 pide medir: entrada, cambios de turno repetidos, el arrastre del slider a
// ~12 Hz, la prueba de rampa con sus frames, entradas tardías y desconexiones; y comprueba que quien espera NO recibe el estado de la
// aventura ni los frames. Usa relojes reales: tarda ~1 minuto.
//
//   npm run test:load                 → informe en la consola
//   LOAD_REPORT=1 npm run test:load   → además escribe docs/evidencia/fase7/capacidad.{json,md}
//
// Qué NO mide: celulares reales, red inalámbrica ni FPS. Los clientes y el servidor comparten computadora y red de bucle local (ver el
// informe). Sirve para el comportamiento del protocolo y del servidor con 51 conexiones; los celulares reales se ensayan aparte (P7-06).
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join, resolve } from "node:path";
import { PARTICIPANT_COLOR_IDS } from "../../shared/contracts/limits";
import type { SimulationFrame } from "../../shared/contracts/events";
import type { RampsState, ShadowsState } from "../../shared/contracts/state";
import { LoadClient, now, stats, type Stats } from "./client";

const TOTAL = 50;
const LATE = 6;
const INITIAL = TOTAL - LATE;
const TURN_CHANGES = 30;
const SLIDER_HZ = 12;
const SLIDER_SECONDS = 12;
// Metas de SPECS 11.2 que esta prueba puede comprobar (en bucle local).
const GOALS = { entryMs: 5000, turnMs: 1000, reflectMs: 250, frameGapP95Ms: 200 };

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

const port = await new Promise<number>((resolvePort) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolvePort(p));
  });
});
const BASE = `http://127.0.0.1:${port}`;
const serverErrors: string[] = [];
const server: ChildProcess = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_PATH: join(dir, "capacidad.sqlite"), DIST_DIR: join(dir, "sin-dist") },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr!.on("data", (d: Buffer) => serverErrors.push(String(d).trim()));
await new Promise<void>((res, rej) => {
  const t = setTimeout(() => rej(new Error("el servidor no arrancó")), 20_000);
  server.stdout!.on("data", (d: Buffer) => String(d).includes("Servidor escuchando") && (clearTimeout(t), res()));
  server.once("exit", () => rej(new Error("el servidor terminó antes de escuchar")));
});

// ---- muestreo del proceso del servidor (CPU y memoria) ----
const cpuSamples: number[] = [];
const rssSamples: number[] = [];
const sampler = setInterval(() => {
  execFile("ps", ["-o", "%cpu=,rss=", "-p", String(server.pid)], (err, out) => {
    if (err) return;
    const [cpu, rss] = out.trim().split(/\s+/).map(Number);
    if (Number.isFinite(cpu)) cpuSamples.push(cpu!);
    if (Number.isFinite(rss)) rssSamples.push(rss! / 1024);
  });
}, 500);

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
    return { id: j.body.principalId, name, token: j.body.token, client };
  };
  const joinMany = async (from: number, count: number) => {
    // Llegan en oleadas, como al escanear un QR proyectado: 10 a la vez.
    for (let start = 0; start < count; start += 10) {
      const batch = await Promise.all(Array.from({ length: Math.min(10, count - start) }, (_, k) => joinOne(from + start + k)));
      people.push(...batch);
    }
  };

  console.log(`\n1. Entrada: ${INITIAL} participantes + administradora`);
  await joinMany(0, INITIAL);
  await until(() => admin.presence?.connectedCount === INITIAL, "presencia completa en la administradora");
  const entryStats = stats(entryMs);
  console.log(`  ℹ entrada (unirse + conectar + recibir su resumen): ${fmt(entryStats)}`);
  check(entryStats.p95 <= GOALS.entryMs, `la entrada tarda ≤ ${GOALS.entryMs} ms en el p95 (${entryStats.p95.toFixed(0)} ms), con ${INITIAL} entradas en oleadas de 10`);

  // ---- 2. cambios de turno repetidos ----
  console.log(`\n2. ${TURN_CHANGES} cambios de turno con ${INITIAL} personas esperando`);
  const rotation = people.slice(0, 10);
  const turnCtrlMs: number[] = [];
  const turnAllMs: number[] = [];
  let current: Person | null = null;
  const assign = async (target: Person, record = true) => {
    const t0 = now();
    const res = await admin.admin({ type: "control.assign", principalId: target.id });
    if (!res.ok) throw new Error(`control.assign: ${res.code} ${res.message}`);
    // Los tiempos cuentan desde que la administradora emite la orden (no desde que llega el acuse).
    await until(() => target.client.summary?.self.isController === true && target.client.snapshot !== null && target.client.turnVersion >= res.turnVersion && target.client.snapshot.state.turnVersion >= res.turnVersion, "el nuevo controlador recibe su estado");
    const ready = now() - t0;
    const everyone = [admin, ...people.map((p) => p.client)].filter((c) => c.socket.connected); // quien se cayó no cuenta
    await until(() => everyone.every((c) => c.summary?.controller?.principalId === target.id), "todos ven quién explora");
    const all = now() - t0;
    if (record) {
      turnCtrlMs.push(ready);
      turnAllMs.push(all);
    }
    current = target;
  };
  await assign(rotation[0]!, false);
  const started = await admin.admin({ type: "room.start" });
  if (!started.ok) throw new Error(`room.start: ${started.code}`);
  await until(() => people[0]!.client.summary?.phase === "running", "sala en curso");
  for (let i = 1; i <= TURN_CHANGES; i++) {
    await assign(rotation[i % rotation.length]!);
    await sleep(120);
  }
  const ctrlStats = stats(turnCtrlMs);
  const allStats = stats(turnAllMs);
  console.log(`  ℹ el nuevo controlador ya tiene su estado: ${fmt(ctrlStats)}`);
  console.log(`  ℹ las ${INITIAL + 1} pantallas ya muestran quién explora: ${fmt(allStats)}`);
  check(ctrlStats.max <= GOALS.turnMs && allStats.max <= GOALS.turnMs, `el cambio de turno es visible en < ${GOALS.turnMs} ms en todos los casos (máx ${allStats.max.toFixed(0)} ms)`);

  // ---- 3. slider a ~12 Hz con entradas tardías ----
  console.log(`\n3. Arrastre del slider a ${SLIDER_HZ} Hz durante ${SLIDER_SECONDS} s, con ${LATE} entradas tardías a mitad`);
  let ctrl = people.find((p) => p.id === current!.id)!;
  const must = async (c: LoadClient, a: Parameters<LoadClient["adventure"]>[0]) => {
    const r = await c.adventure(a);
    if (!r.ok) throw new Error(`${a.type}: ${r.code} ${r.message}`);
  };
  await must(ctrl.client, { type: "station.open", stationId: "sombras", origin: "quickNav" });
  await must(ctrl.client, { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Por la luz" } });
  const sentAt = new Map<number, number>();
  const ackRtt: number[] = [];
  const reflectAdmin: number[] = [];
  const reflectCtrl: number[] = [];
  const seenAdmin = new Set<number>();
  const seenCtrl = new Set<number>();
  const record = (set: Set<number>, into: number[]) => (s: { state: { adventure: { activities: Record<string, unknown> } } }) => {
    const d = (s.state.adventure.activities.sombras as ShadowsState).distanceCm;
    const t0 = sentAt.get(d);
    if (t0 !== undefined && !set.has(d)) {
      set.add(d);
      into.push(now() - t0);
    }
  };
  const offA = admin.onSnapshot(record(seenAdmin, reflectAdmin));
  const offC = ctrl.client.onSnapshot(record(seenCtrl, reflectCtrl));
  const total = SLIDER_HZ * SLIDER_SECONDS;
  const lateEntries: Promise<void> = (async () => {
    await sleep((SLIDER_SECONDS * 1000) / 2);
    await joinMany(INITIAL, LATE);
  })();
  const acks: Promise<void>[] = [];
  const t0Stream = now();
  for (let i = 0; i < total; i++) {
    const target = t0Stream + (i * 1000) / SLIDER_HZ;
    const wait = target - now();
    if (wait > 0) await sleep(wait);
    const d = 10 + ((i * 37) % 500) / 10;
    sentAt.set(d, now());
    const sent = now();
    acks.push(ctrl.client.adventure({ type: "shadows.light.set", distanceCm: d, commitSample: false }).then((r) => {
      if (!r.ok) throw new Error(`slider: ${r.code}`);
      ackRtt.push(now() - sent);
    }));
  }
  await Promise.all(acks);
  await lateEntries;
  await until(() => reflectAdmin.length >= total * 0.98, "la proyección recibió casi todo el arrastre", 5000).catch(() => undefined);
  offA();
  offC();
  const ackStats = stats(ackRtt);
  const adminStats = stats(reflectAdmin);
  const ctrlRefl = stats(reflectCtrl);
  console.log(`  ℹ acuse del servidor (ida y vuelta): ${fmt(ackStats)}`);
  console.log(`  ℹ acción → proyección (snapshot en la administradora): ${fmt(adminStats)}`);
  console.log(`  ℹ acción → teléfono del controlador: ${fmt(ctrlRefl)}`);
  check(reflectAdmin.length >= total * 0.98, `la proyección recibió ${reflectAdmin.length} de ${total} cambios del arrastre`);
  check(adminStats.p95 < GOALS.reflectMs, `reflejo en la proyección < ${GOALS.reflectMs} ms en el p95 (${adminStats.p95.toFixed(1)} ms; p99 ${adminStats.p99.toFixed(1)} ms)`);
  const lateStats = stats(entryMs.slice(INITIAL));
  console.log(`  ℹ entradas tardías (durante el arrastre): ${fmt(lateStats)}`);
  check(lateStats.max <= GOALS.entryMs, `las ${LATE} entradas tardías, durante el arrastre, tardan ≤ ${GOALS.entryMs} ms (máx ${lateStats.max.toFixed(0)} ms)`);
  check(people.length === TOTAL, `hay ${TOTAL} participantes conectados y una administradora`);

  // ---- 4. prueba de rampa y frames ----
  console.log("\n4. Prueba de rampa: muestras de simulación (10 Hz) y cambio de turno a mitad");
  await must(ctrl.client, { type: "shadows.light.set", distanceCm: 20, commitSample: true });
  await must(ctrl.client, { type: "shadows.light.set", distanceCm: 50, commitSample: true });
  await must(ctrl.client, { type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "oral" } });
  await must(ctrl.client, { type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } });
  await must(ctrl.client, { type: "adventure.returnToMap" });
  await must(ctrl.client, { type: "station.open", stationId: "rampas", origin: "quickNav" });
  await must(ctrl.client, { type: "ramps.question.open" });
  await must(ctrl.client, { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
  await must(ctrl.client, { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } });
  await must(ctrl.client, { type: "ramps.angle.set", angleDeg: 15 });
  const adminFrames: number[] = [];
  const ctrlFrames: number[] = [];
  const nextFrames: number[] = [];
  const next = people.find((p) => p.id !== ctrl.id && rotation.includes(p))!;
  const onAdmin = admin.onFrame((_f: SimulationFrame, t: number) => adminFrames.push(t));
  const onCtrl = ctrl.client.onFrame((_f, t) => ctrlFrames.push(t));
  const onNext = next.client.onFrame((_f, t) => nextFrames.push(t));
  const frameMark = now();
  await must(ctrl.client, { type: "ramps.trial.start" });
  await sleep(1500);
  const handoverAt = now();
  await assign(next, false); // cambio de turno con la pelota rodando
  await until(() => (admin.snapshot!.state.adventure.activities.rampas as RampsState).trials[0]?.state === "finished", "la prueba termina", 8000);
  await sleep(300);
  onAdmin();
  onCtrl();
  onNext();
  const gaps = adminFrames.slice(1).map((t, i) => t - adminFrames[i]!);
  const gapStats = stats(gaps);
  console.log(`  ℹ ${adminFrames.length} frames en la proyección durante la prueba; separación entre frames: ${fmt(gapStats)}`);
  check(adminFrames.length >= 25 && gapStats.p95 <= GOALS.frameGapP95Ms, `la proyección recibe los frames a ~10 Hz sin huecos (p95 de separación ${gapStats.p95.toFixed(0)} ms ≤ ${GOALS.frameGapP95Ms} ms)`);
  check(ctrlFrames.length > 0 && ctrlFrames.filter((t) => t > handoverAt + 300).length === 0, "quien tenía el turno recibió frames hasta el cambio y NINGUNO 300 ms después de perderlo");
  check(nextFrames.length > 0 && nextFrames.filter((t) => t < handoverAt).length === 0, `quien recibió el turno a mitad de la prueba empezó a recibir frames al instante (${nextFrames.length} frames) y ninguno antes`);
  const trial = (admin.snapshot!.state.adventure.activities.rampas as RampsState).trials[0]!;
  check(Math.abs(trial.endedActiveMs! - trial.startActiveMs - trial.durationMs) < 1e-6, "la prueba terminó en su instante exacto de simulación, aun con el cambio de turno en medio");
  void frameMark;
  ctrl = next;

  // ---- 5. desconexiones ----
  console.log("\n5. Desconexiones");
  const dropAt = now();
  ctrl.client.close(); // el controlador se desconecta de golpe
  const pausedAfter = await until(() => admin.summary?.phase === "paused", "la administradora ve la pausa", 5000);
  check(pausedAfter < 1000, `la caída de quien controla se refleja en la proyección en ${pausedAfter.toFixed(0)} ms (cierre de socket; el corte silencioso se mide en detection.test.ts: ~8,6 s) `);
  await until(() => people.filter((p) => p !== ctrl).every((p) => p.client.summary?.phase === "paused"), "todos ven la pausa", 3000);
  const droppers = people.filter((p) => p !== ctrl && !rotation.includes(p)).slice(0, 3);
  for (const p of droppers) p.client.close();
  await until(() => admin.presence?.connectedCount === TOTAL - 1 - droppers.length, "la presencia refleja las caídas", 3000);
  const rejoinMs: number[] = [];
  for (const p of droppers) {
    const t0 = now();
    const c = new LoadClient(BASE, p.token, `${p.name} (de vuelta)`);
    clients.push(c);
    await c.ready();
    rejoinMs.push(now() - t0);
    p.client = c;
  }
  const replacement = people.find((p) => p !== ctrl && rotation.includes(p) && p.client.socket.connected)!;
  await assign(replacement, false);
  const resumeAt = now();
  const resumed = await admin.admin({ type: "room.resume" });
  await until(() => replacement.client.summary?.phase === "running", "la sala se reanuda", 3000);
  check(resumed.ok, `tras la caída, la administradora reparte otro turno y reanuda en ${(now() - resumeAt).toFixed(0)} ms`);
  console.log(`  ℹ ${droppers.length} personas en espera se cayeron y volvieron: ${fmt(stats(rejoinMs))}; la sala siguió en pausa/curso sin afectarles (${(now() - dropAt).toFixed(0)} ms de escenario)`);
  check(droppers.every((p) => p.client.count("room.snapshot") === 0 && p.client.count("simulation.frame") === 0), "quienes volvieron a la espera recibieron solo su resumen: ni estado de la aventura ni frames");

  // ---- 6. quien espera no recibe el estado ----
  console.log("\n6. Quien espera NO recibe el estado de la aventura");
  const never = people.filter((p) => !p.client.hadControl);
  const had = people.filter((p) => p.client.hadControl);
  const sum = (cs: LoadClient[], ev: string) => cs.reduce((a, c) => a + c.count(ev), 0);
  check(never.length >= 35, `${never.length} personas no tuvieron el turno en todo el ensayo`);
  check(sum(never.map((p) => p.client), "room.snapshot") === 0, `esas ${never.length} personas recibieron 0 snapshots completos`);
  check(sum(never.map((p) => p.client), "simulation.frame") === 0, "y 0 frames de simulación");
  check(sum(never.map((p) => p.client), "presence.updated") === 0, "y 0 listados de presencia (solo los recibe la administradora)");
  const lateAfterLoss = had.reduce((a, p) => a + (p.client.lostControlAt === null ? 0 : p.client.received.filter((r) => (r.event === "room.snapshot" || r.event === "simulation.frame") && r.t > p.client.lostControlAt! + 300).length), 0);
  check(lateAfterLoss === 0, `las ${had.length} personas que tuvieron el turno dejaron de recibir snapshots y frames al perderlo (0 recibidos 300 ms después)`);
  const waitingBytes = never.map((p) => p.client.bytes());
  const adminBytes = admin.bytes();
  console.log(`  ℹ bytes recibidos por persona que solo esperó: mín ${Math.min(...waitingBytes)} · prom ${Math.round(waitingBytes.reduce((a, b) => a + b, 0) / waitingBytes.length)} · máx ${Math.max(...waitingBytes)}; la administradora: ${adminBytes} (${Math.round(admin.bytes("room.snapshot") / 1024)} KiB solo de snapshots)`);
  check(Math.max(...waitingBytes) < adminBytes / 20, "lo que recibe quien espera es una fracción mínima de lo que recibe la proyección");
  check(admin.count("simulation.frame") > 0 && admin.count("room.snapshot") > 0 && admin.count("presence.updated") > 0, "la administradora sí recibe snapshots, frames y presencia");
  check(serverErrors.length === 0, `el servidor no escribió errores${serverErrors.length ? `: ${serverErrors.slice(0, 2).join(" | ")}` : ""}`);

  // ---- informe ----
  clearInterval(sampler);
  const cpu = stats(cpuSamples);
  const rss = stats(rssSamples);
  console.log(`\n  ℹ servidor durante el ensayo: CPU máx ${cpu.max.toFixed(0)} % (p95 ${cpu.p95.toFixed(0)} %), memoria máx ${rss.max.toFixed(0)} MiB`);
  const report = {
    fecha: new Date().toISOString(),
    equipo: { sistema: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`, procesador: os.cpus()[0]?.model ?? "?", nucleos: os.cpus().length, memoriaGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version },
    red: "bucle local (127.0.0.1): clientes y servidor en la misma computadora; no hay red inalámbrica ni celulares reales",
    escenario: { participantes: TOTAL, administradoras: 1, controladores: 1, entradasTardias: LATE, cambiosDeTurno: TURN_CHANGES, sliderHz: SLIDER_HZ, sliderSegundos: SLIDER_SECONDS },
    metas: GOALS,
    entradaMs: entryStats,
    cambioDeTurnoNuevoControladorMs: ctrlStats,
    cambioDeTurnoTodasLasPantallasMs: allStats,
    acuseServidorMs: ackStats,
    reflejoProyeccionMs: adminStats,
    reflejoTelefonoControladorMs: ctrlRefl,
    entradasTardiasMs: lateStats,
    separacionFramesMs: gapStats,
    framesEnLaProyeccion: adminFrames.length,
    detencionPorCaidaDelControladorMs: Math.round(pausedAfter),
    servidor: { cpuMaxPct: cpu.max, cpuP95Pct: cpu.p95, memoriaMaxMiB: rss.max },
    espera: { personasQueSoloEsperaron: never.length, snapshots: sum(never.map((p) => p.client), "room.snapshot"), frames: sum(never.map((p) => p.client), "simulation.frame"), bytesMaxPorPersona: Math.max(...waitingBytes), bytesPromedioPorPersona: Math.round(waitingBytes.reduce((a, b) => a + b, 0) / waitingBytes.length), bytesAdministradora: adminBytes },
    incumplidas: failures,
  };
  if (process.env.LOAD_REPORT) {
    const out = resolve("docs/evidencia/fase7");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "capacidad.json"), JSON.stringify(report, null, 2) + "\n");
    const row = (name: string, s: Stats, goal: string) => `| ${name} | ${s.n} | ${s.p50.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.p99.toFixed(1)} | ${s.max.toFixed(1)} | ${goal} |`;
    writeFileSync(
      join(out, "capacidad.md"),
      [
        "# Ensayo de capacidad (P7-05)",
        "",
        `Fecha: ${report.fecha}`,
        `Equipo: ${report.equipo.sistema}, ${report.equipo.procesador}, ${report.equipo.nucleos} núcleos, ${report.equipo.memoriaGiB} GiB, Node ${report.equipo.node}.`,
        `Red: ${report.red}.`,
        `Escenario: ${TOTAL} participantes y 1 administradora, 1 controlador; ${LATE} entradas tardías; ${TURN_CHANGES} cambios de turno; slider a ${SLIDER_HZ} Hz durante ${SLIDER_SECONDS} s; prueba de rampa con cambio de turno a mitad; desconexiones.`,
        "",
        "| Medida (ms) | n | p50 | p95 | p99 | máx | Meta (SPECS 11.2) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        row("Entrada (unirse + conectar + resumen)", entryStats, `≤ ${GOALS.entryMs}`),
        row("Cambio de turno: nuevo controlador con su estado", ctrlStats, `< ${GOALS.turnMs}`),
        row("Cambio de turno: todas las pantallas lo ven", allStats, `< ${GOALS.turnMs}`),
        row("Acuse del servidor a cada cambio del slider", ackStats, "—"),
        row("Acción → proyección", adminStats, `< ${GOALS.reflectMs}`),
        row("Acción → teléfono del controlador", ctrlRefl, "—"),
        row("Entradas tardías (durante el arrastre)", lateStats, `≤ ${GOALS.entryMs}`),
        row("Separación entre frames (10 Hz)", gapStats, "≈ 100"),
        "",
        `Servidor: CPU máx ${cpu.max.toFixed(0)} % (p95 ${cpu.p95.toFixed(0)} %), memoria máx ${rss.max.toFixed(0)} MiB.`,
        `Quien solo esperó (${never.length} personas): ${report.espera.snapshots} snapshots, ${report.espera.frames} frames; ${report.espera.bytesPromedioPorPersona} bytes de promedio por persona (máx ${report.espera.bytesMaxPorPersona}) frente a ${adminBytes} de la administradora.`,
        `Caída del controlador (cierre de socket): reflejada en la proyección en ${report.detencionPorCaidaDelControladorMs} ms.`,
        "",
        failures.length ? `**Metas incumplidas:** ${failures.join("; ")}` : "Ninguna meta comprobable aquí quedó incumplida.",
        "",
        "**Limitaciones:** bucle local, sin celulares reales, sin red inalámbrica y sin FPS; los clientes no renderizan. Los celulares reales se ensayan por separado (P7-06 y fase 8).",
        "",
      ].join("\n"),
    );
    console.log(`  ℹ informe escrito en ${out}`);
  }
  console.log(failures.length === 0 ? "\nEnsayo de capacidad (fase 7): OK" : `\nEnsayo de capacidad (fase 7): ${failures.length} meta(s) NO cumplida(s)`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  clearInterval(sampler);
  for (const c of clients) c.close();
  server.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}
