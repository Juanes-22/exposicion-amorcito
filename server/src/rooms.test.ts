import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realBundle } from "../../shared/testing/project";
import { createRoom, getRoom, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

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

async function room(names = ["Ana", "Beto"]) {
  const r = await setupRoom(server, names);
  for (const c of r.clients) clients.push(c);
  return r;
}

describe("alta de sala e identidades (CA-01, CA-03)", () => {
  it("crear una sala entrega código y enlace públicos sin credencial; la administradora recibe la suya aparte", async () => {
    const res = await createRoom(server.url);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // sin caracteres ambiguos
    expect(res.body.joinUrl).toBe(`${server.url}/sala/${res.body.code}`);
    expect(res.body.joinUrl).not.toContain(res.body.adminToken);
    expect(res.body.adminToken.length).toBeGreaterThanOrEqual(43); // 32 bytes en base64url
    expect(JSON.stringify(await getRoom(server.url, res.body.code))).not.toContain(res.body.adminToken);
    const info = await getRoom(server.url, res.body.code);
    expect(info.body).toEqual({ code: res.body.code, phase: "welcome", title: "El laboratorio de las cosas cotidianas" });
  });

  it("rechaza un contenido que el servidor no ofrece", async () => {
    const res = await createRoom(server.url, "otra-exposicion");
    expect(res.status).toBe(403);
  });

  it("nombres repetidos conservan identidades distintas con una distinción visible y estable", async () => {
    const created = await createRoom(server.url);
    const a = await joinRoom(server.url, created.body.code, "Laura");
    const b = await joinRoom(server.url, created.body.code, "  laura ");
    const c = await joinRoom(server.url, created.body.code, "Laura");
    expect([a.body.displayName, b.body.displayName, c.body.displayName]).toEqual(["Laura", "laura · 2", "Laura · 3"]);
    expect(new Set([a.body.principalId, b.body.principalId, c.body.principalId]).size).toBe(3);
    expect(new Set([a.body.token, b.body.token, c.body.token]).size).toBe(3);
    expect([a.body.distinction, b.body.distinction, c.body.distinction]).toEqual([1, 2, 3]);
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

  it("limita la creación de salas y la entrada por origen de red", async () => {
    await server.stop();
    server = await startServer({ settings: { rateLimits: { ...realSettings().rateLimits, createRoomPerMinute: 3, joinPerMinute: 3 } } });
    const created = [];
    for (let i = 0; i < 5; i++) created.push((await createRoom(server.url)).status);
    expect(created.filter((s) => s === 201)).toHaveLength(3);
    expect(created.filter((s) => s === 429).length).toBe(2);
  });

  it("respeta el tope de participantes de la sala", async () => {
    await server.stop();
    const project = realBundle();
    project.config.session.maxParticipants = 2;
    server = await startServer({ project });
    const created = await createRoom(server.url);
    expect((await joinRoom(server.url, created.body.code, "A")).status).toBe(201);
    expect((await joinRoom(server.url, created.body.code, "B")).status).toBe(201);
    const full = await joinRoom(server.url, created.body.code, "C");
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ error: { code: "ROOM_FULL" } });
  });
});

import { loadSettings } from "./config";
const realSettings = () => loadSettings({}, {});

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
    expect(query.connectError).toBe("UNAUTHORIZED");
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

describe("las tres vistas: administradora, controlador y espera (CA-02, CA-04, CA-05, CA-07)", () => {
  it("la administradora ve a los participantes conectados con nombre, color y distinción", async () => {
    const r = await room(["Laura", "Laura"]);
    expect(r.admin.presence!.participants.map((p) => [p.displayName, p.connected, p.isController])).toEqual([["Laura", true, false], ["Laura · 2", true, false]]);
    expect(r.admin.presence!.participants.map((p) => p.color)).toEqual(["azul", "verde"]);
    expect(r.admin.presence!.connectedCount).toBe(2);
  });

  it("quien espera recibe solo el resumen mínimo: nunca snapshot de aventura, cuaderno ni presencia", async () => {
    const r = await room();
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    expect(await r.admin.admin({ type: "control.assign", principalId: r.people[0]!.join.principalId })).toMatchObject({ ok: true });
    expect(await r.admin.admin({ type: "room.start" })).toMatchObject({ ok: true });
    await ana.until(() => ana.snapshots.length > 0, "el controlador recibe su snapshot");
    await beto.quiet();
    expect(beto.snapshots).toHaveLength(0);
    expect(beto.presence).toBeNull();
    expect(beto.count("room.snapshot")).toBe(0);
    expect(beto.summary).toMatchObject({ phase: "running", controller: { displayName: "Ana", color: "azul" }, self: { isController: false } });
    expect(JSON.stringify(beto.summary)).not.toMatch(/notebook|token|adventure/);
  });

  it("dar turno abre la aventura vigente e identifica al controlador; cambiar de turno retira al anterior y habilita solo al siguiente", async () => {
    const r = await room();
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    const [anaId, betoId] = r.people.map((p) => p.join.principalId) as [string, string];
    await r.admin.admin({ type: "control.assign", principalId: anaId });
    await r.admin.admin({ type: "room.start" });
    await ana.until(() => ana.summary?.phase === "running" && ana.summary.self.isController, "Ana controla");
    expect(r.admin.summary!.controller).toMatchObject({ principalId: anaId, displayName: "Ana" });

    // Ana opera: se refleja en la vista de la administradora.
    expect(await ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    await r.admin.until(() => r.admin.snapshots.at(-1)?.state.adventure.view.kind === "activity", "la administradora ve la actividad abierta");

    // Cambio de turno atómico.
    const before = r.admin.snapshots.length;
    expect(await r.admin.admin({ type: "control.assign", principalId: betoId })).toMatchObject({ ok: true });
    await beto.until(() => beto.summary?.self.isController === true && beto.snapshots.length > 0, "Beto recibe control y snapshot");
    await ana.until(() => ana.summary?.self.isController === false, "Ana vuelve a espera");
    expect(beto.snapshots.at(-1)!.state.adventure.view).toEqual({ kind: "activity", activityId: "sombras" }); // conserva el estado
    expect(r.admin.snapshots.length).toBeGreaterThan(before);
    // Ana ya no recibe el canal de vista.
    const anaSnaps = ana.snapshots.length;
    expect(await beto.adventure({ type: "shadows.surprise.ack" })).toMatchObject({ ok: true });
    await r.admin.until(() => r.admin.snapshots.at(-1)?.state.adventure.activities.sombras?.step === "firstIdea", "la administradora ve el avance de Beto");
    await ana.quiet();
    expect(ana.snapshots.length).toBe(anaSnaps);
    expect(ana.changes.at(-1)).toMatchObject({ controller: { displayName: "Beto" } });
  });
});

describe("autoridad del servidor sobre los comandos (CA-08, CA-09)", () => {
  it("la espera no puede jugar, darse turno ni emitir moderación", async () => {
    const r = await room();
    const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
    await r.admin.admin({ type: "control.assign", principalId: r.people[0]!.join.principalId });
    await r.admin.admin({ type: "room.start" });
    await ana.until(() => ana.summary?.self.isController === true, "Ana controla");
    for (const action of [{ type: "control.assign", principalId: r.people[1]!.join.principalId }, { type: "control.take" }, { type: "room.pause" }, { type: "room.close", confirm: true }] as const) {
      expect(await beto.admin(action)).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
      expect(await ana.admin(action)).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" }); // ni siquiera la controladora
    }
    expect(await beto.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(server.app.service.inspect(r.code)!.state).toMatchObject({ phase: "running", controlOwner: { principalId: r.people[0]!.join.principalId } });
    expect(server.app.service.inspect(r.code)!.state.adventure.view).toEqual({ kind: "map" });
  });

  it("una acción tardía del controlador anterior se rechaza sin modificar el avance (STALE_TURN)", async () => {
    const r = await room();
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    await r.admin.admin({ type: "control.assign", principalId: r.people[0]!.join.principalId });
    await r.admin.admin({ type: "room.start" });
    await ana.until(() => ana.summary?.self.isController === true, "Ana controla");
    const staleTurn = ana.turnVersion;
    await r.admin.admin({ type: "control.assign", principalId: r.people[1]!.join.principalId });
    const late = await ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" }, { turnVersion: staleTurn });
    expect(late).toMatchObject({ ok: false, code: "STALE_TURN" });
    expect(server.app.service.inspect(r.code)!.state.adventure.view).toEqual({ kind: "map" });
  });

  it("rechaza una acción con la generación anterior y un sobre con campos de más (rol forjado)", async () => {
    const r = await room();
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    await r.admin.admin({ type: "control.assign", principalId: r.people[0]!.join.principalId });
    await r.admin.admin({ type: "room.start" });
    await ana.until(() => ana.summary?.self.isController === true, "Ana controla");
    expect(await ana.adventure({ type: "ramps.trial.start" }, { roomGeneration: 99 })).toMatchObject({ ok: false, code: "STALE_GENERATION" });
    const forged = { ...ana.adventureEnvelope({ type: "adventure.returnToMap" }), role: "admin" };
    expect(await ana.rawAdventure(forged)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await ana.rawAdventure({ ...ana.adventureEnvelope({ type: "adventure.returnToMap" }), action: { type: "grantPiece", piece: "lupa" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await ana.rawAdventure(null)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("selecciones administrativas rápidas conservan la última confirmada y nunca dejan dos propietarios (CA-10)", async () => {
    const r = await room();
    const [anaId, betoId] = r.people.map((p) => p.join.principalId) as [string, string];
    const order = [anaId, betoId, anaId, betoId, anaId, betoId, betoId, anaId];
    const results = await Promise.all(order.map((principalId) => r.admin.admin({ type: "control.assign", principalId })));
    expect(results.every((x) => x.ok)).toBe(true);
    const state = server.app.service.inspect(r.code)!.state;
    expect(state.controlOwner).toEqual({ role: "participant", principalId: anaId });
    await r.admin.until(() => r.admin.presence?.participants.filter((p) => p.isController).length === 1, "un solo controlador en la presencia");
    expect(r.admin.presence!.participants.find((p) => p.isController)!.principalId).toBe(anaId);
    // La participante que quedó controlando es la única con isController.
    await r.people[0]!.client.until(() => r.people[0]!.client.summary?.self.isController === true, "Ana controla");
    await r.people[1]!.client.until(() => r.people[1]!.client.summary?.self.isController === false, "Beto en espera");
  });

  it("una orden de moderación con commandSeq antiguo no reemplaza una posterior", async () => {
    const r = await room();
    const [anaId, betoId] = r.people.map((p) => p.join.principalId) as [string, string];
    const newer = await r.admin.admin({ type: "control.assign", principalId: betoId }, { commandSeq: 10 });
    expect(newer).toMatchObject({ ok: true });
    const older = await r.admin.admin({ type: "control.assign", principalId: anaId }, { commandSeq: 9 });
    expect(older).toMatchObject({ ok: false, code: "STALE_TURN" });
    expect(server.app.service.inspect(r.code)!.state.controlOwner).toEqual({ role: "participant", principalId: betoId });
  });
});

describe("pausa y control (CA-12, CA-13)", () => {
  async function running() {
    const r = await room();
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    await r.admin.admin({ type: "control.assign", principalId: r.people[0]!.join.principalId });
    await r.admin.admin({ type: "room.start" });
    await ana.until(() => ana.summary?.self.isController === true && ana.summary.phase === "running", "Ana controla");
    return r;
  }

  it("pausar conserva al propietario y bloquea sus acciones; reanudar las habilita con el estado vigente", async () => {
    const r = await running();
    const ana = r.people[0]!.client;
    expect(await r.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    await ana.until(() => ana.summary?.phase === "paused", "pausa visible");
    expect(ana.summary).toMatchObject({ resumePhase: "running", self: { isController: true } });
    expect(await ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false });
    expect(await ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" }, { turnVersion: ana.turnVersion })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await r.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    await ana.until(() => ana.summary?.phase === "running", "reanudada");
    expect(await ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
  });

  it("cambiar el controlador durante la pausa mantiene la pausa", async () => {
    const r = await running();
    await r.admin.admin({ type: "room.pause" });
    expect(await r.admin.admin({ type: "control.assign", principalId: r.people[1]!.join.principalId })).toMatchObject({ ok: true });
    const beto = r.people[1]!.client;
    await beto.until(() => beto.summary?.self.isController === true, "Beto recibe el turno");
    expect(beto.summary!.phase).toBe("paused");
    expect(await beto.adventure({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
  });

  it("tomar control habilita a Vanessa y revoca a la participante", async () => {
    const r = await running();
    const ana = r.people[0]!.client;
    expect(await r.admin.admin({ type: "control.take" })).toMatchObject({ ok: true });
    await ana.until(() => ana.summary?.self.isController === false, "Ana pierde el control");
    expect(r.admin.summary!.self.isController).toBe(true);
    expect(await r.admin.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    expect(await ana.adventure({ type: "adventure.returnToMap" })).toMatchObject({ ok: false });
    // Una vez más: «tomar control» no entrega la administración a nadie ni cambia su papel.
    expect(r.admin.summary!.self.role).toBe("admin");
  });

  it("retirar control deja al propietario vacío y pausa; no se reanuda sin elegir de nuevo", async () => {
    const r = await running();
    expect(await r.admin.admin({ type: "control.revoke" })).toMatchObject({ ok: true });
    expect(server.app.service.inspect(r.code)!.state).toMatchObject({ controlOwner: null, phase: "paused" });
    expect(await r.admin.admin({ type: "room.resume" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
  });
});
