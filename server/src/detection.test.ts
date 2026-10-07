import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShadowsState } from "../../shared/contracts/state";
import { RoomController } from "../../src/app/RoomController";
import { createRoom, joinRoom, startServer, type TestServer } from "./testing/harness";

// P6-02: tiempo real que tarda en detectarse un corte de red SILENCIOSO (sin cierre limpio: el celular sale de cobertura, se apaga el
// wifi). Un proxy TCP deja de reenviar sin cerrar nada; así solo el latido (`pingInterval` 4 s + `pingTimeout` 5 s) puede darse cuenta.
// El objetivo de SPECS 6.2 es detectarlo en 10 s o menos. Esta prueba usa relojes reales para la red: tarda ~10 s.
// Con participación simultánea el corte de una persona NO detiene a las demás (solo aparece «sin conexión» y conserva su avance),
// mientras que el de Vanessa pausa la aventura para todas.

const GOAL_MS = 10_000;
let server: TestServer;
const closers: Array<() => void> = [];
const controllers: RoomController[] = [];
beforeEach(async () => {
  // El reloj de simulación está congelado: lo que se mide aquí es el de la red, no el del juego.
  server = await startServer({ mono: () => 10_000, settings: { tickIntervalMs: 0, sweepIntervalMs: 0 } });
});
afterEach(async () => {
  for (const c of closers.splice(0)) c();
  for (const c of controllers.splice(0)) c.dispose();
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
const connect = (url: string, token: string) => {
  const c = new RoomController(url, token);
  controllers.push(c);
  c.connect();
  return c;
};
const samplesOf = (c: RoomController): number[] => (c.getState().me?.participant.activities.sombras as ShadowsState | undefined)?.samples.map((s) => s.distanceCm) ?? [];

/**
 * Una sala en exploración con Vanessa, Ana (que ya registró una posición de la linterna) y Beto. Los clientes del lado `cut` se conectan
 * por el proxy cortable; el resto, directo: son los testigos que ven lo que el servidor decide.
 */
async function exploringRoom(cut: "participant" | "admin") {
  const proxy = await blackholeProxy();
  const created = await createRoom(server.url);
  const code = created.body.code;
  const ana = await joinRoom(server.url, code, "Ana");
  const beto = await joinRoom(server.url, code, "Beto");
  const via = (who: "participant" | "admin") => (cut === who ? proxy.url : server.url);
  const admin = connect(via("admin"), created.body.adminToken);
  const anaC = connect(via("participant"), ana.body.token);
  const betoC = connect(server.url, beto.body.token);
  await waitFor(() => anaC.getState().me !== null && betoC.getState().me !== null && admin.getState().presence?.connectedCount === 2, "todas conectadas");
  expect(await admin.admin({ type: "room.start" })).toMatchObject({ ok: true });
  expect(await admin.admin({ type: "round.open" })).toMatchObject({ ok: true });
  await waitFor(() => [anaC, betoC].every((c) => c.getState().group?.adventure.round.stage === "exploration" && c.getState().summary?.roundVersion === state(code).roundVersion), "exploración visible");
  expect(await anaC.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
  expect(await anaC.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: true });
  return { proxy, code, admin, ana: anaC, beto: betoC, anaId: ana.body.principalId };
}

describe("detección de cortes de red silenciosos (CA-24, CA-26, SPECS 6.2)", () => {
  it("el corte de una persona y el de la administradora se detectan en 10 s o menos, en el servidor y en el cliente", async () => {
    const a = await exploringRoom("participant"); // se corta a una persona que juega
    const b = await exploringRoom("admin"); // se corta a la administradora
    await new Promise((r) => setTimeout(r, 300));

    const cutAt = Date.now();
    a.proxy.cut();
    b.proxy.cut();
    const since = () => Date.now() - cutAt;
    const [serverPerson, clientPerson, serverAdmin, clientAdmin] = await Promise.all([
      waitFor(() => a.admin.getState().presence?.participants.find((p) => p.principalId === a.anaId)?.connected === false, "el servidor detecta el corte de Ana").then(since),
      waitFor(() => a.ana.getState().status === "reconnecting", "el cliente de Ana se da cuenta").then(since),
      waitFor(() => state(b.code).phase === "paused", "el servidor detecta el corte de la administradora").then(since),
      waitFor(() => b.admin.getState().status === "reconnecting", "el cliente de la administradora se da cuenta").then(since),
    ]);
    console.log(`  ℹ detección de un corte silencioso: servidor→persona ${serverPerson} ms, cliente de la persona ${clientPerson} ms, servidor→administradora ${serverAdmin} ms, cliente de la administradora ${clientAdmin} ms (objetivo ≤ ${GOAL_MS} ms; latido ${server.app.settings.pingIntervalMs}+${server.app.settings.pingTimeoutMs} ms)`);
    for (const [what, ms] of Object.entries({ serverPerson, clientPerson, serverAdmin, clientAdmin })) expect(ms, what).toBeLessThanOrEqual(GOAL_MS);

    // Persona: la aventura NO se detiene. Su personaje aparece «sin conexión», conserva su lugar en el contador y las demás siguen jugando.
    expect(state(a.code).phase).toBe("running");
    await waitFor(() => a.beto.getState().characters[a.anaId]?.connected === false, "Beto ve a Ana sin conexión");
    expect(a.admin.getState().presence).toMatchObject({ connectedCount: 1, round: { ready: 0, total: 2 } });
    expect(await a.beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
    // Administradora: pausa para todas y NO se entrega la conducción a nadie; las personas ven que ella no está.
    expect(state(b.code)).toMatchObject({ phase: "paused", resumePhase: "running" });
    await waitFor(() => b.beto.getState().summary?.phase === "paused" && b.beto.getState().summary?.adminConnected === false, "Beto ve la pausa y la ausencia de Vanessa");
    expect(await b.beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });

    // Al volver la red cada una regresa con el estado vigente y nada se repite.
    a.proxy.restore();
    b.proxy.restore();
    await Promise.all([
      waitFor(() => a.ana.getState().status === "connected" && a.ana.getState().me !== null, "Ana vuelve a conectar", 30_000),
      waitFor(() => b.admin.getState().status === "connected" && b.admin.getState().presence !== null && b.admin.getState().group !== null, "la administradora vuelve a conectar", 30_000),
    ]);
    // Ana retoma donde iba: su prueba se guardó y sigue en la aventura en curso, con su personaje de nuevo «en línea».
    expect(samplesOf(a.ana)).toEqual([20]);
    expect(a.ana.getState().summary).toMatchObject({ phase: "running", self: { observer: false } });
    await waitFor(() => a.beto.getState().characters[a.anaId]?.connected === true && a.admin.getState().presence?.connectedCount === 2, "Ana de nuevo en línea para todas");
    expect(await a.ana.act({ type: "shadows.sample", distanceCm: 50 })).toMatchObject({ ok: true });
    await waitFor(() => a.admin.getState().presence?.round.ready === 1, "Ana lista en el contador");
    // Vanessa regresa con la sala pausada y sin reanudarla sola: la conducción vuelve a ella, no a nadie más.
    expect(b.admin.getState().summary).toMatchObject({ phase: "paused", resumePhase: "running", self: { role: "admin" } });
    expect(state(b.code).phase).toBe("paused");
    await waitFor(() => b.beto.getState().summary?.adminConnected === true, "Beto ve volver a Vanessa");
    expect(b.beto.getState().summary?.phase).toBe("paused");
    expect(await b.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    await waitFor(() => b.ana.getState().summary?.phase === "running" && b.ana.getState().summary?.roundVersion === state(b.code).roundVersion, "la aventura sigue");
    expect(await b.ana.act({ type: "shadows.sample", distanceCm: 50 })).toMatchObject({ ok: true });
    expect(samplesOf(b.ana)).toEqual([20, 50]);
  }, 90_000);
});
