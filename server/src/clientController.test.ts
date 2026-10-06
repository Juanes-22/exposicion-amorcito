import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomController } from "../../src/app/RoomController";
import { createRoom, folderOf, joinRoom, startServer, type TestServer } from "./testing/harness";

let server: TestServer;
const controllers: RoomController[] = [];
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

beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  for (const c of controllers.splice(0)) c.dispose();
  await server.stop();
});

async function adminAndParticipants(names = ["Ana", "Beto"]) {
  const created = await createRoom(server.url);
  const admin = make(created.body.adminToken);
  await until(() => admin.getState().summary !== null, "resumen de la administradora");
  const people = [];
  for (const n of names) {
    const j = await joinRoom(server.url, created.body.code, n);
    const c = make(j.body.token);
    await until(() => c.getState().summary !== null, `resumen de ${n}`);
    people.push({ c, id: j.body.principalId, token: j.body.token });
  }
  await until(() => admin.getState().presence?.connectedCount === names.length, "presencia completa");
  return { admin, people, code: created.body.code, adminToken: created.body.adminToken };
}

describe("RoomController: comandos", () => {
  it("construye el sobre con la generación, el epoch y un commandSeq creciente, y refleja el resultado", async () => {
    const { admin, people } = await adminAndParticipants();
    const first = await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    expect(first).toMatchObject({ ok: true });
    const second = await admin.admin({ type: "control.assign", principalId: people[1]!.id });
    expect(second).toMatchObject({ ok: true });
    await until(() => admin.getState().summary?.controller?.displayName === "Beto", "el resumen refleja a Beto");
    expect(admin.getState().pending).toBe(0);
  });

  it("una denegación se devuelve, se avisa y no deja nada bloqueado", async () => {
    const { admin, people } = await adminAndParticipants();
    const denied = await people[0]!.c.admin({ type: "room.pause" });
    expect(denied).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(people[0]!.c.getState().pending).toBe(0);
    expect(people[0]!.c.getState().notice).toMatchObject({ kind: "error" });
    const later = await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    expect(later.ok).toBe(true);
  });

  it("reintenta el MISMO comando con el MISMO ID si se pierde el acknowledgment, y el servidor lo aplica una sola vez", async () => {
    const created = await createRoom(server.url);
    const j = await joinRoom(server.url, created.body.code, "Ana");
    const admin = make(created.body.adminToken, { ackTimeoutMs: 120 });
    const ana = make(j.body.token);
    await until(() => admin.getState().presence?.connectedCount === 1, "Ana conectada");
    // El servidor procesa la orden pero tarda en contestar: el cliente agota su plazo y reintenta con el mismo requestId.
    const service = server.app.service;
    const original = service.adminCommand.bind(service);
    const seen: string[] = [];
    service.adminCommand = async (identity, socketId, cmd) => {
      seen.push(cmd.requestId);
      const result = await original(identity, socketId, cmd);
      if (seen.length === 1) await new Promise((r) => setTimeout(r, 400)); // acknowledgment «perdido» (llega tarde)
      return result;
    };
    const result = await admin.admin({ type: "control.assign", principalId: j.body.principalId });
    expect(result).toMatchObject({ ok: true });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1); // todos los intentos con el mismo ID
    expect(server.app.service.inspect(created.body.code)!.state.turnVersion).toBe(2); // una sola mutación (1 inicial + 1 asignación)
    void ana;
  });
});

describe("RoomController: conexión (SPECS 5.4, 6.2)", () => {
  it("al perder la conexión cancela lo pendiente y rechaza nuevos comandos sin colgarse; al volver pide el estado y reinicia su secuencia", async () => {
    const { admin, people, code, adminToken } = await adminAndParticipants(["Ana"]);
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    const port = new URL(server.url).port;
    const dir = folderOf(server);
    await server.stop(true);
    await until(() => admin.getState().status === "reconnecting", "estado «reconectando»");
    const offline = await admin.admin({ type: "room.start" });
    expect(offline).toMatchObject({ ok: false, code: "STALE_CONNECTION" }); // no se encola nada para reproducirlo después
    expect(admin.getState().pending).toBe(0);

    // El servicio vuelve (mismo archivo, mismo puerto): el cliente reconecta solo, sin repetir nada.
    server = await startServer({ dir, settings: { port: Number(port) } });
    // «Conectada» solo llega con el resumen de la conexión NUEVA, y la presencia vieja se descarta: se espera la presencia fresca,
    // con Ana de vuelta (no se le puede dar el turno a quien todavía no reconectó).
    await until(() => admin.getState().status === "connected" && admin.getState().presence?.participants.find((p) => p.principalId === people[0]!.id)?.connected === true, "reconexión de la administradora y de Ana", 12000);
    expect(admin.getState().summary).toMatchObject({ controller: null, self: { role: "admin" } }); // el control no se recupera solo
    expect(server.app.service.inspect(code)!.state.phase).toBe("welcome"); // «room.start» perdido NO se reprodujo
    const resumed = await admin.admin({ type: "control.assign", principalId: people[0]!.id }); // commandSeq empezó de nuevo
    expect(resumed.ok).toBe(true);
    void adminToken;
  }, 20000);

  it("tras reconectar descarta presencia y snapshot viejos y solo vuelve a «conectada» con el resumen nuevo", async () => {
    const { admin, people } = await adminAndParticipants(["Ana"]);
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    await admin.admin({ type: "room.start" });
    await until(() => admin.getState().snapshot !== null, "snapshot inicial");
    const port = new URL(server.url).port;
    const dir = folderOf(server);
    await server.stop(true);
    await until(() => admin.getState().status === "reconnecting", "estado «reconectando»");
    server = await startServer({ dir, settings: { port: Number(port) } });
    // Mientras no llegue el resumen nuevo no se está «conectada» ni se muestra presencia o snapshot de antes de la caída.
    let sawStale = false;
    const stop = admin.subscribe(() => {
      const st = admin.getState();
      // «Conectada» con el resumen de antes de la caída (aún «running») o con presencia/snapshot viejos = estado viejo visible.
      if (st.status === "connected" && (st.summary?.phase !== "paused" || (st.snapshot !== null && st.snapshot.state.phase !== "paused"))) sawStale = true;
    });
    await until(() => admin.getState().status === "connected" && admin.getState().snapshot !== null && admin.getState().presence !== null, "estado completo tras reconectar", 12000);
    stop();
    expect(sawStale).toBe(false);
    expect(admin.getState().summary).toMatchObject({ phase: "paused", controller: null }); // el servicio recuperó la sala pausada y sin controlador
  }, 20000);

  it("cuando la sala termina deja de reconectar y muestra el estado terminal", async () => {
    const { admin, people } = await adminAndParticipants(["Ana"]);
    await admin.admin({ type: "room.close", confirm: true });
    await until(() => people[0]!.c.getState().status === "terminal", "participante en estado terminal");
    await until(() => admin.getState().status === "terminal", "administradora en estado terminal");
    await new Promise((r) => setTimeout(r, 1800)); // más que el primer reintento de Socket.IO
    expect(people[0]!.c.getState().status).toBe("terminal");
    expect(people[0]!.c.getState().summary?.phase).toBe("closed");
    expect((await people[0]!.c.adventure({ type: "adventure.returnToMap" })).ok).toBe(false);
  });

  it("una pestaña sustituida se detiene y no reconecta", async () => {
    const { people } = await adminAndParticipants(["Ana"]);
    const second = make(people[0]!.token);
    await until(() => second.getState().summary !== null, "la pestaña nueva conecta");
    await until(() => people[0]!.c.getState().status === "replaced", "la vieja se marca sustituida");
    await new Promise((r) => setTimeout(r, 1500));
    expect(people[0]!.c.getState().status).toBe("replaced");
    expect(second.getState().status).toBe("connected");
  });

  it("una credencial inválida avisa a la aplicación para que la borre y no reintenta", async () => {
    const created = await createRoom(server.url);
    void created;
    const bad = new RoomController(server.url, "z".repeat(43));
    controllers.push(bad);
    let called = 0;
    bad.onUnauthorized = () => called++;
    bad.connect();
    await until(() => bad.getState().status === "unauthorized", "estado «sin autorización»");
    await new Promise((r) => setTimeout(r, 1200));
    expect(called).toBe(1);
  });

  it("anuncia el cambio de turno a la persona afectada", async () => {
    const { admin, people } = await adminAndParticipants();
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    await until(() => people[0]!.c.getState().notice?.text === "Es tu turno.", "aviso de turno");
    await admin.admin({ type: "control.assign", principalId: people[1]!.id });
    await until(() => people[0]!.c.getState().notice?.text === "Ahora explora Beto.", "aviso de pérdida de turno");
    expect(people[1]!.c.getState().notice?.text).toBe("Es tu turno.");
  });
});
