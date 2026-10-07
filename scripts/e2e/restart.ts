// Fase 6 (P6-03): reinicio REAL del servicio. Se arranca el servidor como proceso aparte, se juega hasta mitad de una prueba de rampa,
// se lo mata con SIGKILL (caída abrupta, sin cierre ordenado) y se arranca otro proceso con el MISMO archivo SQLite y el mismo puerto.
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

  const ok = async (who: RoomController, action: Parameters<RoomController["adventure"]>[0]) => {
    const r = await who.adventure(action);
    if (!r.ok) throw new Error(`${action.type}: ${r.code} ${r.message}`);
  };
  await admin.admin({ type: "control.assign", principalId: ana.body.principalId });
  await admin.admin({ type: "room.start" });
  await until(() => anaC.getState().summary?.self.isController === true && anaC.getState().summary?.phase === "running", "Ana controla");

  await ok(anaC, { type: "station.open", stationId: "sombras", origin: "quickNav" });
  await ok(anaC, { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Por la luz" } });
  await ok(anaC, { type: "shadows.light.set", distanceCm: 15, commitSample: true });
  await ok(anaC, { type: "shadows.light.set", distanceCm: 45, commitSample: true });
  await ok(anaC, { type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "written", text: "De cerca es más grande" } });
  await ok(anaC, { type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } });
  await ok(anaC, { type: "adventure.returnToMap" });
  await ok(anaC, { type: "station.open", stationId: "rampas", origin: "quickNav" });
  await ok(anaC, { type: "ramps.question.open" });
  await ok(anaC, { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "written", text: "¿Por qué baja más rápido?" } });
  await ok(anaC, { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } });
  await ok(anaC, { type: "ramps.angle.set", angleDeg: 15 });
  await ok(anaC, { type: "ramps.trial.start" });

  // Mitad de la prueba (dura ~3,6 s): se anota hasta dónde llegó el reloj de simulación y se mata el proceso.
  let lastActive = 0;
  admin.subscribeFrames((f) => void (lastActive = f.activeMs));
  await until(() => lastActive > 0, "frames de simulación");
  const startActive = (admin.getState().snapshot!.state.adventure.activities.rampas as RampsState).trials[0]!.startActiveMs;
  await until(() => lastActive - startActive >= 1500, "la pelota lleva 1,5 s rodando");
  await sleep(Math.random() * 450); // se mata en un punto cualquiera del ciclo de 500 ms entre checkpoints
  const notebookBefore = JSON.stringify(admin.getState().snapshot!.state.adventure.notebook);
  const durationMs = (admin.getState().snapshot!.state.adventure.activities.rampas as RampsState).trials[0]!.durationMs;
  server.kill("SIGKILL");
  const killedAt = Date.now();
  await new Promise((r) => server!.once("exit", r));
  server = null;
  const activeBeforeKill = lastActive; // el último frame que llegó antes de la caída
  console.log(`  ℹ se mató el proceso (SIGKILL) con la prueba a ${Math.round(activeBeforeKill - startActive)} ms de ${durationMs} ms`);
  await until(() => admin.getState().status === "reconnecting", "el cliente se da cuenta de la caída", 10_000);
  check(true, "los clientes pasan a «reconectando» (la interfaz deja de actuar sobre estado viejo)");

  const DOWNTIME_MS = 3000;
  await sleep(DOWNTIME_MS);
  console.log("\nArranque 2: mismo archivo SQLite, mismo puerto");
  server = await startServer("B");
  const downtime = Date.now() - killedAt;
  await until(() => [admin, anaC, betoC].every((c) => c.getState().status === "connected" && c.getState().summary?.phase === "paused"), "los tres reconectan con la sala pausada", 25_000);
  const s = admin.getState().snapshot!.state;
  const trial = (s.adventure.activities.rampas as RampsState).trials[0]!;
  const retroceso = activeBeforeKill - s.adventure.timeline.activeMs;
  console.log(`  ℹ el servicio estuvo apagado ${downtime} ms; el reloj de simulación retrocedió ${Math.round(retroceso)} ms (checkpoint cada 500 ms)`);
  check(retroceso >= -150 && retroceso <= 700, `la animación retrocede como mucho hasta el último checkpoint (~500 ms): ${Math.round(retroceso)} ms`);
  check(s.adventure.timeline.activeMs < activeBeforeKill + 150, "NO se sumó el tiempo que el servicio estuvo apagado");
  check(JSON.stringify(s.adventure.notebook) === notebookBefore && s.adventure.notebook.length === 5, "los 5 registros confirmados antes de la caída siguen idénticos");
  check(trial.state === "running" && trial.durationMs === durationMs, "la prueba sigue en curso con sus condiciones congeladas");
  check(s.phase === "paused" && s.controlOwner === null, "la sala se recuperó pausada y sin propietario");
  check(anaC.getState().summary?.self.isController === false && anaC.getState().snapshot === null, "la controladora anterior volvió en espera: sin turno y sin estado de la aventura");
  check(admin.getState().summary!.turnVersion > anaC.getState().summary!.turnVersion - 1 && s.turnVersion > 1, "el turno se renovó: lo anterior ya no sirve");

  // Vanessa decide cuándo continuar: da el turno y reanuda. La prueba sigue desde donde estaba y termina en su instante exacto.
  await admin.admin({ type: "control.assign", principalId: ana.body.principalId });
  const resumedAt = Date.now();
  await admin.admin({ type: "room.resume" });
  await until(() => (admin.getState().snapshot!.state.adventure.activities.rampas as RampsState).trials[0]!.state === "finished", "la prueba termina", 15_000);
  const took = Date.now() - resumedAt;
  const remaining = durationMs - (s.adventure.timeline.activeMs - startActive);
  const t = (admin.getState().snapshot!.state.adventure.activities.rampas as RampsState).trials[0]!;
  console.log(`  ℹ tras reanudar faltaban ${Math.round(remaining)} ms de prueba y terminó a los ${took} ms`);
  check(Math.abs(t.endedActiveMs! - t.startActiveMs - durationMs) < 1e-6, "terminó en su instante exacto de simulación (inicio + duración)"); // tolerancia de coma flotante, no `===`
  check(Math.abs(took - remaining) < 1200, "y tardó en reanudarse lo que le faltaba: ni saltó al final por el tiempo apagado ni se alargó");

  // La administración se recuperó con la credencial de antes, sin pedir nada nuevo.
  check(admin.getState().summary?.self.role === "admin", "Vanessa recuperó la administración con su misma credencial");
  console.log("\nE2E de reinicio real del servicio (fase 6): OK");
} finally {
  for (const c of controllers) c.dispose();
  server?.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
}
