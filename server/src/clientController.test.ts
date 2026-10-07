import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminCommand, ParticipantCommand } from "../../shared/contracts/actions";
import type { ClockSample } from "../../shared/contracts/events";
import type { ShadowsState } from "../../shared/contracts/state";
import { RoomController, shouldAcceptClock } from "../../src/app/RoomController";
import { createRoom, folderOf, joinRoom, startServer, type TestServer } from "./testing/harness";

// El cliente real (`RoomController`) contra un servidor real en proceso. Con participación simultánea cada pantalla recibe lo suyo:
// Vanessa, la presencia con el contador de la ronda; cada persona, SU estado personal y los personajes de todas; quien observa, solo el
// grupo. El reloj de simulación del servidor es el inyectado (`now`) y el bucle no corre solo: las pruebas llaman a `tick()`.

let server: TestServer;
let now = 10_000;
const controllers: RoomController[] = [];
const serverSettings = { tickIntervalMs: 0, sweepIntervalMs: 0 };
const make = (token: string, options?: ConstructorParameters<typeof RoomController>[2], url = server.url) => {
  const c = new RoomController(url, token, options);
  controllers.push(c);
  c.connect();
  return c;
};
const until = async (cond: () => boolean, what: string, ms = 5000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  now = 10_000;
  server = await startServer({ mono: () => now, settings: serverSettings });
});
afterEach(async () => {
  vi.useRealTimers();
  for (const c of controllers.splice(0)) c.dispose();
  await server.stop();
});

const state = (code: string) => server.app.service.inspect(code)!.state;
const station = (i: number) => server.app.project.map.stations[i]!.point;
/** Posiciones de la linterna que una persona tiene registradas en Sombras, según SU estado personal. */
const samplesOf = (c: RoomController): number[] => (c.getState().me?.participant.activities.sombras as ShadowsState | undefined)?.samples.map((s) => s.distanceCm) ?? [];

interface Person {
  c: RoomController;
  id: string;
  token: string;
}

/** Una sala con la administradora y las personas indicadas (más observadoras), todas con su resumen y su estado completo. */
async function room(names = ["Ana", "Beto"], observers: string[] = []) {
  const created = await createRoom(server.url);
  const code = created.body.code;
  const admin = make(created.body.adminToken);
  await until(() => admin.getState().summary !== null, "resumen de la administradora");
  const join = async (name: string, observer: boolean): Promise<Person> => {
    const j = await joinRoom(server.url, code, name, "azul", observer);
    const c = make(j.body.token);
    // Quien juega recibe su estado personal al final de la sincronización; quien observa, el grupo.
    await until(() => (observer ? c.getState().group !== null : c.getState().me !== null), `estado completo de ${name}`);
    return { c, id: j.body.principalId, token: j.body.token };
  };
  const people: Person[] = [];
  for (const n of names) people.push(await join(n, false));
  const watchers: Person[] = [];
  for (const n of observers) watchers.push(await join(n, true));
  await until(() => admin.getState().presence?.connectedCount === names.length + observers.length, "presencia completa");
  return { admin, people, observers: watchers, code, adminToken: created.body.adminToken };
}
type Room = Awaited<ReturnType<typeof room>>;

/** Comienza y abre la mesa de Sombras: todas las pantallas conocen la ronda en exploración. */
async function explore(r: Room) {
  expect(await r.admin.admin({ type: "room.start" })).toMatchObject({ ok: true });
  const open = await r.admin.admin({ type: "round.open" });
  expect(open).toMatchObject({ ok: true });
  for (const p of [...r.people, ...r.observers]) await until(() => p.c.getState().group?.adventure.round.stage === "exploration" && p.c.getState().summary?.roundVersion === state(r.code).roundVersion, `exploración visible para ${p.id}`);
}

describe("RoomController: qué recibe cada pantalla (CA-02, CA-04, CA-05)", () => {
  it("cada persona recibe SU estado personal y los personajes de todas, y nada de las pruebas de las demás", async () => {
    const r = await room(["Ana", "Beto"]);
    const [ana, beto] = r.people as [Person, Person];
    await explore(r);
    expect(ana.c.getState().summary!.self).toMatchObject({ role: "participant", observer: false, displayName: "Ana" });
    for (const c of [ana.c, beto.c, r.admin]) await until(() => Object.keys(c.getState().characters).length === 2, "los personajes de todas");
    expect(Object.values(ana.c.getState().characters).map((x) => x.displayName).sort()).toEqual(["Ana", "Beto"]);
    // El personaje que cada persona ve de sí misma es el de su estado personal: lo mismo que ven las demás.
    expect(ana.c.getState().characters[ana.id]!.character).toEqual(ana.c.getState().me!.participant.character);
    expect(beto.c.getState().characters[beto.id]!.character).toEqual(beto.c.getState().me!.participant.character);
    expect(beto.c.getState().characters[ana.id]!.character).toEqual(ana.c.getState().me!.participant.character);

    expect(await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(await ana.c.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: true });
    await until(() => samplesOf(ana.c).length === 1, "Ana recibe su muestra");
    await pause(120);
    // Beto no recibió nada de la exploración de Ana, aunque sí ve sus movimientos en `characters`.
    expect(samplesOf(beto.c)).toEqual([]);
    expect(beto.c.getState().me!.participant.view).toEqual({ kind: "map" });
    expect(JSON.stringify(beto.c.getState())).not.toContain('"distanceCm":20');
    for (const c of [ana.c, beto.c, r.admin]) expect(JSON.stringify(Object.values(c.getState().characters))).not.toMatch(/activities|samples|trials/);
    expect(r.admin.getState().me).toBeNull(); // Vanessa no juega: no tiene estado personal
  });

  it("los movimientos de una persona los ven todas, y su personaje se actualiza sin tocar el estado de las demás", async () => {
    const r = await room(["Ana", "Beto"]);
    const [ana, beto] = r.people as [Person, Person];
    await explore(r);
    await until(() => beto.c.getState().characters[ana.id] !== undefined, "Beto conoce a Ana");
    expect(beto.c.getState().characters[ana.id]!.character.plan).toBeNull();
    const betoBefore = beto.c.getState().me;
    expect(await ana.c.act({ type: "player.moveTo", target: station(1) })).toMatchObject({ ok: true });
    await until(() => beto.c.getState().characters[ana.id]!.character.plan !== null, "Beto ve caminar a Ana");
    await until(() => r.admin.getState().characters[ana.id]?.character.plan !== null, "la proyección ve caminar a Ana");
    expect(beto.c.getState().me).toBe(betoBefore); // su propio estado personal ni se tocó
    expect(ana.c.getState().me!.participant.character.plan).toEqual(beto.c.getState().characters[ana.id]!.character.plan);
  });

  it("quien acompaña como observadora recibe el resumen, el grupo y los personajes, pero ningún estado personal, y no puede actuar", async () => {
    const r = await room(["Ana"], ["Vero"]);
    const [ana] = r.people as [Person];
    const [vero] = r.observers as [Person];
    expect(vero.c.getState().summary!.self).toMatchObject({ role: "participant", observer: true });
    await explore(r);
    await until(() => vero.c.getState().characters[ana.id] !== undefined, "Vero ve a Ana");
    expect(vero.c.getState().me).toBeNull();
    expect(vero.c.getState().presence).toBeNull();
    const denied = await vero.c.act({ type: "player.moveTo", target: station(0) });
    expect(denied).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(vero.c.getState().pending).toBe(0);
    expect(vero.c.getState().notice).toMatchObject({ kind: "error", text: denied.ok ? "" : denied.message });
    // Ni siquiera al pedir de nuevo el estado: un observador no tiene estado personal que recibir.
    vero.c.sync();
    await pause(150);
    expect(vero.c.getState().me).toBeNull();
    expect(state(r.code).participants[vero.id]).toBeUndefined();
    expect(r.admin.getState().presence!.round).toEqual({ ready: 0, total: 1 }); // y no cuenta en la ronda
  });

  it("solo la administradora recibe la presencia con el contador de la ronda; el resto de pantallas no", async () => {
    const r = await room(["Ana", "Beto"], ["Vero"]);
    const [ana, beto] = r.people as [Person, Person];
    await explore(r);
    await until(() => r.admin.getState().presence?.round.total === 2, "contador de la ronda");
    expect(r.admin.getState().presence).toMatchObject({ connectedCount: 3, round: { ready: 0, total: 2 } });
    expect(await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(await ana.c.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: true });
    expect(await ana.c.act({ type: "shadows.sample", distanceCm: 50 })).toMatchObject({ ok: true });
    await until(() => r.admin.getState().presence?.round.ready === 1, "1 de 2 listos");
    expect(r.admin.getState().presence!.round).toEqual({ ready: 1, total: 2 });
    const byName = (n: string) => r.admin.getState().presence!.participants.find((p) => p.displayName === n)!;
    expect([byName("Ana").ready, byName("Ana").progress]).toEqual([true, { done: 2, needed: 2 }]);
    expect(byName("Beto").ready).toBe(false);
    expect(byName("Vero")).toMatchObject({ observer: true, inRound: false });
    for (const p of [ana, beto, ...r.observers]) expect(p.c.getState().presence).toBeNull();
    expect(JSON.stringify([ana, beto].map((p) => p.c.getState()))).not.toContain('"connectedCount"');
  });
});

describe("RoomController: comandos", () => {
  it("construye el sobre con la generación, el epoch y un commandSeq creciente (Vanessa) o la versión de ronda vigente (cada persona), y refleja el resultado", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    const service = server.app.service;
    const seenAdmin: AdminCommand[] = [];
    const seenPersonal: ParticipantCommand[] = [];
    const adminOriginal = service.adminCommand.bind(service);
    const personalOriginal = service.participantCommand.bind(service);
    service.adminCommand = (identity, socketId, cmd) => (seenAdmin.push(cmd), adminOriginal(identity, socketId, cmd));
    service.participantCommand = (identity, socketId, cmd) => (seenPersonal.push(cmd), personalOriginal(identity, socketId, cmd));

    await explore(r);
    expect(seenAdmin.map((c) => [c.action.type, c.commandSeq])).toEqual([["room.start", 1], ["round.open", 2]]);
    expect(new Set(seenAdmin.map((c) => c.requestId)).size).toBe(2);
    for (const c of seenAdmin) expect(c).toMatchObject({ roomGeneration: 1, connectionEpoch: r.admin.getState().summary!.self.connectionEpoch });

    expect(await ana.c.act({ type: "player.moveTo", target: station(0) })).toMatchObject({ ok: true });
    expect(seenPersonal).toHaveLength(1);
    expect(seenPersonal[0]).toMatchObject({ roomGeneration: 1, connectionEpoch: ana.c.getState().summary!.self.connectionEpoch, roundVersion: state(r.code).roundVersion });
    expect(seenPersonal[0]).not.toHaveProperty("commandSeq"); // el contador es solo de Vanessa
    expect(ana.c.getState().pending).toBe(0);

    // Cuando la ronda cambia, la persona envía la versión nueva: su siguiente acción se rechaza por el momento, no por llegar tarde.
    expect(await r.admin.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: true });
    await until(() => ana.c.getState().summary?.roundVersion === state(r.code).roundVersion, "Ana conoce la ronda nueva");
    const late = await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(late).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(seenPersonal.at(-1)!.roundVersion).toBe(state(r.code).roundVersion);
    await until(() => r.admin.getState().summary?.phase === "running" && r.admin.getState().group?.adventure.round.stage === "conversation", "Vanessa ve la conversación");
  });

  it("una denegación se devuelve, se avisa (aunque el texto se repita) y no deja nada bloqueado", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    const denied = await ana.c.admin({ type: "room.pause" });
    expect(denied).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(ana.c.getState().pending).toBe(0);
    expect(ana.c.getState().notice).toMatchObject({ kind: "error" });
    // Una acción personal fuera de lugar (la aventura no ha comenzado) también se explica con el texto del servidor.
    const first = await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(first).toMatchObject({ ok: false, code: "INVALID_STEP" });
    const firstNotice = ana.c.getState().notice!;
    expect(firstNotice).toMatchObject({ kind: "error", text: first.ok ? "" : first.message });
    await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(ana.c.getState().notice!.text).toBe(firstNotice.text);
    expect(ana.c.getState().notice!.id).toBeGreaterThan(firstNotice.id); // el mismo texto se anuncia otra vez
    expect(ana.c.getState().pending).toBe(0);
    expect((await r.admin.admin({ type: "room.start" })).ok).toBe(true); // y Vanessa sigue conduciendo
  });

  it("reintenta el MISMO comando con el MISMO ID si se pierde el acknowledgment, y el servidor lo aplica una sola vez", async () => {
    const created = await createRoom(server.url);
    const j = await joinRoom(server.url, created.body.code, "Ana");
    const admin = make(created.body.adminToken, { ackTimeoutMs: 120 });
    const ana = make(j.body.token, { ackTimeoutMs: 120 });
    await until(() => admin.getState().presence?.connectedCount === 1 && ana.getState().me !== null, "Ana conectada");
    // El servidor procesa la orden pero tarda en contestar: el cliente agota su plazo y reintenta con el mismo requestId.
    const service = server.app.service;
    const adminOriginal = service.adminCommand.bind(service);
    const personalOriginal = service.participantCommand.bind(service);
    const seenAdmin: string[] = [];
    const seenPersonal: string[] = [];
    service.adminCommand = async (identity, socketId, cmd) => {
      seenAdmin.push(cmd.requestId);
      const result = await adminOriginal(identity, socketId, cmd);
      if (seenAdmin.length === 1) await pause(400); // acknowledgment «perdido» (llega tarde)
      return result;
    };
    service.participantCommand = async (identity, socketId, cmd) => {
      seenPersonal.push(cmd.requestId);
      const result = await personalOriginal(identity, socketId, cmd);
      if (seenPersonal.length === 1) await pause(400);
      return result;
    };

    const v0 = state(created.body.code).stateVersion;
    expect(await admin.admin({ type: "room.start" })).toMatchObject({ ok: true });
    expect(seenAdmin.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seenAdmin).size).toBe(1); // todos los intentos con el mismo ID
    expect(state(created.body.code).stateVersion).toBe(v0 + 1); // una sola mutación
    expect((await admin.admin({ type: "round.open" })).ok).toBe(true);
    await until(() => ana.getState().group?.adventure.round.stage === "exploration" && ana.getState().summary?.roundVersion === state(created.body.code).roundVersion, "Ana ve la exploración");

    const v1 = state(created.body.code).stateVersion;
    expect(await ana.act({ type: "player.moveTo", target: station(0) })).toMatchObject({ ok: true });
    expect(seenPersonal.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seenPersonal).size).toBe(1);
    expect(state(created.body.code).stateVersion).toBe(v1 + 1);
    expect(state(created.body.code).adventure.counters.plan).toBe(1); // un solo trayecto, no uno por intento
    expect(ana.getState().pending).toBe(0);
  });

  it("si el servidor no contesta nunca, se rinde tras el intento inicial y dos reintentos, sin dejar nada bloqueado", async () => {
    const created = await createRoom(server.url);
    const admin = make(created.body.adminToken, { ackTimeoutMs: 60 });
    await until(() => admin.getState().summary !== null, "resumen");
    const seen: string[] = [];
    server.app.service.adminCommand = () => (seen.push("intento"), new Promise(() => undefined)); // jamás responde
    const result = await admin.admin({ type: "room.start" });
    expect(result).toMatchObject({ ok: false, code: "STALE_CONNECTION", message: expect.stringMatching(/no respondió/) });
    expect(seen).toHaveLength(3);
    expect(admin.getState().pending).toBe(0);
  });

  it("sin resumen todavía no hay conexión con la sala: no se envía nada", async () => {
    const created = await createRoom(server.url);
    const c = new RoomController(server.url, created.body.adminToken); // sin `connect()`
    controllers.push(c);
    expect(await c.admin({ type: "room.start" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await c.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(c.getState()).toMatchObject({ status: "connecting", pending: 0, notice: null });
    c.sync(); // sin conexión tampoco pide nada ni falla
    expect(state(created.body.code).phase).toBe("welcome");
  });

  it("los avisos tienen identidad propia: retirar uno viejo no borra el nuevo", () => {
    const c = new RoomController(server.url, "x".repeat(43));
    controllers.push(c);
    let renders = 0;
    c.subscribe(() => void renders++);
    c.notify("info", "Hola");
    const a = c.getState().notice!;
    c.notify("info", "Hola");
    const b = c.getState().notice!;
    expect(b.id).toBeGreaterThan(a.id);
    c.clearNotice(a.id); // el aviso viejo ya se había sustituido
    expect(c.getState().notice).toEqual(b);
    c.clearNotice(b.id);
    expect(c.getState().notice).toBeNull();
    expect(renders).toBe(3); // dos avisos y un solo retiro efectivo
  });

  it("la administradora envía su señal de actividad cada 30 s y las participantes no", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); // solo el latido propio: los temporizadores de la red siguen reales
    const seen: string[] = [];
    const service = server.app.service;
    const original = service.adminActivity.bind(service);
    service.adminActivity = (identity, socketId) => (seen.push(identity.role), original(identity, socketId));
    const r = await room(["Ana"]);
    void r;
    vi.advanceTimersByTime(29_000);
    await pause(60);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1_000);
    await until(() => seen.length === 1, "primera señal");
    vi.advanceTimersByTime(30_000);
    await until(() => seen.length === 2, "segunda señal");
    await pause(60);
    expect(seen).toEqual(["admin", "admin"]); // Ana tiene el mismo latido pero no envía nada
  });
});

describe("RoomController: reloj de simulación (CT-06)", () => {
  it("al conectar llega UNA muestra con el reloj quieto, y en bienvenida no llegan más por mucho tiempo que pase", async () => {
    const created = await createRoom(server.url);
    const admin = new RoomController(server.url, created.body.adminToken);
    controllers.push(admin);
    const samples: ClockSample[] = [];
    admin.subscribeClock((s) => samples.push(s));
    admin.connect();
    await until(() => samples.length === 1, "la muestra de la conexión");
    expect(samples[0]).toMatchObject({ roomGeneration: 1, running: false, activeMs: 0 });
    // Sala en bienvenida: nada se mueve y no se emite nada más.
    now += 5_000;
    await server.app.service.tick();
    await pause(300);
    expect(samples).toHaveLength(1);
  });

  it("durante un trayecto llegan muchas muestras pero NINGUNA avisa al estado observable de React", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    await explore(r);
    const samples: ClockSample[] = [];
    ana.c.subscribeClock((s) => samples.push(s));
    expect(await ana.c.act({ type: "player.moveTo", target: station(1) })).toMatchObject({ ok: true }); // ~2,6 s a 150 u/s
    // El estado personal (el plan) y la muestra que lo acompaña llegan juntos; a partir de ahí solo corre el reloj.
    await until(() => ana.c.getState().me?.participant.character.plan !== null && samples.length >= 1, "el plan y su muestra");
    const base = samples.length;
    let notifications = 0;
    const off = ana.c.subscribe(() => void notifications++);
    for (let i = 0; i < 4; i++) {
      now += 600;
      await server.app.service.tick();
    }
    await until(() => samples.length >= base + 4, "cuatro muestras del reloj");
    off();
    expect(notifications).toBe(0); // 4 muestras, ningún render de React
    const tail = samples.slice(base);
    expect(tail.every((s) => s.running && s.roomGeneration === 1)).toBe(true);
    expect(tail.map((s) => s.seq)).toEqual([...tail.map((s) => s.seq)].sort((a, b) => a - b));
    expect(new Set(tail.map((s) => s.seq)).size).toBe(tail.length);
    expect(tail[3]!.activeMs - tail[0]!.activeMs).toBeCloseTo(1800, -1); // el reloj es el del servidor
  });

  it("al pausar llega una muestra con el reloj detenido y el tiempo que pase en pausa no cuenta", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    await explore(r);
    expect(await ana.c.act({ type: "player.moveTo", target: station(1) })).toMatchObject({ ok: true });
    const samples: ClockSample[] = [];
    ana.c.subscribeClock((s) => samples.push(s));
    now += 600;
    await r.admin.admin({ type: "room.pause" });
    await until(() => samples.at(-1)?.running === false, "muestra con el reloj detenido");
    const frozen = samples.at(-1)!.activeMs;
    expect(frozen).toBeCloseTo(600, -1);
    const count = samples.length;
    now += 60_000; // un minuto de conversación en pausa
    await server.app.service.tick();
    await pause(150);
    expect(samples).toHaveLength(count);
    // Al reanudar el reloj sigue donde estaba: no se suma la pausa.
    await r.admin.admin({ type: "room.resume" });
    await until(() => samples.at(-1)?.running === true, "reloj en marcha");
    expect(samples.at(-1)!.activeMs).toBe(frozen);
  });

  it("pedir de nuevo el estado vuelve a entregar una muestra", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    const samples: ClockSample[] = [];
    ana.c.subscribeClock((s) => samples.push(s));
    ana.c.sync();
    await until(() => samples.length === 1, "muestra tras sincronizar");
    ana.c.sync();
    await until(() => samples.length === 2, "otra muestra");
    expect(samples[1]!.seq).toBeGreaterThan(samples[0]!.seq);
  });

  describe("shouldAcceptClock (SPECS 5.6)", () => {
    const known = { generation: 2, lastSeq: 7 };
    const sample = (over: object = {}) => ({ roomGeneration: 2, seq: 8, ...over });
    it("acepta la muestra vigente y siguiente", () => {
      expect(shouldAcceptClock(sample(), known)).toBe(true);
      expect(shouldAcceptClock(sample({ seq: 40 }), known)).toBe(true); // se pueden perder muestras: lo que cuenta es el orden
      expect(shouldAcceptClock(sample({ seq: 0 }), { generation: 2, lastSeq: -1 })).toBe(true); // la primera de una conexión
    });
    it("descarta las de otro recorrido y las repetidas o fuera de orden", () => {
      expect(shouldAcceptClock(sample({ roomGeneration: 1 }), known)).toBe(false);
      expect(shouldAcceptClock(sample({ roomGeneration: 3 }), known)).toBe(false);
      expect(shouldAcceptClock(sample({ seq: 7 }), known)).toBe(false);
      expect(shouldAcceptClock(sample({ seq: 3 }), known)).toBe(false);
    });
  });
});

describe("RoomController: conexión (SPECS 5.4, 6.2)", () => {
  it("al perder la conexión resuelve lo que estaba en vuelo y rechaza lo nuevo sin colgarse; al volver pide el estado y reinicia su secuencia", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    await explore(r);
    // Una orden de Vanessa que el servidor no llega a contestar: queda «en vuelo» cuando cae la conexión.
    server.app.service.adminCommand = () => new Promise(() => undefined);
    const inflight = r.admin.admin({ type: "round.converse", withPending: true });
    await until(() => r.admin.getState().pending === 1, "orden en vuelo");
    const port = new URL(server.url).port;
    const dir = folderOf(server);
    await server.stop(true);
    expect(await inflight).toMatchObject({ ok: false, code: "STALE_CONNECTION" }); // se resuelve, no se queda esperando
    expect(r.admin.getState().pending).toBe(0);
    await until(() => r.admin.getState().status === "reconnecting" && ana.c.getState().status === "reconnecting", "estado «reconectando»");

    const offline = await r.admin.admin({ type: "round.converse", withPending: true });
    expect(offline).toMatchObject({ ok: false, code: "STALE_CONNECTION" }); // no se encola nada para reproducirlo después
    expect(await ana.c.act({ type: "player.moveTo", target: station(0) })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(r.admin.getState().pending).toBe(0);
    expect(ana.c.getState().pending).toBe(0);
    expect(ana.c.getState().notice).toBeNull(); // la barra de conexión ya lo explica: no se suma un aviso de error

    // El servicio vuelve (mismo archivo, mismo puerto): cada pantalla reconecta sola, sin repetir nada.
    server = await startServer({ dir, mono: () => now, settings: { ...serverSettings, port: Number(port) } });
    const seen: AdminCommand[] = [];
    const original = server.app.service.adminCommand.bind(server.app.service);
    server.app.service.adminCommand = (identity, socketId, cmd) => (seen.push(cmd), original(identity, socketId, cmd));
    // «Conectada» solo llega con el resumen de la conexión NUEVA, y la presencia vieja se descarta: se espera la presencia fresca,
    // con Ana de vuelta.
    await until(() => r.admin.getState().status === "connected" && r.admin.getState().presence?.participants.find((p) => p.principalId === ana.id)?.connected === true, "reconexión de Vanessa y de Ana", 12000);
    await until(() => ana.c.getState().status === "connected" && ana.c.getState().me !== null, "reconexión de Ana", 12000);
    expect(state(r.code).adventure.round.stage).toBe("exploration"); // la orden perdida NO se reprodujo
    expect(seen).toEqual([]);
    expect(r.admin.getState().summary).toMatchObject({ phase: "paused", resumePhase: "running", self: { role: "admin" } }); // se recupera pausada
    const resumed = await r.admin.admin({ type: "room.resume" });
    expect(resumed.ok).toBe(true);
    expect(seen.map((c) => c.commandSeq)).toEqual([1]); // la secuencia empezó de nuevo con la conexión nueva
  }, 20000);

  it("tras reconectar descarta lo viejo y solo vuelve a «conectada» con el resumen nuevo; cada persona recupera SU estado", async () => {
    const r = await room(["Ana", "Beto"]);
    const [ana, beto] = r.people as [Person, Person];
    await explore(r);
    expect(await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(await ana.c.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: true });
    await until(() => samplesOf(ana.c).length === 1 && Object.keys(beto.c.getState().characters).length === 2, "estado completo antes de la caída");
    // Muestras del reloj antes de la caída: su secuencia es la del servidor que se va (`clockSeq` crece con cada una).
    const clock: ClockSample[] = [];
    ana.c.subscribeClock((s) => clock.push(s));
    for (let i = 0; i < 6; i++) ana.c.sync();
    await until(() => clock.length >= 6, "muestras previas a la caída");
    const lastSeqBefore = clock.at(-1)!.seq;
    const before = new Map([r.admin, ana.c, beto.c].map((c) => [c, c.getState()]));
    expect(before.get(r.admin)!.presence).not.toBeNull();
    const port = new URL(server.url).port;
    const dir = folderOf(server);
    await server.stop(true);
    await until(() => [r.admin, ana.c, beto.c].every((c) => c.getState().status === "reconnecting"), "estado «reconectando»");
    server = await startServer({ dir, mono: () => now, settings: { ...serverSettings, port: Number(port) } });

    // Mientras no llegue el resumen nuevo no se está «conectada» ni se muestra estado de antes de la caída: el resumen de antes de la
    // caída decía «running»; cualquier estado cuya versión sea anterior a la del resumen nuevo es estado viejo.
    const stale: string[] = [];
    let checks = 0;
    const watch = (name: string, c: RoomController) =>
      c.subscribe(() => {
        const st = c.getState();
        if (st.status !== "connected") return;
        checks++;
        const v = st.summary!.stateVersion;
        if (st.summary!.phase !== "paused") stale.push(`${name}: resumen viejo`);
        if (st.group && (st.group.phase !== "paused" || st.group.stateVersion < v)) stale.push(`${name}: grupo viejo`);
        if (st.me && st.me.stateVersion < v) stale.push(`${name}: estado personal viejo`);
        // Lo recibido antes de la caída no puede seguir a la vista: ni el mismo grupo, estado personal, personajes o presencia.
        const old = before.get(c)!;
        if (st.group !== null && st.group === old.group) stale.push(`${name}: el mismo grupo`);
        if (st.me !== null && st.me === old.me) stale.push(`${name}: el mismo estado personal`);
        if (st.presence !== null && st.presence === old.presence) stale.push(`${name}: la misma presencia`);
        if (Object.keys(st.characters).length > 0 && st.characters === old.characters) stale.push(`${name}: los mismos personajes`);
      });
    const stops = [watch("Vanessa", r.admin), watch("Ana", ana.c), watch("Beto", beto.c)];
    const complete = (c: RoomController, withMe: boolean) => c.getState().status === "connected" && c.getState().group !== null && Object.keys(c.getState().characters).length === 2 && (withMe ? c.getState().me !== null : c.getState().presence !== null);
    await until(() => complete(r.admin, false) && complete(ana.c, true) && complete(beto.c, true), "estado completo tras reconectar", 12000);
    for (const stop of stops) stop();
    expect(checks).toBeGreaterThan(0); // la vigilancia sí vio estados «conectada»
    expect(stale).toEqual([]);
    expect(r.admin.getState().summary).toMatchObject({ phase: "paused", resumePhase: "running" });
    expect(samplesOf(ana.c)).toEqual([20]); // su prueba sobrevivió: el servidor la guardó
    expect(samplesOf(beto.c)).toEqual([]);
    expect(ana.c.getState().me!.participant.view).toEqual({ kind: "activity", activityId: "sombras" });
    // La secuencia del reloj es la del servidor NUEVO: sus primeras muestras son menores y no se descartan por «repetidas».
    await until(() => clock.some((s, i) => i >= 6 && s.seq <= lastSeqBefore), "muestras del servidor nuevo");

    // Los controles se habilitan desde el estado actual: pausada no se actúa; al reanudar, sí, con la ronda y el epoch vigentes.
    expect(await ana.c.act({ type: "shadows.sample", distanceCm: 50 })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await r.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    await until(() => ana.c.getState().summary?.phase === "running" && ana.c.getState().summary?.roundVersion === state(r.code).roundVersion, "Ana ve la aventura en curso");
    expect(await ana.c.act({ type: "shadows.sample", distanceCm: 50 })).toMatchObject({ ok: true });
    expect(samplesOf(ana.c)).toEqual([20, 50]);
  }, 25000);

  it("cuando la sala termina deja de reconectar y muestra el estado terminal, con lo último que recibió", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    await explore(r);
    expect(await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    await r.admin.admin({ type: "room.close", confirm: true });
    await until(() => ana.c.getState().status === "terminal", "participante en estado terminal");
    await until(() => r.admin.getState().status === "terminal", "administradora en estado terminal");
    let attaches = 0;
    const original = server.app.service.attach.bind(server.app.service);
    server.app.service.attach = (identity, socketId) => (attaches++, original(identity, socketId));
    await pause(1800); // más que el primer reintento de Socket.IO
    expect(ana.c.getState().status).toBe("terminal");
    expect(attaches).toBe(0); // nadie intentó volver a entrar
    expect(ana.c.getState().summary?.phase).toBe("closed");
    expect(ana.c.getState().me?.participant.view).toEqual({ kind: "activity", activityId: "sombras" }); // el estado final se conserva en pantalla
    expect(await ana.c.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await r.admin.admin({ type: "room.pause" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
  });

  it("cuando la sala VENCE por inactividad también deja de reconectar y muestra el estado terminal (SPECS 6.2)", async () => {
    await server.stop();
    let wall = Date.parse("2026-10-06T10:00:00.000Z");
    server = await startServer({ now: () => new Date(wall), mono: () => now, settings: { ...serverSettings, adminIdleTtlMs: 60_000 } });
    const r = await room(["Ana", "Beto"]);
    const [ana] = r.people as [Person, Person];
    wall += 61_000;
    await server.app.service.sweep();
    await until(() => ana.c.getState().status === "terminal", "participante en estado terminal");
    await until(() => r.admin.getState().status === "terminal", "administradora en estado terminal");
    expect(ana.c.getState().summary?.phase).toBe("expired");
    // Sin reconexión operativa: pasado un rato no vuelve a conectar ni a pedir nada.
    let attaches = 0;
    const original = server.app.service.attach.bind(server.app.service);
    server.app.service.attach = (identity, socketId) => (attaches++, original(identity, socketId));
    await pause(1500);
    expect(ana.c.getState().status).toBe("terminal");
    expect(attaches).toBe(0);
    expect(await ana.c.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
  });

  it("una pestaña sustituida se detiene y no reconecta, y la nueva conserva el estado personal", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.people as [Person];
    await explore(r);
    await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await ana.c.act({ type: "shadows.sample", distanceCm: 20 });
    const second = make(ana.token);
    await until(() => second.getState().me !== null, "la pestaña nueva conecta");
    await until(() => ana.c.getState().status === "replaced", "la vieja se marca sustituida");
    expect(ana.c.getState().notice).toMatchObject({ kind: "info", text: expect.stringMatching(/otra pestaña/) });
    let attaches = 0;
    const original = server.app.service.attach.bind(server.app.service);
    server.app.service.attach = (identity, socketId) => (attaches++, original(identity, socketId));
    await pause(1500);
    expect(ana.c.getState().status).toBe("replaced");
    expect(attaches).toBe(0); // la vieja no disputa la sala
    expect(second.getState().status).toBe("connected");
    expect(second.getState().me!.participant.view).toEqual({ kind: "activity", activityId: "sombras" });
    expect(samplesOf(second)).toEqual([20]);
    expect(await ana.c.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await second.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: true });
  });

  it("una credencial inválida avisa a la aplicación para que la borre y no reintenta", async () => {
    const bad = new RoomController(server.url, "z".repeat(43));
    controllers.push(bad);
    let called = 0;
    bad.onUnauthorized = () => called++;
    bad.connect();
    await until(() => bad.getState().status === "unauthorized", "estado «sin autorización»");
    await pause(1200);
    expect(called).toBe(1);
    expect(bad.getState()).toMatchObject({ status: "unauthorized", summary: null, me: null, presence: null });
    expect(await bad.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
  });

  it("avisa a la aplicación cuando la sala se reinicia (nueva generación), y solo entonces", async () => {
    const r = await room(["Ana", "Beto"]);
    const [ana] = r.people as [Person, Person];
    let changes = 0;
    ana.c.onGenerationChange = () => changes++;
    await explore(r);
    await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await ana.c.act({ type: "shadows.sample", distanceCm: 20 });
    await r.admin.admin({ type: "round.converse", withPending: true });
    await until(() => ana.c.getState().group?.adventure.round.stage === "conversation", "conversación");
    expect(changes).toBe(0); // un cambio de fase o de ronda no es un reinicio
    await r.admin.admin({ type: "room.reset", confirm: true });
    await until(() => ana.c.getState().summary?.phase === "welcome" && ana.c.getState().summary?.roomGeneration === 2, "sala reiniciada");
    expect(changes).toBe(1);
    // La persona conserva su identidad pero recibe el recorrido nuevo: sin pruebas, en el mapa y con la ronda otra vez en preparación.
    await until(() => samplesOf(ana.c).length === 0 && ana.c.getState().group?.adventure.round.index === 0, "estado del recorrido nuevo");
    expect(ana.c.getState().me!.participant.view).toEqual({ kind: "map" });
    expect(ana.c.getState().group!.adventure.round).toMatchObject({ stage: "preparation", roster: [] });
    // Y puede jugar de nuevo con la generación y la ronda nuevas.
    await explore(r);
    expect(await ana.c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(changes).toBe(1);
  });
});
