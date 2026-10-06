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

describe("RoomController: frames de simulación (CT-06)", () => {
  it("durante un trayecto llegan muchos frames pero NINGUNO avisa al estado observable de React; solo los snapshots", async () => {
    const { admin, people } = await adminAndParticipants(["Ana"]);
    const ana = people[0]!.c;
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    await admin.admin({ type: "room.start" });
    // La interfaz real solo habilita los controles con la aventura EN CURSO (la fase `running` ya trae el turnVersion vigente).
    await until(() => ana.getState().summary?.self.isController === true && ana.getState().summary?.phase === "running" && ana.getState().snapshot?.state.phase === "running" && admin.getState().snapshot?.state.phase === "running", "controladora y proyección con la aventura en curso");

    let frames = 0;
    let notifications = 0;
    const offFrames = admin.subscribeFrames(() => void frames++);
    const offState = admin.subscribe(() => void notifications++);
    const target = server.app.project.map.stations[1]!.point; // ~2,6 s a 150 u/s
    const moved = await ana.adventure({ type: "player.moveTo", target });
    expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true });
    await until(() => admin.getState().snapshot?.state.adventure.player.plan !== null, "snapshot con el plan");
    await until(() => admin.getState().snapshot?.state.adventure.player.plan === null, "llegada", 9000);
    offFrames();
    offState();
    expect(frames).toBeGreaterThanOrEqual(15); // 10 Hz durante ~2,6 s
    // Un aviso por el snapshot del plan y otro por el de la llegada. Los ~26 frames no provocan ningún render de React.
    expect(notifications).toBeLessThanOrEqual(3);
    expect(notifications).toBeGreaterThanOrEqual(1);
  }, 20000);

  it("descarta los frames de antes de conectarse: sin snapshot no hay plan que interpolar", async () => {
    const created = await createRoom(server.url);
    const admin = make(created.body.adminToken);
    let frames = 0;
    admin.subscribeFrames(() => void frames++);
    await until(() => admin.getState().summary !== null, "resumen");
    // Sala en bienvenida: nada se mueve y no se emite ningún frame.
    await new Promise((r) => setTimeout(r, 400));
    expect(frames).toBe(0);
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

  it("avisa a la aplicación cuando la sala se reinicia (nueva generación), y solo entonces", async () => {
    const { admin, people } = await adminAndParticipants();
    let changes = 0;
    people[0]!.c.onGenerationChange = () => changes++;
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    await admin.admin({ type: "room.start" });
    await until(() => people[0]!.c.getState().summary?.phase === "running", "sala en curso");
    expect(changes).toBe(0); // un cambio de fase o de turno no es un reinicio
    await admin.admin({ type: "room.reset", confirm: true });
    await until(() => people[0]!.c.getState().summary?.phase === "welcome", "sala reiniciada");
    expect(changes).toBe(1);
    expect(people[0]!.c.getState().summary?.roomGeneration).toBe(2);
  });

  it("al perder el turno añade el aviso de la aplicación (p. ej. un borrador sin compartir) solo cuando lo hay (SPECS 3.1)", async () => {
    const { admin, people } = await adminAndParticipants();
    let unshared = true;
    people[0]!.c.turnLossHint = () => (unshared ? "Quedó un texto sin compartir en tu borrador; no se envió al grupo." : null);
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    await until(() => people[0]!.c.getState().notice?.text === "Es tu turno.", "aviso de turno");
    await admin.admin({ type: "control.assign", principalId: people[1]!.id });
    await until(() => people[0]!.c.getState().notice?.text?.startsWith("Ahora explora Beto.") === true, "aviso de pérdida de turno");
    expect(people[0]!.c.getState().notice?.text).toBe("Ahora explora Beto. Quedó un texto sin compartir en tu borrador; no se envió al grupo.");
    // Sin borrador, el aviso queda como siempre.
    unshared = false;
    await admin.admin({ type: "control.assign", principalId: people[0]!.id });
    await until(() => people[0]!.c.getState().notice?.text === "Es tu turno.", "vuelve el turno");
    await admin.admin({ type: "control.assign", principalId: people[1]!.id });
    await until(() => people[0]!.c.getState().notice?.text === "Ahora explora Beto.", "pérdida sin borrador");
  });
});
