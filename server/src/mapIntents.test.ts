import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdventureAction, CommandResult } from "../../shared/contracts/actions";
import type { RoomState } from "../../shared/contracts/state";
import { playerAt } from "../../shared/domain/adventure";
import { createRoomState } from "../../shared/domain/room";
import { bundle, Driver, finishShadows } from "../../shared/testing/drive";
import { startIntentRouter } from "../../src/app/mapIntents";
import { shouldAcceptFrame } from "../../src/app/RoomController";
import { ClientClock } from "../../src/game/bridge/ClientClock";
import { GameBridge } from "../../src/game/bridge/GameBridge";

const { config, map } = bundle;
const project = { bundle: { config, map } };
const ok: CommandResult = { ok: true, requestId: "x", stateVersion: 2, turnVersion: 2 };

/** Controlador falso: guarda los comandos y deja que cada prueba decida qué estado «devuelve el servidor». */
function setup(opts: { driver?: Driver; canAct?: boolean } = {}) {
  let t = 1000;
  const bridge = new GameBridge(new ClientClock(() => t));
  const driver = opts.driver ?? new Driver();
  const base = createRoomState({ roomId: "r", code: "ABC234", config, map, configHash: "h", mapHash: "m", nowIso: "2026-10-05T00:00:00.000Z" });
  const roomOf = (adventure = driver.state): RoomState => ({ ...base, phase: "running", controlOwner: { role: "participant", principalId: "p1" }, adventure });
  const ctl = {
    snapshotState: roomOf(),
    calls: [] as AdventureAction[],
    notices: [] as string[],
    onCommand: undefined as undefined | ((a: AdventureAction) => CommandResult | Promise<CommandResult>),
    getState() {
      return { snapshot: { state: this.snapshotState }, pending: 0 } as never;
    },
    async adventure(a: AdventureAction) {
      this.calls.push(a);
      return (await this.onCommand?.(a)) ?? ok;
    },
    notify(_kind: "info" | "error", text: string) {
      this.notices.push(text);
    },
  };
  bridge.emit("app:snapshot", { state: ctl.snapshotState, controller: null });
  bridge.emit("app:permissions", { canAct: opts.canAct ?? true, reason: opts.canAct === false ? "Usa «Tomar control» para participar." : null });
  const token = bridge.beginScene();
  const results: Array<{ requestId: string; accepted: boolean; reason?: string }> = [];
  bridge.on("app:request-result", (r) => results.push(r));
  const stop = startIntentRouter({ bridge, controller: ctl as never, project, pollMs: 20 });
  const request = (intent: Parameters<typeof bridge.emit<"game:action-request">>[1]["intent"], requestId = "r1", tk = token) => {
    bridge.emit("game:action-request", { intent, requestId, token: tk });
  };
  /** Simula lo que haría el servidor al aceptar un moveTo: aplica la transición real del dominio y publica el snapshot. */
  const serverAppliesMoves = () => {
    ctl.onCommand = (a) => {
      if (a.type === "player.moveTo") {
        driver.activeMs = Math.round(bridge.clock.now());
        driver.do(a);
        ctl.snapshotState = roomOf();
        bridge.emit("app:snapshot", { state: ctl.snapshotState, controller: null });
      }
      return ok;
    };
  };
  return { bridge, ctl, driver, results, request, stop, token, advance: (ms: number) => void (t += ms), serverAppliesMoves, roomOf };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("enrutador de intenciones del mapa", () => {
  it("un toque en el mapa se convierte en player.moveTo con las coordenadas de mundo y se informa su resultado", async () => {
    const s = setup();
    s.request({ type: "move", target: { x: 400, y: 500 } });
    await flush();
    expect(s.ctl.calls).toEqual([{ type: "player.moveTo", target: { x: 400, y: 500 } }]);
    expect(s.results).toEqual([{ requestId: "r1", accepted: true }]);
    s.stop();
  });

  it("sin permiso no envía nada, explica por qué y libera la solicitud (denegación visible)", async () => {
    const s = setup({ canAct: false });
    s.request({ type: "move", target: { x: 400, y: 500 } });
    await flush();
    expect(s.ctl.calls).toEqual([]);
    expect(s.results).toEqual([{ requestId: "r1", accepted: false, reason: "Usa «Tomar control» para participar." }]);
    expect(s.ctl.notices).toEqual(["Usa «Tomar control» para participar."]);
    s.stop();
  });

  it("devuelve como denegada la respuesta del servidor y conserva su motivo", async () => {
    const s = setup();
    s.ctl.onCommand = () => ({ ok: false, requestId: "x", code: "INVALID_PAYLOAD", message: "Ese punto no se puede pisar. Toca un lugar libre del laboratorio." });
    s.request({ type: "move", target: { x: 640, y: 100 } });
    await flush();
    expect(s.results[0]).toMatchObject({ accepted: false, reason: expect.stringContaining("no se puede pisar") });
    s.stop();
  });

  it("ignora solicitudes de una escena ya sustituida (token viejo)", async () => {
    const s = setup();
    s.bridge.beginScene(); // otra escena toma el relevo
    s.request({ type: "move", target: { x: 400, y: 500 } }, "viejo", s.token);
    await flush();
    expect(s.ctl.calls).toEqual([]);
    expect(s.results).toEqual([]);
    s.stop();
  });

  it("tocar una mesa bloqueada no hace caminar a nadie: se explica el orden del recorrido", async () => {
    const s = setup();
    s.request({ type: "openStation", stationId: "rampas" });
    await flush();
    expect(s.ctl.calls).toEqual([]);
    expect(s.results[0]).toMatchObject({ accepted: false, reason: "Primero hay que completar la mesa anterior." });
    s.request({ type: "openStation", stationId: "inventor" }, "r2");
    await flush();
    expect(s.results[1]).toMatchObject({ accepted: false, reason: "Primero hay que completar las tres mesas." });
    s.stop();
  });

  it("tocar una mesa lejana: camina hasta ella y la abre solo cuando el reloj dice que llegó", async () => {
    const s = setup();
    s.serverAppliesMoves();
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo"]);
    expect((s.ctl.calls[0] as { target: unknown }).target).toEqual(map.stations[0]!.point);
    const plan = s.ctl.snapshotState.adventure.player.plan!;
    const durationMs = (plan.lengthTotal / plan.speed) * 1000;
    s.advance(durationMs - 300);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo"]); // aún camina
    s.advance(400);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo", "station.open"]);
    expect(s.ctl.calls[1]).toEqual({ type: "station.open", stationId: "sombras", origin: "map" });
    await vi.advanceTimersByTimeAsync(500);
    expect(s.ctl.calls).toHaveLength(2); // y una sola vez
    s.stop();
  });

  it("en pausa el reloj no avanza y no se abre la mesa; al reanudar sigue donde iba", async () => {
    const s = setup();
    s.serverAppliesMoves();
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    const plan = s.ctl.snapshotState.adventure.player.plan!;
    const durationMs = (plan.lengthTotal / plan.speed) * 1000;
    s.advance(durationMs / 2);
    // Un servidor real congela el reloj de simulación exactamente donde estaba al pausar y lo publica en el snapshot.
    const frozenAt = Math.round(s.bridge.clock.now());
    const atFrozen = { ...s.driver.state, timeline: { activeMs: frozenAt } };
    const paused = { ...s.roomOf(atFrozen), phase: "paused" as const, resumePhase: "running" as const };
    s.bridge.emit("app:snapshot", { state: paused, controller: null });
    s.ctl.snapshotState = paused;
    s.advance(10 * 60_000); // diez minutos de conversación
    await vi.advanceTimersByTimeAsync(300);
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo"]);
    expect(Math.round(s.bridge.clock.now())).toBe(frozenAt); // el reloj siguió quieto: la conversación no se suma
    // Se reanuda (mismo valor de reloj): otra vez corre, y solo cuando completa lo que faltaba se abre la mesa.
    const resumed = s.roomOf(atFrozen);
    s.bridge.emit("app:snapshot", { state: resumed, controller: null });
    s.ctl.snapshotState = resumed;
    s.advance(durationMs / 2 + 200);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo", "station.open"]);
    s.stop();
  });

  it("un toque nuevo cancela la apertura pendiente: un destino viejo no abre una mesa", async () => {
    const s = setup();
    s.serverAppliesMoves();
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    s.request({ type: "move", target: { x: 900, y: 600 } }, "r2");
    await flush();
    s.advance(60_000);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo", "player.moveTo"]);
    s.stop();
  });

  it("si pierde el turno antes de llegar, no abre la mesa", async () => {
    const s = setup();
    s.serverAppliesMoves();
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    s.bridge.emit("app:permissions", { canAct: false, reason: "Ya no tienes el turno." });
    s.advance(60_000);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo"]);
    s.stop();
  });

  it("si ya está junto a la mesa la abre sin caminar", async () => {
    const d = new Driver();
    d.state.player.feet = { ...map.stations[0]!.point };
    const s = setup({ driver: d });
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    expect(s.ctl.calls).toEqual([{ type: "station.open", stationId: "sombras", origin: "map" }]);
    s.stop();
  });

  it("no ofrece abrir otra mesa desde dentro de una actividad", async () => {
    const d = new Driver();
    finishShadows(d); // deja abierta la mesa de Sombras
    const s = setup({ driver: d });
    s.request({ type: "openStation", stationId: "rampas" });
    await flush();
    expect(s.ctl.calls).toEqual([]);
    expect(s.results[0]).toMatchObject({ accepted: false, reason: "Vuelve al mapa para abrir otra mesa." });
    void playerAt;
    s.stop();
  });

  it("al detenerse deja de escuchar y cancela lo pendiente", async () => {
    const s = setup();
    s.serverAppliesMoves();
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    s.stop();
    s.advance(60_000);
    await vi.advanceTimersByTimeAsync(300);
    s.request({ type: "move", target: { x: 400, y: 500 } }, "r9");
    await flush();
    expect(s.ctl.calls.map((c) => c.type)).toEqual(["player.moveTo"]);
  });
});

describe("shouldAcceptFrame (SPECS 5.6)", () => {
  const known = { generation: 2, turnVersion: 5, stateVersion: 10, lastSeq: 7 };
  const frame = (over: object = {}) => ({ roomGeneration: 2, turnVersion: 5, stateVersion: 10, frameSeq: 8, ...over });
  it("acepta la muestra vigente y siguiente", () => {
    expect(shouldAcceptFrame(frame(), known)).toBe(true);
    expect(shouldAcceptFrame(frame({ stateVersion: 11, turnVersion: 6 }), known)).toBe(true);
  });
  it("descarta las de otro recorrido, de un turno superado, de un estado anterior al snapshot y las repetidas o fuera de orden", () => {
    expect(shouldAcceptFrame(frame({ roomGeneration: 1 }), known)).toBe(false);
    expect(shouldAcceptFrame(frame({ roomGeneration: 3 }), known)).toBe(false);
    expect(shouldAcceptFrame(frame({ turnVersion: 4 }), known)).toBe(false);
    expect(shouldAcceptFrame(frame({ stateVersion: 9 }), known)).toBe(false);
    expect(shouldAcceptFrame(frame({ frameSeq: 7 }), known)).toBe(false);
    expect(shouldAcceptFrame(frame({ frameSeq: 3 }), known)).toBe(false);
  });
});
