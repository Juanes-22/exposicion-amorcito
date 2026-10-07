import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectBundle } from "../../shared/config/validateProject";
import { contentHash } from "../../shared/config/hash";
import type { RoomState } from "../../shared/contracts/state";
import { realBundle } from "../../shared/testing/project";
import { beginExploration, createRoom, folderOf, inSync, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

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

/** Una sala con la mesa de Sombras abierta en exploración y las personas conectadas. */
async function exploring(names = ["Ana", "Beto"]) {
  const r = await setupRoom(server, names);
  for (const c of r.clients) track(c);
  await beginExploration(r);
  const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
  const [anaId, betoId] = r.people.map((p) => p.join.principalId) as [string, string];
  return { ...r, ana, beto, anaId, betoId };
}
const state = (code: string): RoomState => server.app.service.inspect(code)!.state;
const samples = (code: string, id: string) => (state(code).participants[id]!.activities.sombras as { samples: Array<{ distanceCm: number }> }).samples;

describe("idempotencia (CA-17, CA-22, SPECS 5.4)", () => {
  it("repetir el mismo comando con el mismo ID devuelve la misma respuesta sin repetir la mutación", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const env = r.ana.participantEnvelope({ type: "shadows.sample", distanceCm: 20 });
    const first = await r.ana.rawParticipant(env);
    expect(first).toMatchObject({ ok: true });
    const version = state(r.code).stateVersion;
    // «Acknowledgment perdido»: el cliente reintenta el mismo comando discreto con el mismo ID.
    expect(await r.ana.rawParticipant(env)).toEqual(first);
    expect(state(r.code).stateVersion).toBe(version);
    expect(samples(r.code, r.anaId)).toHaveLength(1);
  });

  it("un resultado enviado tres veces a la vez se registra una sola", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const env = r.ana.participantEnvelope({ type: "shadows.sample", distanceCm: 33 });
    const out = await Promise.all([r.ana.rawParticipant(env), r.ana.rawParticipant(env), r.ana.rawParticipant(env)]);
    expect(out.every((x) => x.ok)).toBe(true);
    expect(samples(r.code, r.anaId).map((s) => s.distanceCm)).toEqual([33]);
  });

  it("reutilizar un ID con otro payload se rechaza", async () => {
    const r = await exploring();
    const env = r.ana.participantEnvelope({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(await r.ana.rawParticipant(env)).toMatchObject({ ok: true });
    expect(await r.ana.rawParticipant({ ...env, action: { type: "adventure.returnToMap" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(state(r.code).participants[r.anaId]!.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("cada identidad tiene su propio espacio de IDs: el mismo requestId de otra persona no es un duplicado", async () => {
    const r = await exploring();
    const a = { ...r.ana.participantEnvelope({ type: "station.open", stationId: "sombras", origin: "quickNav" }), requestId: "mismo-id" };
    const b = { ...r.beto.participantEnvelope({ type: "station.open", stationId: "sombras", origin: "quickNav" }), requestId: "mismo-id" };
    expect(await r.ana.rawParticipant(a)).toMatchObject({ ok: true });
    expect(await r.beto.rawParticipant(b)).toMatchObject({ ok: true });
    expect(state(r.code).participants[r.betoId]!.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("repetir un comando de Vanessa con el mismo ID no cambia la ronda dos veces", async () => {
    const r = await exploring();
    const env = r.admin.adminEnvelope({ type: "round.converse", withPending: true });
    const first = await r.admin.rawAdmin(env);
    const round = state(r.code).roundVersion;
    expect(await r.admin.rawAdmin(env)).toEqual(first);
    expect(state(r.code).roundVersion).toBe(round);
  });

  it("repetir «Abrir siguiente mesa» no duplica la pieza ni el efecto", async () => {
    const r = await exploring();
    await r.admin.admin({ type: "round.converse", withPending: true });
    const next = r.admin.adminEnvelope({ type: "round.next" });
    await r.admin.rawAdmin(next);
    await r.admin.rawAdmin(next); // reintento con el mismo ID
    expect(await r.admin.admin({ type: "round.next" })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // otro ID: ya no hay conversación
    expect(state(r.code).adventure.pieces).toEqual(["lupa"]);
    await r.ana.until(() => r.ana.groups.some((g) => g.effects.some((e) => e.kind === "piece.earned")), "efecto de pieza");
    expect(r.ana.groups.flatMap((g) => g.effects).filter((e) => e.kind === "piece.earned")).toHaveLength(1);
  });
});

describe("persistencia (CT-11, SPECS 5.4)", () => {
  it("si SQLite rechaza el commit no se anuncia éxito, no se guarda y la memoria no cambia", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const before = JSON.stringify(state(r.code));
    const eventsBefore = { admin: r.admin.log.length, beto: r.beto.log.length, ana: r.ana.log.length };

    server.app.repo.raw.pragma("query_only = ON"); // fallo real del motor: toda escritura se rechaza
    const env = r.ana.participantEnvelope({ type: "shadows.sample", distanceCm: 20 });
    const failed = await r.ana.rawParticipant(env);
    expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(failed.ok === false && failed.message.length).toBeGreaterThan(20);
    expect(JSON.stringify(state(r.code))).toBe(before); // nada «confirmado» en memoria
    await r.admin.quiet();
    expect({ admin: r.admin.log.length, beto: r.beto.log.length, ana: r.ana.log.length }).toEqual(eventsBefore); // y no se anunció a nadie
    expect(failed).not.toHaveProperty("stateVersion");
    // También fallan las órdenes de Vanessa: la ronda no cambia.
    expect(await r.admin.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(state(r.code).adventure.round.stage).toBe("exploration");

    // Al recuperarse la base, el MISMO requestId se procesa de verdad: el fallo no dejó un «duplicado» fantasma.
    server.app.repo.raw.pragma("query_only = OFF");
    expect(await r.ana.rawParticipant(env)).toMatchObject({ ok: true });
    expect(samples(r.code, r.anaId)).toHaveLength(1);
  });

  it("no guarda a medias: si falla la fila del comando, tampoco queda el estado (misma transacción)", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const persisted = () => server.app.repo.loadRooms().rooms.find((x) => x.state.code === r.code)!.state;
    const before = JSON.stringify(persisted());
    server.app.repo.raw.exec("CREATE TRIGGER fail_cmd BEFORE INSERT ON processed_commands BEGIN SELECT RAISE(ABORT, 'forzado'); END;");
    expect(await r.ana.act({ type: "shadows.sample", distanceCm: 40 })).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(JSON.stringify(persisted())).toBe(before); // el UPDATE de estado se revirtió con el INSERT fallido
    expect(JSON.stringify(state(r.code))).toBe(before);
    server.app.repo.raw.exec("DROP TRIGGER fail_cmd");
  });

  it("los resultados, el cuaderno y la ronda aceptados sobreviven al reinicio del proceso con el mismo archivo SQLite (CA-27)", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const sample = r.ana.participantEnvelope({ type: "shadows.sample", distanceCm: 20 });
    expect(await r.ana.rawParticipant(sample)).toMatchObject({ ok: true });
    await r.admin.admin({ type: "round.converse", withPending: true });
    await r.admin.admin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "Cerca la sombra es mayor" });
    const roundBefore = state(r.code).roundVersion;
    const dir = folderOf(server);
    for (const c of clients.splice(0)) c.close();
    await server.stop(true); // «reinicio del servicio»: se conserva el archivo

    server = await startServer({ dir });
    const recovered = state(r.code);
    expect(recovered).toMatchObject({ phase: "paused", resumePhase: "running" });
    expect(recovered.roundVersion).toBeGreaterThan(roundBefore);
    expect(recovered.adventure.round).toMatchObject({ stage: "conversation" });
    expect(recovered.adventure.notebook.map((n) => n.text)).toEqual(["Cerca la sombra es mayor"]);
    expect(samples(r.code, r.anaId).map((s) => s.distanceCm)).toEqual([20]);

    // Vanessa recupera la conducción con su credencial y recibe la sala pausada con el estado vigente.
    const admin = track(await new TestClient(server.url, r.adminToken).ready());
    expect(admin.summary).toMatchObject({ phase: "paused", self: { role: "admin" } });
    await admin.until(() => admin.group !== null && admin.presence !== null, "estado tras el reinicio");
    expect(admin.group!.adventure.notebook).toHaveLength(1);
    // Las participantes conservan identidad, credencial y sus pruebas.
    const ana = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    await ana.until(() => ana.me !== null, "su estado personal");
    expect(ana.summary).toMatchObject({ self: { role: "participant", displayName: "Ana", observer: false } });
    expect((ana.me!.participant.activities.sombras as { samples: Array<{ distanceCm: number }> }).samples[0]!.distanceCm).toBe(20);
    // El ID del comando aceptado sigue protegido contra repeticiones tras el reinicio.
    expect(await ana.rawParticipant({ ...sample, roomGeneration: admin.generation, roundVersion: ana.roundVersion, connectionEpoch: ana.epoch })).toMatchObject({ ok: true });
    expect(samples(r.code, r.anaId)).toHaveLength(1);
    // …y la sala se reanuda desde lo confirmado.
    expect(await admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    expect(state(r.code).phase).toBe("running");
  });

  it("no suma el tiempo con el servidor apagado: el reloj de simulación es solo del proceso", async () => {
    let now = 1_000;
    await server.stop();
    server = await startServer({ mono: () => now });
    const r = await exploring();
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
    expect(state(r.code).adventure.timeline.activeMs).toBe(2_500);
  });
});

describe("pestañas y desconexiones (CA-24, CA-25, CA-26, CA-28)", () => {
  it("una segunda pestaña sustituye a la primera: solo la conexión vigente puede actuar y conserva el estado personal", async () => {
    const r = await exploring();
    await r.beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const second = track(await new TestClient(server.url, r.people[1]!.join.token).ready());
    await r.beto.until(() => r.beto.replaced, "la pestaña vieja se entera");
    expect(second.epoch).toBeGreaterThan(r.beto.epoch);
    await second.until(() => second.me !== null, "estado personal de la pestaña nueva");
    expect(second.me!.participant.view).toEqual({ kind: "activity", activityId: "sombras" });
    expect(await r.beto.act({ type: "adventure.returnToMap" }, { connectionEpoch: r.beto.epoch })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await second.admin({ type: "room.pause" })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    await r.beto.until(() => r.beto.disconnected, "la pestaña vieja se cierra");
    await second.quiet(80);
    expect(r.admin.presence!.participants.find((p) => p.principalId === r.betoId)!.connected).toBe(true);
    expect(state(r.code).phase).toBe("running"); // sustituir una pestaña de quien juega no pausa a nadie
  });

  it("si una persona pierde la conexión, la aventura continúa y su progreso queda guardado; al volver sigue donde estaba", async () => {
    const r = await exploring();
    await r.beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await r.beto.act({ type: "shadows.sample", distanceCm: 20 });
    r.beto.close();
    await r.admin.until(() => r.admin.presence?.participants.find((p) => p.principalId === r.betoId)?.connected === false, "Beto desconectado");
    expect(state(r.code).phase).toBe("running");
    expect(r.admin.presence!.round.total).toBe(2);
    expect(await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    const back = track(await new TestClient(server.url, r.people[1]!.join.token).ready());
    await back.until(() => back.me !== null, "su estado personal");
    expect((back.me!.participant.activities.sombras as { samples: unknown[] }).samples).toHaveLength(1);
    expect(back.me!.participant.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("si Vanessa pierde la conexión se pausa para todas; al recargar recupera la conducción con la sala pausada (CA-26)", async () => {
    const r = await exploring();
    r.admin.close();
    await r.ana.until(() => r.ana.summary?.phase === "paused", "pausa por pérdida de la administradora");
    expect(state(r.code)).toMatchObject({ phase: "paused", resumePhase: "running" });
    expect(r.ana.summary!.adminConnected).toBe(false);
    expect(await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    const reloaded = track(await new TestClient(server.url, r.adminToken).ready());
    expect(reloaded.summary).toMatchObject({ phase: "paused", self: { role: "admin" } });
    await reloaded.until(() => reloaded.group !== null && reloaded.presence !== null, "estado vigente tras recargar");
    await r.ana.until(() => r.ana.summary?.adminConnected === true, "Ana ve de nuevo a la administradora");
    expect(await r.ana.admin({ type: "room.resume" })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" }); // nadie más conduce
    expect(await reloaded.admin({ type: "room.resume" })).toMatchObject({ ok: true });
  });

  it("una administradora que sustituye su pestaña con la aventura en curso la deja pausada", async () => {
    const r = await exploring();
    const second = track(await new TestClient(server.url, r.adminToken).ready());
    await r.admin.until(() => r.admin.replaced, "la pestaña vieja de la administradora se entera");
    expect(second.summary).toMatchObject({ phase: "paused", self: { role: "admin" } });
    expect(await r.admin.admin({ type: "room.resume" }, { connectionEpoch: r.admin.epoch })).toMatchObject({ ok: false, code: "STALE_CONNECTION" });
    expect(await second.admin({ type: "room.resume" })).toMatchObject({ ok: true });
  });

  it("room.sync entrega el estado permitido para cada papel: Vanessa el contador; cada persona lo suyo; la observadora, solo el grupo", async () => {
    const r = await setupRoom(server, ["Ana"], { observers: ["Vero"] });
    for (const c of r.clients) track(c);
    await beginExploration(r);
    const [ana] = r.people.map((p) => p.client) as [TestClient];
    const vero = r.observers[0]!.client;
    const counts = () => ({ admin: r.admin.log.length, ana: ana.log.length, vero: vero.log.length });
    const before = counts();
    await Promise.all([r.admin.sync(), ana.sync(), vero.sync()]);
    await r.admin.until(() => counts().admin > before.admin && counts().ana > before.ana && counts().vero > before.vero, "estado por sync");
    expect(r.admin.log.slice(before.admin)).toEqual(expect.arrayContaining(["presence.updated", "group.state"]));
    expect(ana.log.slice(before.ana)).toEqual(expect.arrayContaining(["me.state", "characters.state"]));
    expect(vero.log.slice(before.vero)).not.toContain("me.state");
    expect(vero.log.slice(before.vero)).not.toContain("presence.updated");
    expect(r.admin.groups.at(-1)!.effects).toEqual([]); // un sync no repite efectos
  });
});

describe("aislamiento entre salas (CA-30)", () => {
  it("una credencial solo actúa en su sala: no hay forma de dirigir un comando a otra", async () => {
    const a = await exploring();
    const b = await setupRoom(server, ["Carla", "Dani"]);
    for (const c of b.clients) track(c);
    await beginExploration(b);
    const carla = b.people[0]!.client;
    await a.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await carla.quiet(80);
    expect(carla.me!.participant.view).toEqual({ kind: "map" }); // nada de lo que hace Ana en la otra sala le llega
    expect(b.admin.groups.every((g) => g.adventure.mapId === state(b.code).adventure.mapId)).toBe(true);
    expect(await b.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    expect(state(a.code).phase).toBe("running");
    expect(state(b.code).phase).toBe("paused");
    expect(await b.people[1]!.client.admin({ type: "present.select", principalId: a.anaId })).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    // Entrar con el código de A no da acceso a B y viceversa.
    const j = await joinRoom(server.url, a.code, "Intruso");
    const intruder = track(await new TestClient(server.url, j.body.token).ready());
    expect(intruder.summary!.code).toBe(a.code);
  });

  it("los QR y el enlace público no contienen secretos y el resumen público tampoco", async () => {
    const created = await createRoom(server.url);
    expect(created.body.joinUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sala\/[A-Z0-9]{6}$/);
    const r = await exploring();
    for (const c of r.clients) expect(JSON.stringify(c.summary)).not.toMatch(new RegExp(`${r.adminToken}|${r.people[0]!.join.token}|tokenHash|token_hash`));
    for (const g of r.admin.groups) expect(JSON.stringify(g)).not.toMatch(/token|socket/i);
  });
});

describe("reiniciar y cerrar la sala (CT-12, CA-29)", () => {
  it("reiniciar vuelve a bienvenida, conserva a las personas con sus credenciales e invalida lo del recorrido anterior", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const oldGen = r.admin.generation;
    const staleEnv = r.ana.participantEnvelope({ type: "adventure.returnToMap" });
    expect(await r.admin.admin({ type: "room.reset", confirm: true })).toMatchObject({ ok: true });
    await r.ana.until(() => r.ana.summary?.roomGeneration === oldGen + 1, "nueva generación");
    expect(state(r.code)).toMatchObject({ phase: "welcome", roomGeneration: oldGen + 1 });
    expect(await r.ana.rawParticipant(staleEnv)).toMatchObject({ ok: false, code: "STALE_GENERATION" });
    const again = track(await new TestClient(server.url, r.people[1]!.join.token).ready());
    expect(again.summary).toMatchObject({ self: { principalId: r.betoId, displayName: "Beto" } });
    expect(await r.admin.admin({ type: "room.start" }, { roomGeneration: oldGen + 1 })).toMatchObject({ ok: true });
  });

  it("exige confirmación explícita para reiniciar y cerrar", async () => {
    const r = await exploring();
    expect(await r.admin.rawAdmin({ ...r.admin.adminEnvelope({ type: "room.reset", confirm: true }), action: { type: "room.reset" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await r.admin.rawAdmin({ ...r.admin.adminEnvelope({ type: "room.close", confirm: true }), action: { type: "room.close", confirm: false } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(state(r.code).phase).toBe("running");
  });

  it("cerrar avisa a todas las vistas y bloquea toda acción y toda entrada posterior", async () => {
    const r = await exploring();
    expect(await r.admin.admin({ type: "room.close", confirm: true })).toMatchObject({ ok: true });
    for (const c of [r.ana, r.beto]) await c.until(() => c.summary?.phase === "closed", "todas las vistas ven que terminó");
    for (const c of [r.ana, r.beto, r.admin]) await c.until(() => c.disconnected, "se cierran las conexiones operativas");
    const late = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    expect(late.summary).toMatchObject({ phase: "closed" });
    expect(await late.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_UNAVAILABLE" });
    await late.until(() => late.disconnected, "…y no queda reconexión operativa");
    expect((await joinRoom(server.url, r.code, "Tarde")).status).toBe(410);
  });
});

describe("configuración incompatible (CT-13)", () => {
  it("una sala guardada con otra revisión conserva sus datos, bloquea el juego y se puede reiniciar o cerrar", async () => {
    const r = await exploring();
    await r.ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    await r.ana.act({ type: "shadows.sample", distanceCm: 20 });
    const dir = folderOf(server);
    for (const c of clients.splice(0)) c.close();
    await server.stop(true);

    // Se «despliega» una revisión nueva del contenido entre sesiones.
    const changed: ProjectBundle = realBundle();
    changed.config.configRevision = "2026-11-01-v2";
    changed.config.activities.sombras!.title = "Sombras (nueva redacción)";
    (changed as { configHash: string }).configHash = contentHash(changed.config);
    server = await startServer({ dir, project: changed });

    expect(samples(r.code, r.anaId)).toHaveLength(1); // las pruebas no se borran ni se migran en silencio
    const admin = track(await new TestClient(server.url, r.adminToken).ready());
    expect(admin.summary).toMatchObject({ configMismatch: true, phase: "paused" });
    expect(await admin.admin({ type: "room.resume" })).toMatchObject({ ok: false, code: "CONFIG_MISMATCH" });
    expect(await admin.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: false, code: "CONFIG_MISMATCH" });
    const ana = track(await new TestClient(server.url, r.people[0]!.join.token).ready());
    expect(await ana.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "CONFIG_MISMATCH" });
    // Reiniciar es explícito y adopta la revisión vigente.
    expect(await admin.admin({ type: "room.reset", confirm: true })).toMatchObject({ ok: true });
    expect(state(r.code)).toMatchObject({ configRevision: "2026-11-01-v2", configHash: changed.configHash });
    await admin.until(() => admin.summary?.configMismatch === false, "sin incompatibilidad tras reiniciar");
  });
});

describe("límites de la conexión", () => {
  it("limita la frecuencia de acciones y responde RATE_LIMITED sin tocar el avance", async () => {
    await server.stop();
    server = await startServer({ settings: { rateLimits: { createRoomPerMinute: 10, joinPerMinute: 60, participantBurst: 5, participantPerSecond: 1, adminBurst: 20, adminPerSecond: 8 } } });
    const r = await exploring();
    const results = await Promise.all(Array.from({ length: 30 }, () => r.ana.act({ type: "adventure.returnToMap" })));
    expect(results.filter((x) => !x.ok && x.code === "RATE_LIMITED").length).toBeGreaterThan(10);
    expect(state(r.code).phase).toBe("running");
  });

  it("descarta mensajes enormes cerrando la conexión en lugar de procesarlos", async () => {
    const r = await exploring();
    const big = r.admin.adminEnvelope({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "a".repeat(200_000) });
    r.admin.socket.emit("admin.command", big, () => undefined);
    await r.admin.until(() => r.admin.disconnected, "conexión cerrada por exceder el tamaño máximo");
    expect(state(r.code).adventure.notebook).toHaveLength(0);
  });

  it("una persona nueva no se cuela en una ronda ya abierta: se sincroniza con la versión vigente de la ronda", async () => {
    const r = await exploring();
    const j = await joinRoom(server.url, r.code, "Nueva", "rosa");
    const nueva = track(await new TestClient(server.url, j.body.token).ready());
    await inSync({ people: [{ client: nueva, join: j.body }], observers: [] }, state(r.code).roundVersion);
    expect(nueva.group!.adventure.round.stage).toBe("exploration");
    expect(state(r.code).adventure.round.roster).not.toContain(j.body.principalId);
  });
});
