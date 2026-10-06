import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomController } from "../../src/app/RoomController";
import { createRoom, joinRoom, startServer, TestClient, type TestServer } from "./testing/harness";

// P6-02: tiempo real que tarda en detectarse un corte de red SILENCIOSO (sin cierre limpio: el celular sale de cobertura, se apaga el
// wifi). Un proxy TCP deja de reenviar sin cerrar nada; así solo el latido (`pingInterval` 4 s + `pingTimeout` 5 s) puede darse cuenta.
// El objetivo de SPECS 6.2 es detectarlo en 10 s o menos. Esta prueba usa relojes reales: tarda ~10 s.

const GOAL_MS = 10_000;
let server: TestServer;
const closers: Array<() => void> = [];
beforeEach(async () => {
  server = await startServer({ settings: { tickIntervalMs: 0, sweepIntervalMs: 0 } });
});
afterEach(async () => {
  for (const c of closers.splice(0)) c();
  await server.stop();
});

/** Proxy TCP que se puede «cortar»: descarta el tráfico en ambos sentidos sin cerrar los sockets. */
async function blackholeProxy() {
  const target = Number(new URL(server.url).port);
  const sockets = new Set<net.Socket>();
  let cut = false;
  const srv = net.createServer((client) => {
    const upstream = net.connect(target, "127.0.0.1");
    sockets.add(client).add(upstream);
    client.on("data", (d) => !cut && upstream.write(d));
    upstream.on("data", (d) => !cut && client.write(d));
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.on("error", () => undefined);
    upstream.on("error", () => undefined);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  closers.push(() => {
    for (const s of sockets) s.destroy();
    srv.close();
  });
  return { url: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`, cut: () => void (cut = true), restore: () => void (cut = false) };
}

const state = (code: string) => server.app.service.inspect(code)!.state;
const waitFor = async (cond: () => boolean, what: string, ms = 20_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Tiempo agotado: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  return Date.now() - start;
};

async function roomWithController(viaProxy: "controller" | "admin") {
  const proxy = await blackholeProxy();
  const created = await createRoom(server.url);
  const code = created.body.code;
  const ana = await joinRoom(server.url, code, "Ana");
  const urlFor = (who: "controller" | "admin") => (viaProxy === who ? proxy.url : server.url);
  const admin = new TestClient(urlFor("admin"), created.body.adminToken);
  closers.push(() => admin.close());
  await admin.ready();
  const anaController = new RoomController(urlFor("controller"), ana.body.token);
  closers.push(() => anaController.dispose());
  anaController.connect();
  await waitFor(() => anaController.getState().status === "connected" && anaController.getState().summary !== null, "Ana conectada");
  await admin.until(() => admin.presence?.connectedCount === 1, "presencia");
  await admin.admin({ type: "control.assign", principalId: ana.body.principalId });
  await admin.admin({ type: "room.start" });
  await waitFor(() => anaController.getState().summary?.self.isController === true && anaController.getState().summary?.phase === "running", "Ana controla");
  return { proxy, code, admin, ana: anaController, anaId: ana.body.principalId, adminId: created.body.adminId };
}

describe("detección de cortes de red silenciosos (CA-24, CA-26, SPECS 6.2)", () => {
  it("el corte del controlador y el de la administradora se detectan en 10 s o menos, en el servidor y en el cliente", async () => {
    const a = await roomWithController("controller"); // se corta a quien tiene el turno
    const b = await roomWithController("admin"); // se corta a la administradora
    await new Promise((r) => setTimeout(r, 300));

    const cutAt = Date.now();
    a.proxy.cut();
    b.proxy.cut();
    const [serverController, clientController, serverAdmin] = await Promise.all([
      waitFor(() => state(a.code).phase === "paused" && state(a.code).controlOwner === null, "el servidor detecta el corte del controlador").then(() => Date.now() - cutAt),
      waitFor(() => a.ana.getState().status === "reconnecting", "el cliente del controlador se da cuenta").then(() => Date.now() - cutAt),
      waitFor(() => state(b.code).phase === "paused", "el servidor detecta el corte de la administradora").then(() => Date.now() - cutAt),
    ]);
    console.log(`  ℹ detección de un corte silencioso: servidor→controlador ${serverController} ms, cliente del controlador ${clientController} ms, servidor→administradora ${serverAdmin} ms (objetivo ≤ ${GOAL_MS} ms; latido ${server.app.settings.pingIntervalMs}+${server.app.settings.pingTimeoutMs} ms)`);
    expect(serverController).toBeLessThanOrEqual(GOAL_MS);
    expect(clientController).toBeLessThanOrEqual(GOAL_MS);
    expect(serverAdmin).toBeLessThanOrEqual(GOAL_MS);

    // Controlador: pausa y pierde el control. Administradora: pausa y el propietario se conserva (SPECS 6.2).
    expect(state(a.code)).toMatchObject({ phase: "paused", controlOwner: null });
    expect(state(b.code)).toMatchObject({ phase: "paused", controlOwner: { role: "participant", principalId: b.anaId } });

    // Al volver la red: el controlador regresa en ESPERA con la sala pausada; no recupera el turno solo, y nada se repite.
    a.proxy.restore();
    await waitFor(() => a.ana.getState().status === "connected" && a.ana.getState().summary !== null, "el controlador vuelve a conectar", 25_000);
    expect(a.ana.getState().summary?.self.isController).toBe(false);
    expect(a.ana.getState().summary?.phase).toBe("paused");
    expect(a.ana.getState().snapshot).toBeNull(); // la espera no recibe el estado de la aventura
    expect(state(a.code).controlOwner).toBeNull();
  }, 60_000);
});
