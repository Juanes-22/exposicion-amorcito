import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomState } from "../../shared/contracts/state";
import { playerAt } from "../../shared/domain/participant";
import { beginExploration, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

// SPECS 5.6 con participación simultánea: el servidor es dueño del reloj de simulación. Cada persona tiene su plan de movimiento y sus
// pruebas de rampa; el final de una prueba lo decide el servidor, una sola vez; todas las personas reciben el reloj y cada una, solo lo suyo.

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

const state = (code: string): RoomState => server.app.service.inspect(code)!.state;
const persisted = (code: string): RoomState => server.app.repo.loadRooms().rooms.find((r) => r.state.code === code)!.state;
const station = (i: number) => server.app.project.map.stations[i]!.point;
const clocks = (c: TestClient) => c.count("clock.sample");

async function exploring(names = ["Ana", "Beto", "Cata"], options: { observers?: string[] } = {}) {
  const r = await setupRoom(server, names, options);
  for (const c of r.clients) track(c);
  await beginExploration(r);
  const ids = r.people.map((p) => p.join.principalId);
  return { ...r, ids, cs: r.people.map((p) => p.client) };
}

describe("el reloj de simulación llega a todas las personas", () => {
  it("mientras alguien camina, todas (incluidas las observadoras) reciben muestras del reloj; nadie recibe pruebas ajenas", async () => {
    const r = await exploring(["Ana", "Beto"], { observers: ["Vero"] });
    const [ana, beto] = r.cs as [TestClient, TestClient];
    const vero = r.observers[0]!.client;
    await ana.quiet(60);
    const before = { ana: clocks(ana), beto: clocks(beto), vero: clocks(vero), admin: clocks(r.admin) };
    await ana.act({ type: "player.moveTo", target: station(1) });
    now += 600;
    await server.app.service.tick();
    for (const c of [ana, beto, vero, r.admin]) await c.until(() => clocks(c) > (c === ana ? before.ana + 1 : c === beto ? before.beto : c === vero ? before.vero : before.admin), "muestra del reloj");
    // Las muestras no llevan nada personal.
    expect(JSON.stringify(vero.clocks)).not.toMatch(/trial|activities|samples/);
  });

  it("cada muestra lleva generación, versión, secuencia creciente y el tiempo vivo del servidor", async () => {
    const r = await exploring(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.act({ type: "player.moveTo", target: station(2) });
    const got: Array<{ seq: number; activeMs: number; running: boolean; roomGeneration: number }> = [];
    r.admin.socket.on("clock.sample", (c) => got.push({ seq: c.seq, activeMs: c.activeMs, running: c.running, roomGeneration: c.roomGeneration }));
    const base = state(r.code).adventure.timeline.activeMs;
    for (let i = 0; i < 3; i++) {
      now += 600;
      await server.app.service.tick();
    }
    await r.admin.until(() => got.length >= 3, "tres muestras");
    expect(got.map((g) => g.seq)).toEqual([...got.map((g) => g.seq)].sort((a, b) => a - b));
    expect(new Set(got.map((g) => g.seq)).size).toBe(got.length);
    expect(got.map((g) => g.activeMs).slice(-3)).toEqual([base + 600, base + 1200, base + 1800].map((x) => expect.closeTo(x, -1) as unknown as number));
    expect(got.every((g) => g.running && g.roomGeneration === 1)).toBe(true);
  });

  it("no hay muestras si no se mueve nada ni en pausa", async () => {
    const r = await exploring(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.quiet(60);
    const idle = clocks(ana);
    now += 600;
    await server.app.service.tick();
    await ana.quiet(80);
    expect(clocks(ana)).toBe(idle); // nada que simular: el servidor no escribe ni emite
    await ana.act({ type: "player.moveTo", target: station(0) });
    await r.admin.admin({ type: "room.pause" });
    await ana.quiet(60);
    const paused = clocks(ana);
    now += 600;
    await server.app.service.tick();
    await ana.quiet(80);
    expect(clocks(ana)).toBe(paused);
  });
});

describe("el movimiento de cada persona se calcula desde su plan y el reloj", () => {
  it("una persona al llegar no genera escritura ni anuncios: el plan terminado se interpreta, no se guarda cada vez", async () => {
    const r = await exploring(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.act({ type: "player.moveTo", target: station(0) });
    const plan = state(r.code).participants[r.ids[0]!]!.character.plan!;
    const done = Math.ceil((plan.lengthTotal / plan.speed) * 1000);
    now += done + 500;
    await server.app.service.tick();
    const version = state(r.code).stateVersion;
    await server.app.service.tick();
    await server.app.service.tick();
    expect(state(r.code).stateVersion).toBe(version);
    const here = playerAt(state(r.code).participants[r.ids[0]!]!.character, state(r.code).adventure.timeline.activeMs + done);
    expect(here).toMatchObject({ moving: false, feet: plan.points.at(-1) });
  });

  it("abrir la mesa tocándola cumple la proximidad con la posición que decide el servidor", async () => {
    const r = await exploring(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.act({ type: "player.moveTo", target: station(0) });
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "map" })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // todavía lejos
    now += 60_000;
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "map" })).toMatchObject({ ok: true });
    expect(state(r.code).participants[r.ids[0]!]!.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("dos personas caminan al mismo tiempo cada una por su plan y las demás ven a ambas", async () => {
    const r = await exploring(["Ana", "Beto", "Cata"]);
    const [ana, beto, cata] = r.cs as [TestClient, TestClient, TestClient];
    await Promise.all([ana.act({ type: "player.moveTo", target: station(0) }), beto.act({ type: "player.moveTo", target: station(2) })]);
    await cata.until(() => cata.characters.get(r.ids[0]!)?.character.plan !== null && cata.characters.get(r.ids[1]!)?.character.plan !== null, "Cata ve caminar a las dos");
    const [a, b] = [r.ids[0]!, r.ids[1]!].map((id) => cata.characters.get(id)!.character.plan!.planId);
    expect(a).not.toBe(b);
  });
});

describe("el fin de una prueba de rampa lo decide el servidor por el reloj", () => {
  async function rampsRoom(names = ["Ana", "Beto"]) {
    const r = await setupRoom(server, names);
    for (const c of r.clients) track(c);
    await r.admin.admin({ type: "room.start" });
    await r.admin.admin({ type: "round.open" });
    await r.admin.admin({ type: "round.converse", withPending: true });
    await r.admin.admin({ type: "round.next" });
    const open = await r.admin.admin({ type: "round.open" });
    if (!open.ok) throw new Error(open.message);
    const cs = r.people.map((p) => p.client);
    for (const c of cs) await c.until(() => c.roundVersion >= open.roundVersion, "ronda de Rampas");
    for (const c of cs) await c.act({ type: "station.open", stationId: "rampas", origin: "quickNav" });
    return { ...r, cs, ids: r.people.map((p) => p.join.principalId) };
  }
  const trial = (r: Awaited<ReturnType<typeof rampsRoom>>, i: number, n = 0) => (state(r.code).participants[r.ids[i]!]!.activities.rampas as { trials: Array<{ state: string; startActiveMs: number; durationMs: number; endedActiveMs?: number }> }).trials[n]!;

  it("al cumplirse su hora la prueba termina una sola vez, se guarda y se avisa solo a su dueña", async () => {
    const r = await rampsRoom();
    const [ana, beto] = r.cs as [TestClient, TestClient];
    await ana.act({ type: "ramps.trial.start", angleDeg: 20 });
    const t0 = trial(r, 0);
    now += t0.durationMs - 100;
    await server.app.service.tick();
    expect(trial(r, 0).state).toBe("running");
    const version = state(r.code).stateVersion;
    const anaMes = ana.mes.length;
    const betoMes = beto.mes.length;
    now += 200;
    await server.app.service.tick();
    await ana.until(() => ana.mes.length > anaMes, "Ana recibe su resultado");
    expect(trial(r, 0).state).toBe("finished");
    expect(trial(r, 0).endedActiveMs! - trial(r, 0).startActiveMs).toBeCloseTo(t0.durationMs, 6); // en su instante exacto
    expect(state(r.code).stateVersion).toBe(version + 1);
    expect(persisted(r.code).participants[r.ids[0]!]!.activities.rampas).toEqual(state(r.code).participants[r.ids[0]!]!.activities.rampas); // durable
    await beto.quiet(80);
    expect(beto.mes.length).toBe(betoMes); // Beto no recibe nada del resultado de Ana
    await server.app.service.tick();
    expect(state(r.code).stateVersion).toBe(version + 1); // un paso más no repite nada
  });

  it("la pausa conserva el avance de la prueba sin sumar el tiempo de conversación: reanudar la termina a su hora exacta", async () => {
    const r = await rampsRoom(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.act({ type: "ramps.trial.start", angleDeg: 40 });
    const t0 = trial(r, 0);
    now += 1000;
    await r.admin.admin({ type: "room.pause" });
    const frozen = state(r.code).adventure.timeline.activeMs;
    now += 60_000; // un minuto de conversación en pausa
    await server.app.service.tick();
    expect(state(r.code).adventure.timeline.activeMs).toBe(frozen); // el reloj de simulación quedó quieto
    expect(trial(r, 0).state).toBe("running");
    await r.admin.admin({ type: "room.resume" });
    now += t0.durationMs - 1000 - 50;
    await server.app.service.tick();
    expect(trial(r, 0).state).toBe("running");
    now += 100;
    await server.app.service.tick();
    expect(trial(r, 0).state).toBe("finished");
    expect(trial(r, 0).endedActiveMs! - trial(r, 0).startActiveMs).toBeCloseTo(t0.durationMs, 6);
  });

  it("si no se puede guardar el fin de una prueba no se anuncia y se reintenta en el siguiente paso", async () => {
    const r = await rampsRoom(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.act({ type: "ramps.trial.start", angleDeg: 20 });
    await ana.quiet(60);
    now += trial(r, 0).durationMs + 100;
    const mes = ana.mes.length;
    server.app.repo.raw.pragma("query_only = ON");
    await server.app.service.tick();
    expect(trial(r, 0).state).toBe("running");
    await ana.quiet(80);
    expect(ana.mes.length).toBe(mes);
    server.app.repo.raw.pragma("query_only = OFF");
    await server.app.service.tick();
    expect(trial(r, 0).state).toBe("finished");
    await ana.until(() => ana.mes.length > mes, "Ana recibe el resultado tras reintentar");
  });

  it("mientras algo está en movimiento se guarda un checkpoint del reloj sin cambiar de versión ni anunciar", async () => {
    const r = await rampsRoom(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await ana.act({ type: "ramps.trial.start", angleDeg: 20 });
    const version = state(r.code).stateVersion;
    now += 700; // pasa del intervalo de checkpoint (500 ms) sin llegar al final de la prueba
    await server.app.service.tick();
    expect(state(r.code).stateVersion).toBe(version);
    expect(persisted(r.code).adventure.timeline.activeMs).toBe(state(r.code).adventure.timeline.activeMs);
    expect(persisted(r.code).adventure.timeline.activeMs).toBeGreaterThan(0);
  });
});
