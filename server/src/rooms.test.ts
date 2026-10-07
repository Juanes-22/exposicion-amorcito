import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realBundle } from "../../shared/testing/project";
import { loadSettings } from "./config";
import { beginExploration, createRoom, getRoom, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

let server: TestServer;
const clients: TestClient[] = [];
const track = <T extends TestClient>(c: T): T => (clients.push(c), c);

beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.stop();
});

async function room(names = ["Ana", "Beto"], options: { observers?: string[] } = {}) {
  const r = await setupRoom(server, names, options);
  for (const c of r.clients) clients.push(c);
  return r;
}
const state = (code: string) => server.app.service.inspect(code)!.state;
const realSettings = () => loadSettings({}, {});

describe("alta de sala e identidades (CA-01, CA-03)", () => {
  it("crear una sala entrega código y enlace públicos sin credencial; la administradora recibe la suya aparte", async () => {
    const res = await createRoom(server.url);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // sin caracteres ambiguos
    expect(res.body.joinUrl).toBe(`${server.url}/sala/${res.body.code}`);
    expect(res.body.joinUrl).not.toContain(res.body.adminToken);
    expect(res.body.adminToken.length).toBeGreaterThanOrEqual(43); // 32 bytes en base64url
    const info = await getRoom(server.url, res.body.code);
    expect(JSON.stringify(info)).not.toContain(res.body.adminToken);
    expect(info.body).toEqual({ code: res.body.code, phase: "welcome", title: "El laboratorio de las cosas cotidianas" });
  });

  it("rechaza un contenido que el servidor no ofrece", async () => {
    expect((await createRoom(server.url, "otra-exposicion")).status).toBe(403);
  });

  it("nombres repetidos conservan identidades distintas con una distinción visible y estable", async () => {
    const created = await createRoom(server.url);
    const a = await joinRoom(server.url, created.body.code, "Laura");
    const b = await joinRoom(server.url, created.body.code, "  laura ");
    const c = await joinRoom(server.url, created.body.code, "Laura");
    expect([a.body.displayName, b.body.displayName, c.body.displayName]).toEqual(["Laura", "laura · 2", "Laura · 3"]);
    expect(new Set([a.body.principalId, b.body.principalId, c.body.principalId]).size).toBe(3);
    expect(new Set([a.body.token, b.body.token, c.body.token]).size).toBe(3);
  });

  it("quien se une como observador queda fuera del juego pero con identidad propia", async () => {
    const created = await createRoom(server.url);
    const o = await joinRoom(server.url, created.body.code, "Vero", "azul", true);
    expect(o.body).toMatchObject({ observer: true, displayName: "Vero" });
    const p = await joinRoom(server.url, created.body.code, "Ana");
    expect(p.body.observer).toBe(false);
  });

  it("valida nombre y color en el servidor y no admite un papel enviado por el navegador", async () => {
    const created = await createRoom(server.url);
    const code = created.body.code;
    expect((await joinRoom(server.url, code, "")).status).toBe(400);
    expect((await joinRoom(server.url, code, "x".repeat(21))).status).toBe(400);
    expect((await joinRoom(server.url, code, "Ana", "negro")).status).toBe(400);
    expect((await joinRoom(server.url, code, "‮ana")).status).toBe(400);
    const forged = await fetch(`${server.url}/api/rooms/${code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ana", color: "azul", role: "admin" }) });
    expect(forged.status).toBe(400);
    expect((await joinRoom(server.url, "ZZZZZZ", "Ana")).status).toBe(404);
    expect((await joinRoom(server.url, "no", "Ana")).status).toBe(404);
  });

  it("acota el tamaño del cuerpo y responde sin filtrar detalles internos", async () => {
    const big = await fetch(`${server.url}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentSetId: "x".repeat(20_000) }) });
    expect(big.status).toBe(413);
    const bad = await fetch(`${server.url}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: "{no es json" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toMatch(/stack|at .*\.ts|node_modules/);
  });

  it("limita la creación de salas por origen de red", async () => {
    await server.stop();
    server = await startServer({ settings: { rateLimits: { ...realSettings().rateLimits, createRoomPerMinute: 3, joinPerMinute: 3 } } });
    const created: number[] = [];
    for (let i = 0; i < 5; i++) created.push((await createRoom(server.url)).status);
    expect(created.filter((s) => s === 201)).toHaveLength(3);
    expect(created.filter((s) => s === 429)).toHaveLength(2);
  });

  it("respeta el tope de participantes de la sala (observadores incluidos)", async () => {
    await server.stop();
    const project = realBundle();
    project.config.session.maxParticipants = 2;
    server = await startServer({ project });
    const created = await createRoom(server.url);
    expect((await joinRoom(server.url, created.body.code, "A")).status).toBe(201);
    expect((await joinRoom(server.url, created.body.code, "B", "azul", true)).status).toBe(201);
    const full = await joinRoom(server.url, created.body.code, "C");
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ error: { code: "ROOM_FULL" } });
  });
});

describe("autenticación del socket", () => {
  it("rechaza conexiones sin credencial, con una inválida o con la credencial solo en la query string", async () => {
    const created = await createRoom(server.url);
    const none = track(new TestClient(server.url, undefined, { auth: {} }));
    await none.until(() => none.connectError !== null, "rechazo sin credencial");
    expect(none.connectError).toBe("UNAUTHORIZED");
    const bad = track(new TestClient(server.url, "x".repeat(43)));
    await bad.until(() => bad.connectError !== null, "rechazo de credencial falsa");
    const query = track(new TestClient(server.url, undefined, { auth: {}, query: { token: created.body.adminToken } }));
    await query.until(() => query.connectError !== null, "la query string no autentica");
    const ok = track(await new TestClient(server.url, created.body.adminToken).ready());
    expect(ok.summary?.self.role).toBe("admin");
  });

  it("el papel lo decide el servidor: una participante nunca es administradora", async () => {
    const r = await room();
    expect(r.admin.summary!.self.role).toBe("admin");
    for (const p of r.people) expect(p.client.summary!.self.role).toBe("participant");
    const forged = track(new TestClient(server.url, r.people[0]!.join.token, { auth: { token: r.people[0]!.join.token, role: "admin" } }));
    await forged.ready();
    expect(forged.summary!.self.role).toBe("participant");
  });
});

describe("qué ve cada audiencia (CA-02, CA-04, CA-05)", () => {
  it("la administradora ve a las personas conectadas con nombre, color, distinción y si son observadoras", async () => {
    const r = await room(["Laura", "Laura"], { observers: ["Vero"] });
    expect(r.admin.presence!.participants.map((p) => [p.displayName, p.connected, p.observer])).toEqual([
      ["Laura", true, false],
      ["Laura · 2", true, false],
      ["Vero", true, true],
    ]);
    expect(r.admin.presence!.participants.map((p) => p.color)).toEqual(["azul", "verde", "azul"]);
    expect(r.admin.presence!.connectedCount).toBe(3);
  });

  it("cada participante recibe su estado personal y el de nadie más; todas ven a todos los personajes", async () => {
    const r = await room(["Ana", "Beto"]);
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    await beginExploration(r);
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(await ana.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: true });
    await ana.until(() => (ana.me?.participant.activities.sombras as { samples: unknown[] }).samples.length === 1, "Ana recibe su muestra");
    await beto.quiet(120);
    // Beto no recibió nada de la exploración de Ana: su estado personal sigue siendo el suyo, sin muestras ni vista de mesa.
    expect(beto.me!.participant.view).toEqual({ kind: "map" });
    expect((beto.me!.participant.activities.sombras as { samples: unknown[] }).samples).toHaveLength(0);
    expect(JSON.stringify(beto.mes)).not.toContain('"distanceCm":20');
    expect(JSON.stringify(r.admin.mes)).toBe("[]"); // Vanessa no tiene estado personal
    // Todas conocen a todos los personajes (nombre, color, posición), pero nada de sus pruebas.
    for (const c of [ana, beto, r.admin]) {
      expect([...c.characters.values()].map((x) => x.displayName).sort()).toEqual(["Ana", "Beto"]);
      expect(JSON.stringify([...c.characters.values()])).not.toMatch(/activities|samples|trials/);
    }
  });

  it("los movimientos de una persona los ven todas: el personaje cambia y solo se avisa lo que cambió", async () => {
    const r = await room(["Ana", "Beto"]);
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    await beginExploration(r);
    const before = beto.characters.get(r.people[0]!.join.principalId)!.character.plan;
    expect(before).toBeNull();
    expect(await ana.act({ type: "player.moveTo", target: { x: 640, y: 450 } })).toMatchObject({ ok: true });
    await beto.until(() => beto.characters.get(r.people[0]!.join.principalId)!.character.plan !== null, "Beto ve caminar a Ana");
    await r.admin.until(() => r.admin.characters.get(r.people[0]!.join.principalId)!.character.plan !== null, "la proyección ve caminar a Ana");
    expect(beto.mes.length).toBe(1); // el único estado personal de Beto fue el de su alta
  });

  it("quien se une como observador recibe el resumen y el grupo, pero ningún estado personal, y no puede actuar", async () => {
    const r = await room(["Ana"], { observers: ["Vero"] });
    const vero = r.observers[0]!.client;
    expect(vero.summary!.self).toMatchObject({ role: "participant", observer: true });
    await vero.until(() => vero.group !== null, "grupo");
    expect(vero.me).toBeNull();
    await beginExploration(r);
    expect(await vero.act({ type: "player.moveTo", target: { x: 640, y: 450 } })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(Object.keys(state(r.code).participants)).toEqual([r.people[0]!.join.principalId]);
    expect(r.admin.presence!.round).toEqual({ ready: 0, total: 1 }); // no cuenta en el contador
  });

  it("quien espera la bienvenida no ve más que el resumen: nada del cuaderno ni de las credenciales", async () => {
    const r = await room(["Ana"]);
    const ana = r.people[0]!.client;
    expect(JSON.stringify(ana.summary)).not.toMatch(/notebook|token|adventure/);
    expect(ana.summary).toMatchObject({ phase: "welcome", self: { observer: false } });
    expect(ana.presence).toBeNull(); // la lista de presencia es solo de Vanessa
  });
});

describe("autoridad del servidor sobre los comandos (CA-08, CA-09)", () => {
  it("las participantes no pueden conducir la sala ni emitir moderación; Vanessa no emite acciones personales", async () => {
    const r = await room();
    await beginExploration(r);
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    for (const action of [{ type: "round.converse", withPending: true }, { type: "round.next" }, { type: "round.open" }, { type: "room.pause" }, { type: "room.close", confirm: true }, { type: "present.clear" }] as const) {
      expect(await ana.admin(action), action.type).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    }
    expect(await r.admin.act({ type: "player.moveTo", target: { x: 640, y: 450 } })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(state(r.code)).toMatchObject({ phase: "running" });
    expect(state(r.code).adventure.round.stage).toBe("exploration");
  });

  it("una acción de una ronda ya cerrada se rechaza sin modificar el avance (STALE_ROUND)", async () => {
    const r = await room();
    await beginExploration(r);
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    const old = ana.roundVersion;
    expect(await r.admin.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: true });
    const late = await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }, { roundVersion: old });
    expect(late).toMatchObject({ ok: false, code: "STALE_ROUND" });
    expect(state(r.code).participants[r.people[0]!.join.principalId]!.view).toEqual({ kind: "map" });
  });

  it("rechaza una acción con la generación anterior y un sobre con campos de más (rol forjado)", async () => {
    const r = await room();
    await beginExploration(r);
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    expect(await ana.act({ type: "adventure.returnToMap" }, { roomGeneration: 99 })).toMatchObject({ ok: false, code: "STALE_GENERATION" });
    expect(await ana.rawParticipant({ ...ana.participantEnvelope({ type: "adventure.returnToMap" }), role: "admin" })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await ana.rawParticipant({ ...ana.participantEnvelope({ type: "adventure.returnToMap" }), action: { type: "grantPiece", piece: "lupa" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await ana.rawParticipant({ ...ana.participantEnvelope({ type: "adventure.returnToMap" }), action: { type: "boxes.personal.open" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await ana.rawParticipant({ ...ana.participantEnvelope({ type: "adventure.returnToMap" }), turnVersion: 1 })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await ana.rawParticipant(null)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("una persona no puede actuar sobre las pruebas de otra: no existe forma de nombrarlas", async () => {
    const r = await room();
    await beginExploration(r);
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(await ana.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: true });
    // Beto no abrió la mesa: su muestra se rechaza y la de Ana no cambia.
    expect(await beto.act({ type: "shadows.sample", distanceCm: 40 })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    const a = state(r.code).participants[r.people[0]!.join.principalId]!.activities.sombras as { samples: Array<{ distanceCm: number }> };
    expect(a.samples.map((s) => s.distanceCm)).toEqual([20]);
  });

  it("órdenes de Vanessa rápidas y seguidas se procesan una a una; una con commandSeq antiguo no reemplaza a una posterior", async () => {
    const r = await room();
    await r.admin.admin({ type: "room.start" });
    const newer = await r.admin.admin({ type: "round.open" }, { commandSeq: 50 });
    expect(newer).toMatchObject({ ok: true });
    const older = await r.admin.admin({ type: "round.converse", withPending: true }, { commandSeq: 49 });
    expect(older).toMatchObject({ ok: false, code: "STALE_TURN" });
    expect(state(r.code).adventure.round.stage).toBe("exploration");
    // Dos órdenes iguales a la vez no abren la mesa dos veces: la segunda ya la encuentra abierta.
    const results = await Promise.all([r.admin.admin({ type: "round.converse", withPending: true }, { commandSeq: 60 }), r.admin.admin({ type: "round.converse", withPending: true }, { commandSeq: 61 })]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(state(r.code).adventure.round.stage).toBe("conversation");
  });
});

describe("pausa (CA-12, CA-13)", () => {
  it("pausar bloquea las acciones de todas y la conducción; reanudar las habilita con el estado vigente", async () => {
    const r = await room();
    await beginExploration(r);
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    expect(await r.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    for (const c of [ana, beto]) await c.until(() => c.summary?.phase === "paused", "pausa visible para todas");
    expect(ana.summary).toMatchObject({ resumePhase: "running" });
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await beto.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await r.admin.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await r.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    for (const c of [ana, beto]) await c.until(() => c.summary?.phase === "running", "reanudada");
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
  });
});
