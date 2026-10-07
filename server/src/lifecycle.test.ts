import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realBundle } from "../../shared/testing/project";
import { beginExploration, getRoom, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

// P6-04: vencimiento por inactividad de la administradora y limpieza de salas terminales (SPECS 6.3), con reloj de pared controlado
// y un barrido que se llama a mano (`sweepIntervalMs: 0`).

const MIN = 60_000;
const HOUR = 60 * MIN;
let server: TestServer;
let wall = Date.parse("2026-10-06T10:00:00.000Z");
const clients: TestClient[] = [];
const track = <T extends TestClient>(c: T): T => (clients.push(c), c);

const settings = { tickIntervalMs: 0, sweepIntervalMs: 0, adminIdleTtlMs: 2 * HOUR, terminalRetentionMs: 24 * HOUR };
beforeEach(async () => {
  wall = Date.parse("2026-10-06T10:00:00.000Z");
  server = await startServer({ now: () => new Date(wall), settings });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.stop();
});

const state = (code: string) => server.app.service.inspect(code)?.state;
const rows = (roomId: string) => ({
  rooms: (server.app.repo.raw.prepare("SELECT COUNT(*) AS n FROM rooms WHERE room_id = ?").get(roomId) as { n: number }).n,
  principals: (server.app.repo.raw.prepare("SELECT COUNT(*) AS n FROM principals WHERE room_id = ?").get(roomId) as { n: number }).n,
  commands: (server.app.repo.raw.prepare("SELECT COUNT(*) AS n FROM processed_commands WHERE room_id = ?").get(roomId) as { n: number }).n,
});
const advance = (ms: number) => void (wall += ms);

async function running(names = ["Ana", "Beto"]) {
  const r = await setupRoom(server, names);
  for (const c of r.clients) track(c);
  const [ana, beto] = r.people.map((p) => p.client) as [TestClient, TestClient];
  const anaId = r.people[0]!.join.principalId;
  await beginExploration(r);
  await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
  await ana.act({ type: "shadows.sample", distanceCm: 20 });
  return { ...r, ana, beto, anaId, roomId: state(r.code)!.roomId };
}

describe("vencimiento por inactividad de la administradora (CA-24..CA-29 en el caso límite, SPECS 6.3)", () => {
  it("antes del plazo la sala sigue viva; al cumplirse vence, avisa a todas las vistas y cierra las conexiones", async () => {
    const r = await running();
    advance(2 * HOUR - MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 0 });
    expect(state(r.code)!.phase).toBe("running");

    advance(MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 1, purged: 0 });
    expect(state(r.code)).toMatchObject({ phase: "expired" });
    for (const c of [r.admin, r.ana, r.beto]) await c.until(() => c.summary?.phase === "expired", "aviso de vencimiento");
    for (const c of [r.admin, r.ana, r.beto]) await c.until(() => c.disconnected, "conexión cerrada");
    // El estado terminal quedó guardado, con su marca para la limpieza.
    const stored = server.app.repo.loadRooms().rooms.find((x) => x.state.code === r.code)!;
    expect(stored.state.phase).toBe("expired");
    expect(stored.terminalAt).toBe(new Date(wall).toISOString());
  });

  it("una sala vencida no admite entradas ni acciones, y su ficha pública lo dice", async () => {
    const r = await running();
    advance(2 * HOUR);
    await server.app.service.sweep();
    expect((await getRoom(server.url, r.code)).body).toMatchObject({ phase: "expired" });
    expect(await joinRoom(server.url, r.code, "Cata")).toMatchObject({ status: 410, body: { error: { code: "ROOM_UNAVAILABLE", message: expect.stringMatching(/venció/) } } });
    // Quien volviera a conectar entra a un estado terminal: sin controles y desconectado enseguida.
    const back = track(await new TestClient(server.url, r.created.adminToken).ready());
    expect(back.summary?.phase).toBe("expired");
    await back.until(() => back.disconnected, "desconexión terminal");
    // Y una acción de quien tenía el turno ya no se aplica (la conexión se cerró y la sala es terminal).
    const identity = server.app.service.authenticate(r.people[0]!.join.token)!;
    expect(await server.app.service.participantCommand(identity, "cualquiera", { requestId: "tarde", roomGeneration: 1, roundVersion: 1, connectionEpoch: 1, action: { type: "adventure.returnToMap" } })).toMatchObject({ ok: false });
    const samples = (state(r.code)!.participants[r.anaId]!.activities.sombras as { samples: unknown[] }).samples;
    expect(samples).toHaveLength(1); // los resultados no se tocan hasta la limpieza
  });

  it("solo la administradora mantiene viva la sala: los participantes, por activos que estén, no", async () => {
    const r = await running();
    for (let i = 0; i < 11; i++) {
      advance(10 * MIN);
      expect(await r.ana.act({ type: "shadows.sample", distanceCm: 21 + i * 3 })).toMatchObject({ ok: true });
    }
    advance(10 * MIN); // 2 h en total desde la última señal de Vanessa
    expect(await server.app.service.sweep()).toEqual({ expired: 1, purged: 0 });
  });

  it("la señal periódica y los comandos de la administradora reinician el plazo", async () => {
    const r = await running();
    advance(110 * MIN);
    r.admin.socket.emit("admin.activity"); // el cliente la envía cada 30 s mientras está abierto
    await r.admin.quiet(80);
    advance(110 * MIN); // 3 h 40 min desde el inicio, pero solo 1 h 50 min desde la señal
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 0 });
    expect(await r.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true }); // un comando también cuenta
    advance(119 * MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 0 });
    advance(2 * MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 1, purged: 0 });
  });

  it("una señal de actividad enviada por una participante no cuenta", async () => {
    const r = await running();
    advance(110 * MIN);
    r.ana.socket.emit("admin.activity");
    r.beto.socket.emit("admin.activity");
    await r.admin.quiet(80);
    advance(11 * MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 1, purged: 0 });
  });

  it("el plazo del servidor prevalece; sin él se usa el del JSON público", async () => {
    await server.stop();
    server = await startServer({ now: () => new Date(wall), settings: { ...settings, adminIdleTtlMs: 5 * MIN } });
    const a = await running();
    advance(5 * MIN);
    expect((await server.app.service.sweep()).expired).toBe(1);
    expect(state(a.code)!.phase).toBe("expired");

    await server.stop();
    const ttlJson = realBundle().config.session.adminIdleTtlMs;
    server = await startServer({ now: () => new Date(wall), settings: { ...settings, adminIdleTtlMs: null } });
    const b = await running();
    advance(ttlJson - MIN);
    expect((await server.app.service.sweep()).expired).toBe(0);
    advance(MIN);
    expect((await server.app.service.sweep()).expired).toBe(1);
    expect(state(b.code)!.phase).toBe("expired");
  });

  it("si no se puede guardar el vencimiento no se anuncia nada y se reintenta en el siguiente barrido", async () => {
    const r = await running();
    advance(2 * HOUR);
    await r.admin.quiet(100); // que terminen de llegar los avisos del juego anterior
    const before = { admin: r.admin.log.length, ana: r.ana.log.length };
    server.app.repo.raw.pragma("query_only = ON");
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 0 });
    expect(state(r.code)!.phase).toBe("running"); // en memoria nada cambió
    await r.admin.quiet(100);
    expect({ admin: r.admin.log.length, ana: r.ana.log.length }).toEqual(before);
    expect(r.ana.disconnected).toBe(false);
    server.app.repo.raw.pragma("query_only = OFF");
    expect(await server.app.service.sweep()).toEqual({ expired: 1, purged: 0 });
  });

  it("una sala que no ha empezado o está en pausa también vence", async () => {
    const welcome = await setupRoom(server, ["Ana"]);
    for (const c of welcome.clients) track(c);
    const paused = await running();
    await paused.admin.admin({ type: "room.pause" });
    advance(2 * HOUR);
    expect((await server.app.service.sweep()).expired).toBe(2);
    expect(state(welcome.code)!.phase).toBe("expired");
    expect(state(paused.code)!.phase).toBe("expired");
  });
});

describe("limpieza de salas terminales (SPECS 6.3)", () => {
  it("hasta cumplirse la retención se conservan los datos; después se elimina sala, identidades y comandos, y las credenciales dejan de valer", async () => {
    const r = await running();
    advance(2 * HOUR);
    await server.app.service.sweep(); // vence
    expect(rows(r.roomId).rooms).toBe(1);
    expect(rows(r.roomId).principals).toBe(3);
    expect(rows(r.roomId).commands).toBeGreaterThan(0);

    advance(24 * HOUR - MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 0 });
    expect(rows(r.roomId)).toMatchObject({ rooms: 1, principals: 3 });

    advance(MIN);
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 1 });
    expect(rows(r.roomId)).toEqual({ rooms: 0, principals: 0, commands: 0 });
    expect(state(r.code)).toBeUndefined();
    expect(server.app.service.roomCount).toBe(0);
    expect((await getRoom(server.url, r.code)).status).toBe(404);
    expect(await joinRoom(server.url, r.code, "Cata")).toMatchObject({ status: 404 });
    // Ninguna credencial de esa sala vuelve a servir.
    for (const token of [r.created.adminToken, r.people[0]!.join.token]) {
      const c = track(new TestClient(server.url, token));
      await c.until(() => c.connectError !== null, "credencial rechazada");
      expect(c.connectError).toBe("UNAUTHORIZED");
    }
  });

  it("una sala cerrada por la administradora se limpia igual pasada la retención, y las demás salas no se tocan", async () => {
    const closed = await running();
    await closed.admin.admin({ type: "room.close", confirm: true });
    const other = await running();
    advance(23 * HOUR);
    await other.admin.admin({ type: "room.pause" }); // Vanessa de la otra sala sigue activa
    advance(HOUR + 1);
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 1 });
    expect(rows(closed.roomId)).toEqual({ rooms: 0, principals: 0, commands: 0 });
    expect(rows(other.roomId).rooms).toBe(1);
    expect(rows(other.roomId).principals).toBe(3);
    expect(state(other.code)!.phase).toBe("paused");
  });

  it("tras eliminar la sala, un mensaje tardío de una conexión que quedó abierta se rechaza sin romper nada", async () => {
    const r = await running();
    const identity = server.app.service.authenticate(r.created.adminToken)!;
    advance(2 * HOUR);
    await server.app.service.sweep();
    advance(24 * HOUR);
    await server.app.service.sweep();
    const late = await server.app.service.adminCommand(identity, "socket-viejo", { requestId: "tarde", roomGeneration: 1, connectionEpoch: 1, commandSeq: 99, action: { type: "room.pause" } });
    expect(late).toMatchObject({ ok: false, code: "ROOM_UNAVAILABLE" });
    await expect(server.app.service.adminActivity(identity, "socket-viejo")).resolves.toBeUndefined();
    expect(await server.app.service.sync(identity, "socket-viejo")).toMatchObject({ ok: false, code: "ROOM_UNAVAILABLE" });
    await expect(server.app.service.attach(identity, "socket-viejo")).rejects.toThrow();
  });

  it("si no se puede borrar, la sala se conserva y se reintenta", async () => {
    const r = await running();
    advance(2 * HOUR);
    await server.app.service.sweep();
    advance(24 * HOUR);
    server.app.repo.raw.pragma("query_only = ON");
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 0 });
    expect(rows(r.roomId).rooms).toBe(1);
    expect(server.app.service.roomCount).toBe(1);
    server.app.repo.raw.pragma("query_only = OFF");
    expect(await server.app.service.sweep()).toEqual({ expired: 0, purged: 1 });
  });
});

describe("el vencimiento y la limpieza sobreviven a un reinicio del servicio", () => {
  it("el plazo de inactividad y la retención se calculan con lo guardado, no con lo que recuerde el proceso", async () => {
    const idle = await running();
    const closed = await running();
    await closed.admin.admin({ type: "room.close", confirm: true });
    const dbPath = server.dbPath;
    for (const c of clients.splice(0)) c.close();
    await server.stop(true); // conserva el archivo
    const folder = dbPath.replace(/\/test\.sqlite$/, "");
    advance(25 * HOUR); // el servicio estuvo apagado más que el plazo y que la retención

    server = await startServer({ dir: folder, now: () => new Date(wall), settings });
    expect(state(idle.code)!.phase).toBe("paused"); // recuperada pausada (CA-27)
    expect(await server.app.service.sweep()).toEqual({ expired: 1, purged: 1 }); // una vence y la cerrada se elimina
    expect(state(idle.code)!.phase).toBe("expired");
    expect(state(closed.code)).toBeUndefined();
  });
});
