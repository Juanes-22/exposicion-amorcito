import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectBundle } from "../../shared/config/validateProject";
import { contentHash } from "../../shared/config/hash";
import { realBundle } from "../../shared/testing/project";
import { createRoom, folderOf, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

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

async function running(names = ["Ana", "Beto"]) {
  const r = await setupRoom(server, names);
  for (const c of r.clients) track(c);
  const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
  const [anaId, betoId] = r.people.map((p) => p.join.principalId) as [string, string];
  await r.admin.admin({ type: "control.assign", principalId: anaId });
  await r.admin.admin({ type: "room.start" });
  await ana.until(() => ana.summary?.self.isController === true && ana.summary.phase === "running", "Ana controla");
  return { ...r, ana, beto, anaId, betoId };
}
const state = (code: string) => server.app.service.inspect(code)!.state;

describe("idempotencia (CA-17, CA-22, SPECS 5.4)", () => {
  it("repetir el mismo comando con el mismo ID devuelve la misma respuesta sin repetir la mutación", async () => {
    const r = await running();
    const env = r.ana.adventureEnvelope({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const first = await r.ana.rawAdventure(env);
    expect(first).toMatchObject({ ok: true });
    const version = state(r.code).stateVersion;
    // «Acknowledgment perdido»: el cliente reintenta el mismo comando discreto con el mismo ID.
    const again = await r.ana.rawAdventure(env);
    expect(again).toEqual(first);
    expect(state(r.code).stateVersion).toBe(version);
  });

  it("un formulario enviado dos veces crea un solo registro", async () => {
    const r = await running();
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const env = r.ana.adventureEnvelope({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Por la luz" } });
    const [a, b, c] = await Promise.all([r.ana.rawAdventure(env), r.ana.rawAdventure(env), r.ana.rawAdventure(env)]);
    expect([a, b, c].every((x) => x.ok)).toBe(true);
    expect(state(r.code).adventure.notebook).toHaveLength(1);
  });

  it("reutilizar un ID con otro payload se rechaza", async () => {
    const r = await running();
    const env = r.ana.adventureEnvelope({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(await r.ana.rawAdventure(env)).toMatchObject({ ok: true });
    const other = { ...env, action: { type: "adventure.returnToMap" } };
    expect(await r.ana.rawAdventure(other)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(state(r.code).adventure.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("cada identidad tiene su propio espacio de IDs: el mismo requestId de otra persona no es un duplicado", async () => {
    const r = await running();
    const env = { ...r.ana.adventureEnvelope({ type: "adventure.returnToMap" }), requestId: "mismo-id" };
    expect(await r.ana.rawAdventure(env)).toMatchObject({ ok: true });
    expect(await r.beto.rawAdventure({ ...r.beto.adventureEnvelope({ type: "adventure.returnToMap" }), requestId: "mismo-id" })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
  });

  it("repetir un comando de moderación (dar control) con el mismo ID no cambia el turno dos veces", async () => {
    const r = await running();
    const env = r.admin.adminEnvelope({ type: "control.assign", principalId: r.betoId });
    const first = await r.admin.rawAdmin(env);
    const turn = state(r.code).turnVersion;
    const again = await r.admin.rawAdmin(env);
    expect(again).toEqual(first);
    expect(state(r.code).turnVersion).toBe(turn);
  });

  it("repetir el cierre de una mesa no duplica la pieza ni el efecto", async () => {
    const r = await running();
    const act = async (action: Parameters<TestClient["adventure"]>[0]) => expect(await r.ana.adventure(action)).toMatchObject({ ok: true });
    await act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await act({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    await act({ type: "shadows.light.set", distanceCm: 15, commitSample: true });
    await act({ type: "shadows.light.set", distanceCm: 45, commitSample: true });
    await act({ type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "uncertain" } });
    const closing = r.ana.adventureEnvelope({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } });
    await r.ana.rawAdventure(closing);
    await r.ana.rawAdventure(closing); // reintento con el mismo ID
    expect(await r.ana.adventure({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // nuevo ID
    expect(state(r.code).adventure.pieces).toEqual(["lupa"]);
    const pieceEffects = r.admin.snapshots.flatMap((s) => s.effects).filter((e) => e.kind === "piece.earned");
    expect(pieceEffects).toHaveLength(1);
    expect(pieceEffects[0]!.effectId).toBe(`1:piece:lupa`);
  });
});

describe("persistencia (CT-11, SPECS 5.4)", () => {
  it("si SQLite rechaza el commit no se anuncia éxito, no se guarda y la memoria no cambia", async () => {
    const r = await running();
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const before = JSON.stringify(state(r.code));
    const eventsBefore = { admin: r.admin.log.length, beto: r.beto.log.length, ana: r.ana.log.length };

    server.app.repo.raw.pragma("query_only = ON"); // fallo real del motor: toda escritura se rechaza
    const env = r.ana.adventureEnvelope({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Mi idea" } });
    const failed = await r.ana.rawAdventure(env);
    expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(failed.ok === false && failed.message.length).toBeGreaterThan(20);
    expect(JSON.stringify(state(r.code))).toBe(before); // nada «confirmado» en memoria
    await r.admin.quiet();
    expect({ admin: r.admin.log.length, beto: r.beto.log.length, ana: r.ana.log.length }).toEqual(eventsBefore); // y no se anunció a nadie
    expect(failed).not.toHaveProperty("stateVersion");

    // También fallan las órdenes de moderación: el turno no cambia.
    expect(await r.admin.admin({ type: "control.assign", principalId: r.betoId })).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(state(r.code).controlOwner).toEqual({ role: "participant", principalId: r.anaId });

    // Al recuperarse la base, el MISMO requestId se procesa de verdad: el fallo no dejó un «duplicado» fantasma.
    server.app.repo.raw.pragma("query_only = OFF");
    expect(await r.ana.rawAdventure(env)).toMatchObject({ ok: true });
    expect(state(r.code).adventure.notebook).toHaveLength(1);
  });

  it("no guarda a medias: si falla la fila del comando, tampoco queda el estado (misma transacción)", async () => {
    const r = await running();
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const persisted = () => server.app.repo.loadRooms().rooms.find((x) => x.state.code === r.code)!.state;
    const before = JSON.stringify(persisted());
    // Se fuerza un fallo SOLO en la inserción del comando: un trigger que aborta insertar en processed_commands.
    server.app.repo.raw.exec("CREATE TRIGGER fail_cmd BEFORE INSERT ON processed_commands BEGIN SELECT RAISE(ABORT, 'forzado'); END;");
    const failed = await r.ana.adventure({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(JSON.stringify(persisted())).toBe(before); // el UPDATE de estado se revirtió con el INSERT fallido
    expect(JSON.stringify(state(r.code))).toBe(before);
    server.app.repo.raw.exec("DROP TRIGGER fail_cmd");
  });

  it("los comandos aceptados sobreviven al reinicio del proceso con el mismo archivo SQLite (CA-27)", async () => {
    const r = await running(["Ana", "Beto"]);
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const confirm = r.ana.adventureEnvelope({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Será por la luz" } });
    const stored = await r.ana.rawAdventure(confirm);
    expect(stored).toMatchObject({ ok: true });
    const turnBefore = state(r.code).turnVersion;
    const dir = folderOf(server);
    for (const c of clients.splice(0)) c.close();
    await server.stop(true); // «reinicio del servicio»: se conserva el archivo

    server = await startServer({ dir });
    const recovered = server.app.service.inspect(r.code)!.state;
    expect(recovered).toMatchObject({ phase: "paused", resumePhase: "running", controlOwner: null });
    expect(recovered.turnVersion).toBeGreaterThan(turnBefore);
    expect(recovered.adventure.notebook).toHaveLength(1);
    expect(recovered.adventure.notebook[0]).toMatchObject({ field: "firstIdea", text: "Será por la luz", authorName: "Ana" });
    expect(recovered.adventure.view).toEqual({ kind: "activity", activityId: "sombras" });

    // La administradora recupera administración con su credencial y recibe la sala pausada con el estado vigente.
    const admin = track(await new TestClient(server.url, r.adminToken).ready());
    expect(admin.summary).toMatchObject({ phase: "paused", self: { role: "admin" }, controller: null });
    await admin.until(() => admin.snapshots.length > 0, "snapshot tras el reinicio");
    expect(admin.snapshots[0]!.state.adventure.notebook[0]!.text).toBe("Será por la luz");
    // Las participantes conservan identidad y credencial, y vuelven en espera.
    const ana = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    expect(ana.summary).toMatchObject({ self: { role: "participant", isController: false, displayName: "Ana" } });
    await admin.until(() => admin.presence?.participants.length === 2, "participantes recuperados");
    expect(admin.presence!.participants.map((p) => p.displayName)).toEqual(["Ana", "Beto"]);
    // El ID del comando aceptado sigue protegido contra repeticiones tras el reinicio.
    expect(await ana.rawAdventure({ ...confirm, roomGeneration: admin.generation, turnVersion: 0, connectionEpoch: ana.epoch })).toMatchObject({ ok: true });
    // …y la sala se reanuda desde lo confirmado, sin perder el cuaderno.
    await admin.admin({ type: "control.assign", principalId: r.anaId });
    await admin.admin({ type: "room.resume" });
    expect(server.app.service.inspect(r.code)!.state.phase).toBe("running");
    expect(server.app.service.inspect(r.code)!.state.adventure.notebook).toHaveLength(1);
  });

  it("no suma el tiempo con el servidor apagado: el reloj de simulación es solo del proceso", async () => {
    let now = 1_000;
    await server.stop();
    server = await startServer({ mono: () => now });
    const r = await running();
    for (const c of r.clients) track(c);
    await r.ana.adventure({ type: "player.moveTo", target: server.app.project.map.stations[0]!.point });
    now += 2_000; // dos segundos de juego
    await r.admin.admin({ type: "room.pause" });
    expect(state(r.code).adventure.timeline.activeMs).toBe(2_000);
    now += 60_000; // un minuto de pausa y conversación: no cuenta
    await r.admin.admin({ type: "room.resume" });
    now += 500;
    await r.admin.admin({ type: "room.pause" });
    expect(state(r.code).adventure.timeline.activeMs).toBe(2_500);
    const dir = folderOf(server);
    for (const c of clients.splice(0)) c.close();
    await server.stop(true);
    now += 3_600_000; // el servidor estuvo apagado una hora
    server = await startServer({ dir, mono: () => now });
    expect(server.app.service.inspect(r.code)!.state.adventure.timeline.activeMs).toBe(2_500);
  });
});

describe("pestañas y desconexiones (CA-24, CA-25, CA-26, CA-28)", () => {
  it("una segunda pestaña sustituye a la primera: solo la conexión vigente puede actuar", async () => {
    const r = await running();
    const second = track(await new TestClient(server.url, r.people[1]!.join.token).ready());
    await r.beto.until(() => r.beto.replaced, "la pestaña vieja se entera");
    expect(second.epoch).toBeGreaterThan(r.beto.epoch);
    // La pestaña sustituida ya no puede actuar aunque su socket aún no se hubiera cerrado.
    expect(await r.beto.admin({ type: "room.pause" }, { connectionEpoch: r.beto.epoch })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await second.admin({ type: "room.pause" })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" }); // actúa, pero no es admin
    // Y la desconexión posterior del socket viejo no afecta a la nueva.
    await r.beto.until(() => r.beto.disconnected, "la pestaña vieja se cierra");
    await second.quiet(80);
    expect(r.admin.presence!.participants.find((p) => p.principalId === r.betoId)!.connected).toBe(true);
  });

  it("si se sustituye al controlador, la sala se pausa y se le retira el control; la pestaña nueva vuelve en espera", async () => {
    const r = await running();
    const second = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    await r.admin.until(() => r.admin.summary?.phase === "paused", "pausa por sustitución del controlador");
    expect(state(r.code)).toMatchObject({ controlOwner: null, phase: "paused", resumePhase: "running" });
    expect(second.summary).toMatchObject({ self: { isController: false }, phase: "paused" });
    expect(await second.adventure({ type: "adventure.returnToMap" })).toMatchObject({ ok: false });
  });

  it("el controlador que pierde la conexión pausa y pierde el control; al volver queda en espera sin desplazar a nadie", async () => {
    const r = await running();
    r.ana.close(); // corte abrupto
    await r.admin.until(() => r.admin.summary?.phase === "paused", "pausa por desconexión");
    expect(state(r.code)).toMatchObject({ controlOwner: null, phase: "paused" });
    await r.admin.until(() => r.admin.presence?.participants.find((p) => p.principalId === r.anaId)?.connected === false, "Ana aparece desconectada");
    // Vanessa elige un reemplazo y reanuda.
    await r.admin.admin({ type: "control.assign", principalId: r.betoId });
    await r.admin.admin({ type: "room.resume" });
    await r.beto.until(() => r.beto.summary?.self.isController === true && r.beto.summary.phase === "running", "Beto controla");
    // Ana regresa con su misma identidad: en espera, sin recuperar el turno.
    const back = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    expect(back.summary).toMatchObject({ self: { isController: false, principalId: r.anaId }, controller: { displayName: "Beto" }, phase: "running" });
    expect(state(r.code).controlOwner).toEqual({ role: "participant", principalId: r.betoId });
  });

  it("si una persona en espera pierde la conexión, la aventura continúa", async () => {
    const r = await running();
    r.beto.close();
    await r.admin.until(() => r.admin.presence?.participants.find((p) => p.principalId === r.betoId)?.connected === false, "Beto desconectado");
    expect(state(r.code).phase).toBe("running");
    expect(await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
  });

  it("si Vanessa pierde la conexión se pausa conservando al propietario; al recargar recupera la administración con la sala pausada (CA-26)", async () => {
    const r = await running();
    r.admin.close();
    await r.ana.until(() => r.ana.summary?.phase === "paused", "pausa por pérdida de la administradora");
    expect(state(r.code)).toMatchObject({ phase: "paused", controlOwner: { principalId: r.anaId } });
    expect(r.ana.summary!.adminConnected).toBe(false);
    const reloaded = track(await new TestClient(server.url, r.adminToken).ready());
    expect(reloaded.summary).toMatchObject({ phase: "paused", self: { role: "admin" } });
    await reloaded.until(() => reloaded.snapshots.length > 0 && reloaded.presence !== null, "estado vigente tras recargar");
    await r.ana.until(() => r.ana.summary?.adminConnected === true, "Ana ve de nuevo a la administradora");
    // Nadie más obtiene administración.
    expect(await r.ana.admin({ type: "room.resume" })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(await reloaded.admin({ type: "room.resume" })).toMatchObject({ ok: true });
  });

  it("una administradora que sustituye su pestaña con la aventura en curso la deja pausada", async () => {
    const r = await running();
    const second = track(await new TestClient(server.url, r.adminToken).ready());
    await r.admin.until(() => r.admin.replaced, "la pestaña vieja de la administradora se entera");
    expect(second.summary).toMatchObject({ phase: "paused", self: { role: "admin" } });
    expect(await r.admin.admin({ type: "room.resume" }, { connectionEpoch: r.admin.epoch })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await second.admin({ type: "room.resume" })).toMatchObject({ ok: true });
  });

  it("room.sync entrega el estado permitido para el papel: la administradora lo completo; la espera, solo el resumen", async () => {
    const r = await running();
    const adminBefore = r.admin.snapshots.length;
    await r.admin.sync();
    await r.admin.until(() => r.admin.snapshots.length > adminBefore, "snapshot por sync");
    expect(r.admin.snapshots.at(-1)!.effects).toEqual([]); // un sync no repite efectos
    const before = r.beto.log.length;
    await r.beto.sync();
    await r.beto.until(() => r.beto.log.length > before, "resumen por sync");
    expect(r.beto.snapshots).toHaveLength(0);
  });
});

describe("aislamiento entre salas (CA-30)", () => {
  it("una credencial solo actúa en su sala: no hay forma de dirigir un comando a otra", async () => {
    const a = await running();
    const b = await setupRoom(server, ["Carla", "Dani"]);
    for (const c of b.clients) track(c);
    expect(a.code).not.toBe(b.code);
    const carla = b.people[0]!.client;
    await b.admin.admin({ type: "control.assign", principalId: b.people[0]!.join.principalId });
    await b.admin.admin({ type: "room.start" });
    await carla.until(() => carla.summary?.self.isController === true, "Carla controla en B");
    await a.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    // La administradora de B no ve nada de A, y sus órdenes solo afectan a B.
    await b.admin.quiet();
    expect(b.admin.snapshots.every((s) => s.state.code === b.code)).toBe(true);
    expect(await b.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    expect(state(a.code).phase).toBe("running");
    expect(state(b.code).phase).toBe("paused");
    // Un participante de B no puede asignarse control en A usando IDs de A.
    expect(await b.people[1]!.client.admin({ type: "control.assign", principalId: a.anaId })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    // La credencial de la administradora de B no sirve como participante de A: se resuelve a SU sala.
    expect(b.admin.summary!.code).toBe(b.code);
    // Entrar con el código de A no da acceso a B y viceversa.
    const j = await joinRoom(server.url, a.code, "Intruso");
    const intruder = track(await new TestClient(server.url, j.body.token).ready());
    expect(intruder.summary!.code).toBe(a.code);
    await intruder.quiet();
    expect(intruder.snapshots).toHaveLength(0);
  });

  it("los QR y el enlace público no contienen secretos y el resumen público tampoco", async () => {
    const created = await createRoom(server.url);
    expect(created.body.joinUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sala\/[A-Z0-9]{6}$/);
    const r = await running();
    for (const c of r.clients) expect(JSON.stringify(c.summary)).not.toMatch(new RegExp(`${r.adminToken}|${r.people[0]!.join.token}|tokenHash|token_hash`));
    for (const snap of r.admin.snapshots) expect(JSON.stringify(snap)).not.toMatch(/token|socket/i);
  });
});

describe("reiniciar y cerrar la sala (CT-12, CA-29)", () => {
  it("reiniciar vuelve a bienvenida, conserva a las participantes con sus credenciales e invalida lo del recorrido anterior", async () => {
    const r = await running();
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const oldGen = r.admin.generation;
    const staleEnv = r.ana.adventureEnvelope({ type: "adventure.returnToMap" });
    expect(await r.admin.admin({ type: "room.reset", confirm: true })).toMatchObject({ ok: true });
    await r.ana.until(() => r.ana.summary?.roomGeneration === oldGen + 1, "nueva generación");
    expect(state(r.code)).toMatchObject({ phase: "welcome", controlOwner: null, roomGeneration: oldGen + 1 });
    expect(state(r.code).adventure.view).toEqual({ kind: "map" });
    // Mensaje del recorrido anterior (enviado «tarde»): se rechaza.
    expect(await r.ana.rawAdventure(staleEnv)).toMatchObject({ ok: false, code: "STALE_GENERATION" });
    // Las identidades y sus credenciales siguen valiendo.
    const again = track(await new TestClient(server.url, r.people[1]!.join.token).ready());
    expect(again.summary).toMatchObject({ self: { principalId: r.betoId, displayName: "Beto" } });
    await r.admin.until(() => r.admin.presence?.participants.length === 2, "participantes conservados");
    // Se puede comenzar de nuevo.
    expect(await r.admin.admin({ type: "control.assign", principalId: r.betoId }, { roomGeneration: oldGen + 1 })).toMatchObject({ ok: true });
  });

  it("exige confirmación explícita para reiniciar y cerrar", async () => {
    const r = await running();
    expect(await r.admin.rawAdmin({ ...r.admin.adminEnvelope({ type: "room.reset", confirm: true }), action: { type: "room.reset" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await r.admin.rawAdmin({ ...r.admin.adminEnvelope({ type: "room.close", confirm: true }), action: { type: "room.close", confirm: false } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(state(r.code).phase).toBe("running");
  });

  it("cerrar revoca el control, avisa a todas las vistas y bloquea toda acción y toda entrada posterior", async () => {
    const r = await running();
    expect(await r.admin.admin({ type: "room.close", confirm: true })).toMatchObject({ ok: true });
    for (const c of [r.ana, r.beto]) await c.until(() => c.summary?.phase === "closed", "todas las vistas ven que terminó");
    expect(r.ana.summary).toMatchObject({ controller: null, self: { isController: false } });
    for (const c of [r.ana, r.beto, r.admin]) await c.until(() => c.disconnected, "se cierran las conexiones operativas");
    expect(state(r.code)).toMatchObject({ phase: "closed", controlOwner: null });
    const late = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    expect(late.summary).toMatchObject({ phase: "closed" }); // ve el mensaje de finalización…
    expect(await late.adventure({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_UNAVAILABLE" });
    await late.until(() => late.disconnected, "…y no queda reconexión operativa");
    expect((await joinRoom(server.url, r.code, "Tarde")).status).toBe(410);
    expect(((await (await fetch(`${server.url}/api/rooms/${r.code}`)).json()) as { phase: string }).phase).toBe("closed");
  });
});

describe("configuración incompatible (CT-13)", () => {
  it("una sala guardada con otra revisión conserva sus datos, bloquea el control y se puede reiniciar o cerrar", async () => {
    const r = await running();
    await r.ana.adventure({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await r.ana.adventure({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    const dir = folderOf(server);
    for (const c of clients.splice(0)) c.close();
    await server.stop(true);

    // Se «despliega» una revisión nueva del contenido entre sesiones.
    const changed: ProjectBundle = realBundle();
    changed.config.configRevision = "2026-11-01-v2";
    changed.config.activities.sombras!.title = "Sombras (nueva redacción)";
    (changed as { configHash: string }).configHash = contentHash(changed.config);
    server = await startServer({ dir, project: changed });

    const recovered = state(r.code);
    expect(recovered.adventure.notebook).toHaveLength(1); // el cuaderno no se borra ni se migra en silencio
    const admin = track(await new TestClient(server.url, r.adminToken).ready());
    expect(admin.summary).toMatchObject({ configMismatch: true, phase: "paused" });
    expect(await admin.admin({ type: "control.assign", principalId: r.anaId })).toMatchObject({ ok: false, code: "CONFIG_MISMATCH" });
    expect(await admin.admin({ type: "room.resume" })).toMatchObject({ ok: false, code: "CONFIG_MISMATCH" });
    expect(state(r.code).adventure.notebook).toHaveLength(1);
    // Reiniciar es explícito y adopta la revisión vigente.
    expect(await admin.admin({ type: "room.reset", confirm: true })).toMatchObject({ ok: true });
    expect(state(r.code)).toMatchObject({ configRevision: "2026-11-01-v2", configHash: changed.configHash });
    await admin.until(() => admin.summary?.configMismatch === false, "sin incompatibilidad tras reiniciar");
  });
});

describe("límites de la conexión", () => {
  it("limita la frecuencia de comandos y responde RATE_LIMITED sin tocar el avance", async () => {
    await server.stop();
    server = await startServer({ settings: { rateLimits: { createRoomPerMinute: 10, joinPerMinute: 60, adventureBurst: 5, adventurePerSecond: 1, adminBurst: 20, adminPerSecond: 8 } } });
    const r = await running();
    const results = await Promise.all(Array.from({ length: 30 }, () => r.ana.adventure({ type: "adventure.returnToMap" })));
    expect(results.filter((x) => !x.ok && x.code === "RATE_LIMITED").length).toBeGreaterThan(10);
    expect(state(r.code).phase).toBe("running");
  });

  it("descarta mensajes enormes cerrando la conexión en lugar de procesarlos", async () => {
    const r = await running();
    const big = r.ana.adventureEnvelope({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "a".repeat(200_000) } });
    r.ana.socket.emit("adventure.action", big, () => undefined);
    await r.ana.until(() => r.ana.disconnected, "conexión cerrada por exceder el tamaño máximo");
    expect(state(r.code).adventure.notebook).toHaveLength(0);
  });
});
