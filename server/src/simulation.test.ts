import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playerAt } from "../../shared/domain/adventure";
import { createRoom, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

let server: TestServer;
let now = 10_000;
const clients: TestClient[] = [];
const track = <T extends TestClient>(c: T): T => (clients.push(c), c);

beforeEach(async () => {
  now = 10_000;
  // Reloj monotónico controlado y sin temporizador: cada prueba avanza el tiempo y llama a tick() a mano.
  server = await startServer({ mono: () => now, settings: { tickIntervalMs: 0 } });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.stop();
});

const state = (code: string) => server.app.service.inspect(code)!.state;
const persisted = (code: string) => server.app.repo.loadRooms().rooms.find((r) => r.state.code === code)!.state;

async function running(names = ["Ana", "Beto", "Cata"]) {
  const r = await setupRoom(server, names);
  for (const c of r.clients) track(c);
  const [ana, beto, cata] = r.people.map((p) => p.client) as [TestClient, TestClient, TestClient];
  const [anaId, betoId] = r.people.map((p) => p.join.principalId) as [string, string];
  await r.admin.admin({ type: "control.assign", principalId: anaId });
  await r.admin.admin({ type: "room.start" });
  await ana.until(() => ana.summary?.self.isController === true && ana.summary.phase === "running", "Ana controla");
  return { ...r, ana, beto, cata, anaId, betoId };
}
const station = (i: number) => server.app.project.map.stations[i]!.point;
const frames = (c: TestClient) => c.count("simulation.frame");

describe("frames (SPECS 5.6): solo al canal de vista", () => {
  it("la administradora y el controlador reciben los frames; la espera nunca", async () => {
    const r = await running();
    expect(await r.ana.adventure({ type: "player.moveTo", target: station(1) })).toMatchObject({ ok: true });
    now += 400;
    await server.app.service.tick();
    await r.admin.until(() => frames(r.admin) >= 1, "frame en la proyección");
    await r.ana.until(() => frames(r.ana) >= 1, "frame en el teléfono del controlador");
    await r.beto.quiet(150);
    expect(frames(r.beto)).toBe(0);
    expect(frames(r.cata)).toBe(0);
    expect(r.beto.snapshots).toHaveLength(0);
  });

  it("cada frame lleva generación, versiones, secuencia creciente y la posición que corresponde al reloj", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(2) });
    const got: Array<{ frameSeq: number; activeMs: number; stateVersion: number; turnVersion: number; roomGeneration: number; feet: { x: number; y: number } }> = [];
    r.admin.socket.on("simulation.frame", (f) => got.push({ frameSeq: f.frameSeq, activeMs: f.activeMs, stateVersion: f.stateVersion, turnVersion: f.turnVersion, roomGeneration: f.roomGeneration, feet: f.player.feet }));
    for (let i = 0; i < 4; i++) {
      now += 250;
      await server.app.service.tick();
    }
    await r.admin.until(() => got.length === 4, "cuatro frames");
    expect(got.map((f) => f.frameSeq)).toEqual([...got.map((f) => f.frameSeq)].sort((a, b) => a - b));
    expect(new Set(got.map((f) => f.frameSeq)).size).toBe(4);
    expect(got.map((f) => f.activeMs)).toEqual([250, 500, 750, 1000]);
    const s = state(r.code);
    for (const f of got) {
      expect(f).toMatchObject({ roomGeneration: s.roomGeneration, turnVersion: s.turnVersion, stateVersion: s.stateVersion });
      expect(f.feet).toEqual(playerAt(s.adventure, f.activeMs).feet); // misma posición que dibujará cualquiera con ese plan y ese reloj
    }
  });

  it("no hay frames si no se mueve nada, ni en pausa", async () => {
    const r = await running();
    now += 300;
    await server.app.service.tick();
    await r.admin.quiet(100);
    expect(frames(r.admin)).toBe(0);
    await r.ana.adventure({ type: "player.moveTo", target: station(0) });
    await r.admin.admin({ type: "room.pause" });
    const before = frames(r.admin);
    now += 300;
    await server.app.service.tick();
    await r.admin.quiet(100);
    expect(frames(r.admin)).toBe(before);
  });
});

describe("el fin del movimiento lo decide el servidor por el reloj", () => {
  it("al llegar, el plan se cierra, los pies quedan en el destino y se anuncia y guarda una sola vez", async () => {
    const r = await running();
    const target = station(0);
    await r.ana.adventure({ type: "player.moveTo", target });
    const plan = state(r.code).adventure.player.plan!;
    const snapshots = r.admin.snapshots.length;
    const version = state(r.code).stateVersion;
    now += Math.ceil((plan.lengthTotal / plan.speed) * 1000) - 200;
    await server.app.service.tick();
    expect(state(r.code).adventure.player.plan).not.toBeNull(); // aún no llega
    now += 400;
    await server.app.service.tick();
    await r.admin.until(() => r.admin.snapshots.length > snapshots, "snapshot del fin del movimiento");
    const done = state(r.code);
    expect(done.adventure.player.plan).toBeNull();
    expect(done.adventure.player.feet).toEqual(target);
    expect(done.stateVersion).toBe(version + 1);
    expect(persisted(r.code).adventure.player.feet).toEqual(target); // durable
    await server.app.service.tick(); // un paso más no repite nada
    await r.admin.quiet(80);
    expect(r.admin.snapshots.length).toBe(snapshots + 1);
    expect(state(r.code).stateVersion).toBe(version + 1);
  });

  it("abrir la mesa tras llegar cumple la proximidad con la posición ya decidida por el servidor", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(0) });
    expect(await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "map" })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // todavía lejos
    now += 60_000;
    expect(await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "map" })).toMatchObject({ ok: true });
    expect(state(r.code).adventure.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("si SQLite rechaza el guardado no se anuncia el final del movimiento y se reintenta al recuperarse", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(0) });
    now += 60_000;
    const before = r.admin.snapshots.length;
    server.app.repo.raw.pragma("query_only = ON");
    await server.app.service.tick();
    await r.admin.quiet(80);
    expect(r.admin.snapshots.length).toBe(before);
    expect(state(r.code).adventure.player.plan).not.toBeNull();
    server.app.repo.raw.pragma("query_only = OFF");
    await server.app.service.tick();
    await r.admin.until(() => r.admin.snapshots.length === before + 1, "fin del movimiento tras recuperarse");
    expect(state(r.code).adventure.player.plan).toBeNull();
  });
});

describe("checkpoints de reloj y posición (SPECS 6.1)", () => {
  it("se guardan cada ~500 ms sin subir stateVersion ni anunciarse, y no crean filas de comandos", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(2) });
    const version = state(r.code).stateVersion;
    const snapshots = r.admin.snapshots.length;
    const commands = () => (server.app.repo.raw.prepare("SELECT COUNT(*) AS n FROM processed_commands").get() as { n: number }).n;
    const rows = commands();
    now += 300;
    await server.app.service.tick();
    expect(persisted(r.code).adventure.timeline.activeMs).toBe(0); // todavía no toca checkpoint
    now += 300;
    await server.app.service.tick();
    expect(persisted(r.code).adventure.timeline.activeMs).toBe(600);
    now += 600;
    await server.app.service.tick();
    expect(persisted(r.code).adventure.timeline.activeMs).toBe(1200);
    await r.admin.quiet(80);
    expect(state(r.code).stateVersion).toBe(version);
    expect(r.admin.snapshots.length).toBe(snapshots);
    expect(commands()).toBe(rows);
  });

  it("tras una caída abrupta el movimiento retrocede como máximo un intervalo de checkpoint y lo confirmado se conserva", async () => {
    const r = await running();
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" }); // algo confirmado antes
    await r.ana.adventure({ type: "adventure.returnToMap" });
    await r.ana.adventure({ type: "player.moveTo", target: station(2) });
    now += 700;
    await server.app.service.tick(); // checkpoint a los 700 ms
    now += 300; // 300 ms más sin checkpoint: se pierden en la caída
    // Caída abrupta: lo único que sobrevive es lo que había en el disco. Se toma una copia consistente de ese instante (cerrar los
    // clientes primero dispararía la pausa por desconexión, que guarda el instante exacto: eso es un cierre ordenado, no una caída).
    const crashDir = mkdtempSync(join(tmpdir(), "laboratorio-crash-"));
    await server.app.repo.raw.backup(join(crashDir, "test.sqlite"));
    for (const c of clients.splice(0)) c.close();
    await server.stop();

    now = 500_000; // el servidor estuvo apagado un buen rato
    server = await startServer({ dir: crashDir, mono: () => now, settings: { tickIntervalMs: 0 } });
    const recovered = state(r.code);
    expect(recovered).toMatchObject({ phase: "paused", controlOwner: null });
    expect(recovered.adventure.timeline.activeMs).toBe(700); // el último checkpoint, sin sumar el tiempo apagado
    expect(1000 - recovered.adventure.timeline.activeMs).toBeLessThanOrEqual(500);
    expect(recovered.adventure.player.plan).not.toBeNull(); // el plan sigue siendo el mismo y se retoma desde ese instante
    expect(recovered.adventure.view).toEqual({ kind: "map" });
  });
});

describe("pausa, reanudación y cambio de turno con algo en movimiento", () => {
  it("pausar congela el movimiento y reanudar no suma el tiempo de la conversación (CA-11 para el movimiento)", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(2) });
    now += 1000;
    expect(await r.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    expect(state(r.code).adventure.timeline.activeMs).toBe(1000);
    const frozen = playerAt(state(r.code).adventure, state(r.code).adventure.timeline.activeMs).feet;
    now += 60_000; // un minuto hablando
    await server.app.service.tick();
    expect(state(r.code).adventure.timeline.activeMs).toBe(1000);
    expect(await r.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    now += 500;
    await server.app.service.tick();
    expect(state(r.code).adventure.timeline.activeMs).toBe(1500);
    const moved = playerAt(state(r.code).adventure, 1500).feet;
    expect(moved).not.toEqual(frozen);
    expect(Math.hypot(moved.x - frozen.x, moved.y - frozen.y)).toBeCloseTo(75, 0); // 500 ms a 150 u/s
  });

  it("pausar en mitad de una prueba de rampa congela su tiempo; reanudar no añade la conversación, y termina en su instante exacto (CA-11)", async () => {
    const r = await running(["Ana", "Beto"]);
    const ana = r.ana;
    const ok = async (a: Parameters<TestClient["adventure"]>[0]) => expect(await ana.adventure(a), JSON.stringify(a)).toMatchObject({ ok: true });
    await ok({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await ok({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    await ok({ type: "shadows.light.set", distanceCm: 15, commitSample: true });
    await ok({ type: "shadows.light.set", distanceCm: 45, commitSample: true });
    await ok({ type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "uncertain" } });
    await ok({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } });
    await ok({ type: "adventure.returnToMap" });
    await ok({ type: "station.open", stationId: "rampas", origin: "quickNav" });
    await ok({ type: "ramps.question.open" });
    await ok({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    await ok({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } });
    await ok({ type: "ramps.angle.set", angleDeg: 15 });
    await ok({ type: "ramps.trial.start" });
    const trial = () => (state(r.code).adventure.activities.rampas as { trials: Array<{ state: string; durationMs: number; startActiveMs: number; endedActiveMs?: number }> }).trials[0]!;
    const duration = trial().durationMs;

    now += 1000;
    await r.admin.admin({ type: "room.pause" });
    expect(state(r.code).adventure.timeline.activeMs - trial().startActiveMs).toBe(1000);
    now += 90_000; // charla larga: no cuenta
    await server.app.service.tick();
    expect(trial().state).toBe("running");
    await r.admin.admin({ type: "room.resume" });
    now += 500;
    await server.app.service.tick();
    await r.admin.until(() => frames(r.admin) >= 1, "frame con la prueba en marcha");
    expect(state(r.code).adventure.timeline.activeMs - trial().startActiveMs).toBe(1500); // 1000 + 500, sin los 90 s
    expect(trial().state).toBe("running");
    now += duration; // pasa de sobra el final
    await server.app.service.tick();
    expect(trial()).toMatchObject({ state: "finished", endedActiveMs: trial().startActiveMs + duration });
  });

  it("cambiar de controlador en pleno movimiento conserva plan y posición; el nuevo recibe los frames y el anterior deja de recibirlos", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(2) });
    const plan = state(r.code).adventure.player.plan!;
    now += 600;
    await server.app.service.tick();
    await r.ana.until(() => frames(r.ana) >= 1, "Ana ve su primer frame");
    expect(await r.admin.admin({ type: "control.assign", principalId: r.betoId })).toMatchObject({ ok: true });
    await r.beto.until(() => r.beto.summary?.self.isController === true && r.beto.snapshots.length > 0, "Beto recibe el control");
    expect(r.beto.snapshots.at(-1)!.state.adventure.player.plan).toMatchObject({ planId: plan.planId, startActiveMs: plan.startActiveMs });
    const anaFrames = frames(r.ana);
    now += 400;
    await server.app.service.tick();
    await r.beto.until(() => frames(r.beto) >= 1, "Beto recibe frames del mismo plan");
    await r.ana.quiet(100);
    expect(frames(r.ana)).toBe(anaFrames);
    // La acción del controlador anterior llega tarde y se rechaza sin tocar el movimiento.
    expect(await r.ana.adventure({ type: "player.moveTo", target: station(0) })).toMatchObject({ ok: false });
    expect(state(r.code).adventure.player.plan!.planId).toBe(plan.planId);
  });

  it("un destino nuevo a mitad de camino parte de la posición interpolada y el viejo plan se descarta", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(2) });
    now += 800;
    const here = playerAt(state(r.code).adventure, 800).feet;
    // Los 800 ms recién corridos solo existen para el servidor al procesar el siguiente comando.
    expect(await r.ana.adventure({ type: "player.moveTo", target: station(0) })).toMatchObject({ ok: true });
    const plan = state(r.code).adventure.player.plan!;
    expect(plan.planId).toBe("m2");
    expect(plan.points[0]!.x).toBeCloseTo(here.x, 3);
    expect(plan.points[0]!.y).toBeCloseTo(here.y, 3);
    expect(plan.startActiveMs).toBe(800);
  });

  it("rechaza con una explicación un destino dentro de una pared y no cambia el movimiento en curso", async () => {
    const r = await running();
    await r.ana.adventure({ type: "player.moveTo", target: station(1) });
    const plan = state(r.code).adventure.player.plan!;
    const wall = await r.ana.adventure({ type: "player.moveTo", target: { x: 640, y: 100 } });
    expect(wall).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(wall.ok === false && wall.message).toContain("no se puede pisar");
    expect(await r.ana.adventure({ type: "player.moveTo", target: { x: -50, y: 200 } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(state(r.code).adventure.player.plan!.planId).toBe(plan.planId);
  });
});

void createRoom;
void joinRoom;
