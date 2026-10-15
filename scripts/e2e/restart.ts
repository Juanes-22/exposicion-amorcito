// Reinicio REAL del servicio (fase 6, P6-03; con rondas simultáneas). Se arranca el servidor como proceso aparte, dos personas sueltan
// una pelota a la vez y se lo mata con SIGKILL a mitad de la prueba (caída abrupta, sin cierre ordenado); se arranca otro proceso con
// el MISMO archivo SQLite y el mismo puerto.
// Los clientes son los reales (`RoomController`) y reconectan solos. Se mide cuánto retrocede la animación y se comprueba que no se
// suma el tiempo que el servicio estuvo apagado. Usa relojes reales: tarda ~25 s.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomController } from "../../src/app/RoomController";
import type { RampsState } from "../../shared/contracts/state";
import { createRoom, joinRoom } from "../../server/src/testing/harness";

const dir = mkdtempSync(join(tmpdir(), "laboratorio-reinicio-"));
const db = join(dir, "reinicio.sqlite");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (cond: unknown, m: string) => {
  if (!cond) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};
const until = async (cond: () => boolean, what: string, ms = 20_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado: ${what}`);
    await sleep(25);
  }
};

/** Un puerto libre que se reutiliza en los dos arranques (los clientes reconectan a la misma dirección). */
const port = await new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
const BASE = `http://127.0.0.1:${port}`;

function startServer(label: string): Promise<ChildProcess> {
  // `node --import tsx` y no `npx`: la señal debe llegar al proceso del servidor, no a un envoltorio.
  const child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATABASE_PATH: db, DIST_DIR: join(dir, "sin-dist") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`el servidor ${label} no arrancó`)), 20_000);
    child.stdout!.on("data", (d: Buffer) => {
      if (String(d).includes("Servidor escuchando")) {
        clearTimeout(t);
        resolve(child);
      }
    });
    child.stderr!.on("data", (d: Buffer) => process.stderr.write(`[${label}] ${d}`));
    child.once("exit", (code, signal) => reject(new Error(`el servidor ${label} terminó (${code ?? signal}) antes de escuchar`)));
  });
}

const controllers: RoomController[] = [];
let server: ChildProcess | null = null;
try {
  console.log("\nArranque 1");
  server = await startServer("A");

  const created = await createRoom(BASE);
  const code = created.body.code;
  const ana = await joinRoom(BASE, code, "Ana");
  const beto = await joinRoom(BASE, code, "Beto");
  const mk = (token: string) => {
    const c = new RoomController(BASE, token);
    controllers.push(c);
    c.connect();
    return c;
  };
  const admin = mk(created.body.adminToken);
  const anaC = mk(ana.body.token);
  const betoC = mk(beto.body.token);
  await until(() => [admin, anaC, betoC].every((c) => c.getState().status === "connected" && c.getState().summary !== null) && admin.getState().presence?.connectedCount === 2, "todos conectados");

  const okAct = async (who: RoomController, action: Parameters<RoomController["act"]>[0]) => {
    const r = await who.act(action);
    if (!r.ok) throw new Error(`${action.type}: ${r.code} ${r.message}`);
  };
  const okAdmin = async (action: Parameters<RoomController["admin"]>[0]) => {
    const r = await admin.admin(action);
    if (!r.ok) throw new Error(`${action.type}: ${r.code} ${r.message}`);
  };
  /** Espera a que ESTA persona ya conozca la ronda: sus acciones llevan la versión de ronda que ve. */
  const inRound = (c: RoomController, index: number, stage: string) => until(() => c.getState().group?.adventure.round.index === index && c.getState().group?.adventure.round.stage === stage, `la ronda ${index} en ${stage}`);

  await okAdmin({ type: "room.start" });
  await okAdmin({ type: "round.open" });
  await inRound(anaC, 0, "exploration");
  await inRound(betoC, 0, "exploration");
  await okAdmin({ type: "round.converse", withPending: true });
  await okAdmin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "La luz cercana hace sombras grandes" });
  await okAdmin({ type: "round.next" });
  await okAdmin({ type: "round.open" });
  await inRound(anaC, 1, "exploration");
  await inRound(betoC, 1, "exploration");

  // Las dos personas sueltan una pelota: cada una la suya, a la vez.
  await okAct(anaC, { type: "station.open", stationId: "rampas", origin: "quickNav" });
  await okAct(betoC, { type: "station.open", stationId: "rampas", origin: "quickNav" });
  await okAct(anaC, { type: "ramps.trial.start", angleDeg: 20 });
  await okAct(betoC, { type: "ramps.trial.start", angleDeg: 25 });
  const trialOf = (c: RoomController) => (c.getState().me!.participant.activities.rampas as RampsState).trials[0]!;
  await until(() => trialOf(anaC) !== undefined && trialOf(betoC) !== undefined, "las dos pruebas empezaron");

  // Mitad de la prueba de Ana (dura ~3,1 s): se anota hasta dónde llegó el reloj de simulación y se mata el proceso.
  let lastActive = 0;
  admin.subscribeClock((f) => void (lastActive = f.activeMs));
  await until(() => lastActive > 0, "muestras del reloj de simulación");
  const startActive = trialOf(anaC).startActiveMs;
  await until(() => lastActive - startActive >= 1500, "la pelota lleva 1,5 s rodando");
  await sleep(Math.random() * 450); // se mata en un punto cualquiera del ciclo de 500 ms entre checkpoints
  const notebookBefore = JSON.stringify(admin.getState().group!.adventure.notebook);
  const durationMs = trialOf(anaC).durationMs;
  const betoDuration = trialOf(betoC).durationMs;
  const roundBefore = JSON.stringify(admin.getState().group!.adventure.round);
  const roundVersionBefore = admin.getState().summary!.roundVersion;
  server.kill("SIGKILL");
  const killedAt = Date.now();
  await new Promise((r) => server!.once("exit", r));
  server = null;
  const activeBeforeKill = lastActive; // la última muestra que llegó antes de la caída
  console.log(`  ℹ se mató el proceso (SIGKILL) con la prueba a ${Math.round(activeBeforeKill - startActive)} ms de ${durationMs} ms`);
  await until(() => admin.getState().status === "reconnecting", "el cliente se da cuenta de la caída", 10_000);
  check(true, "los clientes pasan a «reconectando» (la interfaz deja de actuar sobre estado viejo)");

  const DOWNTIME_MS = 3000;
  await sleep(DOWNTIME_MS);
  console.log("\nArranque 2: mismo archivo SQLite, mismo puerto");
  server = await startServer("B");
  const downtime = Date.now() - killedAt;
  await until(() => [admin, anaC, betoC].every((c) => c.getState().status === "connected" && c.getState().summary?.phase === "paused" && c.getState().group !== null), "los tres reconectan con la sala pausada", 25_000);
  await until(() => anaC.getState().me !== null && betoC.getState().me !== null, "cada persona recupera su propio estado");
  const g = admin.getState().group!.adventure;
  const retroceso = activeBeforeKill - g.timeline.activeMs;
  console.log(`  ℹ el servicio estuvo apagado ${downtime} ms; el reloj de simulación retrocedió ${Math.round(retroceso)} ms (checkpoint cada 500 ms)`);
  check(retroceso >= -150 && retroceso <= 700, `la animación retrocede como mucho hasta el último checkpoint (~500 ms): ${Math.round(retroceso)} ms`);
  check(g.timeline.activeMs < activeBeforeKill + 150, "NO se sumó el tiempo que el servicio estuvo apagado");
  check(JSON.stringify(g.notebook) === notebookBefore && g.notebook.length === 1, "la nota del grupo guardada antes de la caída sigue idéntica");
  check(JSON.stringify(g.round) === roundBefore && g.round.stage === "exploration" && g.round.roster.length === 2, "la ronda sigue en exploración con la misma lista de participantes (el contador no cambió por la caída)");
  check(trialOf(anaC).state === "running" && trialOf(anaC).durationMs === durationMs && trialOf(betoC).state === "running" && trialOf(betoC).durationMs === betoDuration, "las dos pruebas siguen en curso, cada una de su dueña, con sus condiciones congeladas");
  check(anaC.getState().me!.participant.view.kind === "activity" && betoC.getState().me!.participant.view.kind === "activity", "cada persona vuelve a la mesa que tenía abierta");
  check(admin.getState().summary!.phase === "paused" && admin.getState().summary!.roundVersion > roundVersionBefore, "la sala se recuperó pausada y la ronda se renovó: lo que llegue de antes ya no sirve");
  check((await anaC.act({ type: "ramps.trial.start", angleDeg: 25 })).ok === false, "en pausa nadie puede soltar otra pelota");

  // Vanessa decide cuándo continuar: reanuda. Las pruebas siguen desde donde estaban y terminan en su instante exacto.
  const resumedAt = Date.now();
  const remaining = durationMs - (g.timeline.activeMs - startActive);
  await okAdmin({ type: "room.resume" });
  await until(() => trialOf(anaC).state === "finished" && trialOf(betoC).state === "finished", "las pruebas terminan", 15_000);
  const took = Date.now() - resumedAt;
  const t = trialOf(anaC);
  console.log(`  ℹ tras reanudar faltaban ${Math.round(remaining)} ms de prueba y terminó a los ${took} ms`);
  check(Math.abs(t.endedActiveMs! - t.startActiveMs - durationMs) < 1e-6, "terminó en su instante exacto de simulación (inicio + duración)"); // tolerancia de coma flotante, no `===`
  check(took >= remaining - 400 && took < remaining + 2200, "y tardó en reanudarse lo que le faltaba, sin saltar al final por el tiempo apagado (y la de Beto, de otra duración, también terminó)");

  // La administración se recuperó con la credencial de antes, sin pedir nada nuevo.
  check(admin.getState().summary?.self.role === "admin", "Vanessa recuperó la administración con su misma credencial");
  console.log("\nE2E de reinicio real del servicio: OK");
} finally {
  for (const c of controllers) c.dispose();
  server?.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}
