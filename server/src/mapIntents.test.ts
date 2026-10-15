import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, ParticipantAction } from "../../shared/contracts/actions";
import type { PersonalView } from "../../shared/contracts/state";
import { planDurationMs } from "../../shared/domain/movement";
import { bundle, Driver } from "../../shared/testing/drive";
import { startIntentRouter, stationTarget } from "../../src/app/mapIntents";
import { RoomController, type RoomClientState } from "../../src/app/RoomController";
import { permissionsFor } from "../../src/app/view";
import { ClientClock } from "../../src/game/bridge/ClientClock";
import { GameBridge } from "../../src/game/bridge/GameBridge";
import type { MapIntent } from "../../src/game/bridge/events";
import { createRoom, joinRoom, setupRoom, startServer, type TestServer } from "./testing/harness";

const { config, map } = bundle;
const project = { bundle: { config, map } };
const ok: CommandResult = { ok: true, requestId: "x", stateVersion: 2, roundVersion: 2 };
const fail = (code: "INVALID_STEP" | "STALE_ROUND" | "INVALID_PAYLOAD", message: string): CommandResult => ({ ok: false, requestId: "x", code, message });
const sombras = map.stations.find((s) => s.activityId === "sombras")!;

// ---- parte 1: el enrutador con un puerto falso cuyo «servidor» es el dominio real ------------------------------------------------

interface Scenario {
  /** Deja la sala del dominio en el punto que interesa; por defecto, la mesa de Sombras abierta en exploración. */
  prepare?: (d: Driver) => void;
  /** Cambia lo que la pantalla ve (conexión, papel…) sin tocar el dominio. */
  override?: (s: RoomClientState) => RoomClientState;
  /** No informar de permisos al puente: como si la aplicación aún no los hubiera calculado. */
  noPermissions?: boolean;
}

/**
 * Pantalla de Ana: el puerto guarda las acciones que recibe y, salvo que la prueba diga otra cosa, las aplica con las MISMAS funciones
 * de dominio que el servidor (incluidas la ruta, la proximidad a la mesa y las fases de la ronda). Los permisos son los de la
 * aplicación (`permissionsFor`) y el reloj del puente es el de simulación, que solo avanza cuando la prueba lo publica.
 */
function setup(scenario: Scenario = {}) {
  const d = new Driver(["ana", "beto"]);
  (scenario.prepare ?? ((x) => x.toExploration(0)))(d);
  let t = 1000; // reloj del dispositivo
  let seq = 0;
  const bridge = new GameBridge(new ClientClock(() => t));
  const clientState = (): RoomClientState => {
    const r = d.room;
    const base: RoomClientState = {
      status: "connected",
      summary: { code: r.code, roomGeneration: 1, stateVersion: r.stateVersion, roundVersion: r.roundVersion, phase: r.phase, resumePhase: r.resumePhase, adminConnected: true, configMismatch: false, self: { principalId: "ana", role: "participant", displayName: "Ana", color: "azul", connectionEpoch: 1, observer: false } },
      group: { roomGeneration: 1, stateVersion: r.stateVersion, roundVersion: r.roundVersion, phase: r.phase, adventure: r.adventure, effects: [] },
      me: { roomGeneration: 1, stateVersion: r.stateVersion, participant: d.person("ana") },
      characters: {},
      presence: null,
      pending: 0,
      notice: null,
    };
    return scenario.override ? scenario.override(base) : base;
  };
  const port = {
    calls: [] as ParticipantAction[],
    notices: [] as string[],
    /** Lo que «responde el servidor»; por defecto aplica la acción al dominio. */
    onAct: ((a: ParticipantAction): CommandResult | Promise<CommandResult> => {
      d.activeMs = Math.round(bridge.clock.now()); // el servidor procesa con su reloj de simulación
      return d.act("ana", a) ? ok : fail("INVALID_STEP", d.lastError?.message ?? "");
    }) as (a: ParticipantAction) => CommandResult | Promise<CommandResult>,
    getState: clientState,
    async act(a: ParticipantAction) {
      this.calls.push(a);
      return this.onAct(a);
    },
    notify(_kind: "info" | "error", text: string) {
      this.notices.push(text);
    },
  };
  /** Publica al puente lo que la aplicación calcularía: los permisos y la muestra del reloj del servidor. */
  const publish = () => {
    if (!scenario.noPermissions) bridge.emit("app:permissions", permissionsFor(clientState()));
    bridge.emit("app:clock", { roomGeneration: 1, stateVersion: d.room.stateVersion, activeMs: d.activeMs, running: d.room.phase === "running", seq: ++seq });
  };
  publish();
  const token = bridge.beginScene();
  const results: Array<{ requestId: string; accepted: boolean; reason?: string }> = [];
  bridge.on("app:request-result", (r) => results.push(r));
  const stop = startIntentRouter({ bridge, port, project, pollMs: 20 });
  const request = (intent: MapIntent, requestId = "r1", tk = token) => bridge.emit("game:action-request", { intent, requestId, token: tk });
  const types = () => port.calls.map((c) => c.type);
  /** Vanessa cambia la sala: el dominio la procesa con el reloj de simulación vigente y la pantalla recibe lo nuevo. */
  const admin = (action: Parameters<Driver["admin"]>[0]) => {
    d.activeMs = Math.round(bridge.clock.now());
    d.must(d.admin(action), action.type);
    publish();
  };
  return { d, bridge, port, results, request, stop, token, types, admin, publish, advance: (ms: number) => void (t += ms) };
}
type Setup = ReturnType<typeof setup>;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const arrivalMs = (s: Setup) => planDurationMs(s.d.person("ana").character.plan!);

describe("enrutador de intenciones del mapa", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  describe("caminar", () => {
    it("un toque en el mapa se convierte en player.moveTo con las coordenadas de mundo y se informa su resultado", async () => {
      const s = setup();
      s.request({ type: "move", target: { x: 640, y: 450 } });
      await flush();
      expect(s.port.calls).toEqual([{ type: "player.moveTo", target: { x: 640, y: 450 } }]);
      expect(s.results).toEqual([{ requestId: "r1", accepted: true }]);
      expect(s.d.person("ana").character.plan).not.toBeNull(); // y el «servidor» la aplicó de verdad
      s.stop();
    });

    it("también se camina durante la preparación, antes de que Vanessa abra la mesa", async () => {
      const s = setup({ prepare: (d) => d.admin({ type: "room.start" }) });
      s.request({ type: "move", target: { x: 640, y: 450 } });
      await flush();
      expect(s.results).toEqual([{ requestId: "r1", accepted: true }]);
      s.stop();
    });

    it.each<[string, Scenario, string]>([
      ["antes de comenzar la aventura", { prepare: () => undefined }, "La aventura todavía no comienza."],
      ["con la sala en pausa", { prepare: (d) => (d.toExploration(0), d.admin({ type: "room.pause" })) }, "La aventura está en pausa."],
      ["mientras el grupo conversa", { prepare: (d) => (d.toExploration(0), d.admin({ type: "round.converse", withPending: true })) }, "Estamos conversando: mira la proyección."],
      ["sin conexión con la sala", { override: (st) => ({ ...st, status: "reconnecting" }) }, "Sin conexión con la sala."],
      ["quien observa", { override: (st) => ({ ...st, me: null, summary: { ...st.summary!, self: { ...st.summary!.self, observer: true } } }) }, "Estás como observador."],
    ])("%s no se envía nada: se explica por qué y se libera la solicitud (denegación visible)", async (_name, scenario, reason) => {
      const s = setup(scenario);
      s.request({ type: "move", target: { x: 640, y: 450 } });
      s.request({ type: "openStation", stationId: "sombras" }, "r2");
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results).toEqual([
        { requestId: "r1", accepted: false, reason },
        { requestId: "r2", accepted: false, reason },
      ]);
      expect(s.port.notices).toEqual([reason, reason]);
      s.stop();
    });

    it("si la aplicación aún no ha informado de permisos, no se mueve nada y el texto es genérico", async () => {
      const s = setup({ noPermissions: true });
      s.request({ type: "move", target: { x: 640, y: 450 } });
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results).toEqual([{ requestId: "r1", accepted: false, reason: "Ahora no puedes mover a tu personaje." }]);
      s.stop();
    });

    it("devuelve como denegada la respuesta del servidor y conserva su motivo, sin duplicar el aviso", async () => {
      const s = setup();
      s.port.onAct = () => fail("INVALID_PAYLOAD", "Ese punto no se puede pisar. Toca un lugar libre del laboratorio.");
      s.request({ type: "move", target: { x: 640, y: 100 } });
      await flush();
      expect(s.results[0]).toMatchObject({ accepted: false, reason: expect.stringContaining("no se puede pisar") });
      expect(s.port.notices).toEqual([]); // el aviso de un rechazo del servidor lo da el propio controlador de la sala
      s.stop();
    });

    it("sin estado todavía (la aventura no ha cargado) no envía nada", async () => {
      const s = setup({ override: (st) => ({ ...st, me: null }) });
      s.bridge.emit("app:permissions", { canMove: true, canExplore: true, reason: null }); // permisos adelantados al estado
      s.request({ type: "move", target: { x: 640, y: 450 } });
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results).toEqual([{ requestId: "r1", accepted: false, reason: "Todavía se está cargando la aventura." }]);
      s.stop();
    });

    it("ignora solicitudes de una escena ya sustituida (token viejo)", async () => {
      const s = setup();
      s.bridge.beginScene(); // otra escena toma el relevo
      s.request({ type: "move", target: { x: 640, y: 450 } }, "viejo", s.token);
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results).toEqual([]);
      s.stop();
    });
  });

  describe("tocar una mesa", () => {
    it("solo se abre la mesa habilitada: las futuras y las ya pasadas se rechazan con texto y nadie camina", async () => {
      const s = setup(); // ronda 0: Sombras
      s.request({ type: "openStation", stationId: "rampas" });
      s.request({ type: "openStation", stationId: "cajas" }, "r2");
      s.request({ type: "openStation", stationId: "no-existe" }, "r3");
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results).toEqual([
        { requestId: "r1", accepted: false, reason: "Esa mesa se habilitará más adelante." },
        { requestId: "r2", accepted: false, reason: "Esa mesa se habilitará más adelante." },
        { requestId: "r3", accepted: false, reason: "Esa mesa no está en el mapa." },
      ]);
      s.stop();

      // Con la ronda de Rampas en curso, Sombras ya pasó: también se rechaza, sin caminar ni enviar nada.
      const later = setup({ prepare: (d) => d.toExploration(1) });
      later.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(later.port.calls).toEqual([]);
      expect(later.results[0]).toMatchObject({ accepted: false, reason: expect.any(String) });
      expect(later.results[0]!.reason!.length).toBeGreaterThan(10);
      later.stop();
    });

    it("durante la preparación se explica que Vanessa todavía no abrió la mesa", async () => {
      const s = setup({ prepare: (d) => d.admin({ type: "room.start" }) });
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results[0]).toMatchObject({ accepted: false, reason: "Vanessa abrirá la mesa en un momento." });
      s.stop();
    });

    it("tras la última mesa no queda mesa que abrir: se manda al inventor (rama defensiva: los permisos ya lo impiden)", async () => {
      const s = setup({ prepare: (d) => d.playToClosing() });
      s.bridge.emit("app:permissions", { canMove: true, canExplore: true, reason: null });
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results[0]).toMatchObject({ accepted: false, reason: "Ya pasamos por todas las mesas: ve al inventor de preguntas." });
      s.stop();
    });

    describe("el inventor, como una mesa", () => {
      it("en el cierre se camina hasta el inventor; tocar la máquina antes de que Vanessa lo abra lo explica", async () => {
        const s = setup({ prepare: (d) => d.playToClosing() });
        s.request({ type: "move", target: { x: 640, y: 450 } });
        await flush();
        expect(s.results).toEqual([{ requestId: "r1", accepted: true }]);
        s.request({ type: "openStation", stationId: "inventor" }, "r2");
        await flush();
        expect(s.types()).toEqual(["player.moveTo"]);
        expect(s.results[1]).toEqual({ requestId: "r2", accepted: false, reason: "Vanessa abrirá el inventor en un momento." });
        s.stop();
      });

      it("durante una mesa, la máquina del inventor todavía no se abre", async () => {
        const s = setup();
        s.request({ type: "openStation", stationId: "inventor" });
        await flush();
        expect(s.port.calls).toEqual([]);
        expect(s.results[0]).toMatchObject({ accepted: false, reason: "El inventor se abre al final del recorrido, después de la última mesa." });
        s.stop();
      });

      it("abierto: tocar la máquina lejana camina hasta ella y entra al llegar, según el reloj de simulación", async () => {
        const s = setup({ prepare: (d) => d.playToClosing() });
        s.admin({ type: "inventor.open" });
        s.request({ type: "openStation", stationId: "inventor" });
        await flush();
        expect(s.types()).toEqual(["player.moveTo"]);
        expect((s.port.calls[0] as { target: unknown }).target).toEqual(stationTarget(project, "inventor")!.point);
        const duration = arrivalMs(s);
        s.advance(duration + 100);
        await vi.advanceTimersByTimeAsync(100);
        expect(s.port.calls[1]).toEqual({ type: "station.open", stationId: "inventor", origin: "map" });
        expect(s.d.person("ana").view).toEqual<PersonalView>({ kind: "inventor" }); // el dominio la aceptó: llegó de verdad
        s.stop();
      });
    });

    it("tocar una mesa lejana: camina hasta ella y la abre solo cuando el reloj de simulación dice que llegó", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(s.types()).toEqual(["player.moveTo"]);
      expect((s.port.calls[0] as { target: unknown }).target).toEqual(sombras.point);
      expect(s.results).toEqual([{ requestId: "r1", accepted: true }]);
      const duration = arrivalMs(s);
      expect(duration).toBeGreaterThan(1000); // está lejos: hay trayecto
      s.advance(duration - 300);
      await vi.advanceTimersByTimeAsync(200);
      expect(s.types()).toEqual(["player.moveTo"]); // aún camina
      s.advance(400);
      await vi.advanceTimersByTimeAsync(100);
      expect(s.types()).toEqual(["player.moveTo", "station.open"]);
      expect(s.port.calls[1]).toEqual({ type: "station.open", stationId: "sombras", origin: "map" });
      expect(s.d.person("ana").view).toEqual<PersonalView>({ kind: "activity", activityId: "sombras" }); // el dominio la aceptó: llegó de verdad
      await vi.advanceTimersByTimeAsync(500);
      expect(s.port.calls).toHaveLength(2); // y una sola vez
      s.stop();
    });

    it("espera la llegada con el reloj de simulación y no con el del dispositivo: con el reloj detenido no se abre aunque pasen minutos", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      const duration = arrivalMs(s);
      s.advance(duration / 2);
      // Una muestra del servidor con el reloj detenido (sin cambiar de fase): el reloj de simulación se congela donde estaba.
      const frozenAt = Math.round(s.bridge.clock.now());
      s.bridge.emit("app:clock", { roomGeneration: 1, stateVersion: 3, activeMs: frozenAt, running: false, seq: 100 });
      s.advance(10 * 60_000); // diez minutos del dispositivo
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]);
      expect(Math.round(s.bridge.clock.now())).toBe(frozenAt); // el reloj siguió quieto: esos minutos no cuentan
      // El reloj vuelve a correr desde el mismo valor: solo cuando completa lo que faltaba se abre la mesa.
      s.bridge.emit("app:clock", { roomGeneration: 1, stateVersion: 3, activeMs: frozenAt, running: true, seq: 101 });
      s.advance(duration / 2 - 200);
      await vi.advanceTimersByTimeAsync(100);
      expect(s.types()).toEqual(["player.moveTo"]);
      s.advance(400);
      await vi.advanceTimersByTimeAsync(100);
      expect(s.types()).toEqual(["player.moveTo", "station.open"]);
      s.stop();
    });

    it("si la sala se pausa antes de llegar no se abre la mesa; al reanudar hay que volver a tocarla", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      const duration = arrivalMs(s);
      s.advance(duration / 2);
      s.admin({ type: "room.pause" }); // el reloj de simulación se congela y se publica sin permiso para explorar
      const frozenAt = Math.round(s.bridge.clock.now());
      s.advance(10 * 60_000); // diez minutos de conversación
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]);
      expect(Math.round(s.bridge.clock.now())).toBe(frozenAt); // la conversación no se suma
      // Se reanuda: el personaje termina su trayecto, pero el destino pendiente se canceló con el cambio de fase.
      s.admin({ type: "room.resume" });
      s.advance(duration / 2 + 200);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]);
      s.request({ type: "openStation", stationId: "sombras" }, "r2"); // un toque más y, como ya está junto a la mesa, se abre
      await flush();
      expect(s.types()).toEqual(["player.moveTo", "station.open"]);
      expect(s.d.person("ana").view).toEqual<PersonalView>({ kind: "activity", activityId: "sombras" });
      s.stop();
    });

    it("si Vanessa reúne al grupo antes de llegar, no se abre la mesa", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      s.admin({ type: "round.converse", withPending: true });
      s.advance(60_000);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]);
      expect(s.d.person("ana").view).toEqual<PersonalView>({ kind: "map" });
      s.stop();
    });

    it("un toque nuevo cancela la apertura pendiente: un destino viejo no abre una mesa", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      s.request({ type: "move", target: { x: 900, y: 600 } }, "r2");
      await flush();
      s.advance(60_000);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo", "player.moveTo"]);
      s.stop();
    });

    // ERROR CONOCIDO (src/app/mapIntents.ts): el toque nuevo cancela solo lo que ya estaba pendiente, pero el toque anterior sigue esperando su
    // acknowledgment y, al llegar, instala su apertura aunque ya lo hayan reemplazado. Con `it.fails` la suite sigue en verde mientras el
    // error exista; al corregirlo esta prueba empezará a fallar y bastará con quitar `.fails`.
    it("un toque nuevo mientras el anterior espera su acknowledgment también lo cancela", async () => {
      const s = setup();
      const apply = s.port.onAct;
      let release: (r: CommandResult) => void = () => undefined;
      let first = true;
      // El servidor procesa los dos trayectos en orden, pero el acknowledgment del primero tarda en llegar.
      s.port.onAct = (a) => {
        const result = apply(a);
        if (!first) return result;
        first = false;
        return new Promise<CommandResult>((resolve) => void (release = resolve)).then(() => result);
      };
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      s.request({ type: "move", target: { x: 900, y: 600 } }, "r2");
      await flush();
      release(ok); // llega por fin el acknowledgment del primer toque
      await flush();
      s.advance(60_000);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo", "player.moveTo"]); // el destino viejo no abre ninguna mesa
      s.stop();
    });

    it("un toque denegado también cancela la apertura pendiente", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      s.request({ type: "openStation", stationId: "rampas" }, "r2"); // una mesa futura se rechaza…
      await flush();
      expect(s.results[1]).toMatchObject({ requestId: "r2", accepted: false });
      s.advance(60_000);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]); // …y el destino de antes ya no cuenta
      s.stop();
    });

    it("si el servidor rechaza el trayecto no queda ninguna apertura pendiente", async () => {
      const s = setup();
      s.port.onAct = () => fail("INVALID_PAYLOAD", "No hay camino hasta ese punto.");
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(s.results).toEqual([{ requestId: "r1", accepted: false, reason: "No hay camino hasta ese punto." }]);
      s.advance(60_000);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]);
      s.stop();
    });

    it("si al llegar el servidor rechaza abrir, no lo reintenta en bucle", async () => {
      const s = setup();
      const apply = s.port.onAct;
      s.port.onAct = (a) => (a.type === "station.open" ? fail("INVALID_STEP", "La ronda cambió; esta acción llegó tarde.") : apply(a));
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      s.advance(arrivalMs(s) + 100);
      await vi.advanceTimersByTimeAsync(100);
      expect(s.types()).toEqual(["player.moveTo", "station.open"]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(s.types()).toEqual(["player.moveTo", "station.open"]);
      s.stop();
    });

    it("si ya está junto a la mesa la abre sin caminar", async () => {
      const s = setup();
      s.d.person("ana").character.feet = { ...sombras.point };
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(s.port.calls).toEqual([{ type: "station.open", stationId: "sombras", origin: "map" }]);
      expect(s.results).toEqual([{ requestId: "r1", accepted: true }]);
      expect(s.d.person("ana").view).toEqual<PersonalView>({ kind: "activity", activityId: "sombras" });
      s.stop();
    });

    it("ya dentro de la mesa no la reabre ni camina: se pide volver al mapa", async () => {
      const s = setup();
      s.d.openStation("ana", "sombras"); // la persona ya tiene Sombras abierta
      s.publish();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      expect(s.port.calls).toEqual([]);
      expect(s.results[0]).toMatchObject({ accepted: false, reason: "Ya estás en la mesa. Vuelve al mapa para salir de ella." });
      s.request({ type: "openStation", stationId: "rampas" }, "r2"); // y las demás siguen sin estar habilitadas
      await flush();
      expect(s.results[1]).toMatchObject({ accepted: false, reason: "Esa mesa se habilitará más adelante." });
      expect(s.port.calls).toEqual([]);
      s.stop();
    });

    it("si abre la mesa por otra vía mientras camina, la llegada no la vuelve a abrir", async () => {
      const s = setup();
      s.request({ type: "openStation", stationId: "sombras" });
      await flush();
      const duration = arrivalMs(s);
      s.d.openStation("ana", "sombras"); // p. ej. desde la navegación rápida: el personaje se detiene donde está
      s.publish();
      s.advance(duration + 100);
      await vi.advanceTimersByTimeAsync(300);
      expect(s.types()).toEqual(["player.moveTo"]);
      s.stop();
    });
  });

  it("al detenerse deja de escuchar y cancela lo pendiente", async () => {
    const s = setup();
    s.request({ type: "openStation", stationId: "sombras" });
    await flush();
    s.stop();
    s.advance(60_000);
    await vi.advanceTimersByTimeAsync(300);
    s.request({ type: "move", target: { x: 640, y: 450 } }, "r9");
    await flush();
    expect(s.types()).toEqual(["player.moveTo"]);
    expect(s.results.map((r) => r.requestId)).toEqual(["r1"]); // la solicitud posterior ni se atendió
  });
});

describe("stationTarget", () => {
  it("toma el punto y el radio de la mesa del mismo mapa que usa el servidor", () => {
    expect(stationTarget(project, "sombras")).toEqual({ point: sombras.point, radius: sombras.interactionRadius });
    for (const st of map.stations) expect(stationTarget(project, st.activityId)).toEqual({ point: st.point, radius: st.interactionRadius });
  });
  it("una mesa que no está en el mapa no tiene destino", () => {
    expect(stationTarget(project, "no-existe")).toBeNull();
  });
});

// ---- parte 2: el mismo enrutador, el controlador real y un servidor real ---------------------------------------------------------

describe("enrutador de intenciones del mapa contra el servidor real", () => {
  let server: TestServer;
  let now = 10_000; // reloj de simulación del servidor
  let device = 0; // reloj del dispositivo (el del puente)
  const controllers: RoomController[] = [];
  const stops: Array<() => void> = [];
  const until = async (cond: () => boolean, what: string, ms = 5000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error(`Tiempo agotado: ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(async () => {
    now = 10_000;
    device = 0;
    server = await startServer({ mono: () => now, settings: { tickIntervalMs: 0, sweepIntervalMs: 0 } });
  });
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop();
    for (const c of controllers.splice(0)) c.dispose();
    await server.stop();
  });

  /**
   * Conecta a Ana como lo hace la aplicación: el reloj del puente sale de las muestras del servidor, los permisos de `permissionsFor` y
   * el enrutador usa el controlador real. Los dos relojes (servidor y dispositivo) avanzan juntos con `elapse`.
   */
  async function ana() {
    const r = await setupRoom(server, ["Ana"]);
    const anaId = r.people[0]!.join.principalId;
    const controller = new RoomController(server.url, r.people[0]!.join.token);
    controllers.push(controller);
    const bridge = new GameBridge(new ClientClock(() => device));
    controller.subscribeClock((s) => bridge.emit("app:clock", s));
    const feed = () => bridge.emit("app:permissions", permissionsFor(controller.getState()));
    controller.subscribe(feed);
    controller.connect();
    await until(() => controller.getState().me !== null, "estado personal de Ana");
    feed();
    const seen: Array<{ type: string; origin?: string }> = [];
    const original = server.app.service.participantCommand.bind(server.app.service);
    server.app.service.participantCommand = (identity, socketId, cmd) => (seen.push({ type: cmd.action.type, ...("origin" in cmd.action ? { origin: cmd.action.origin } : {}) }), original(identity, socketId, cmd));
    const token = bridge.beginScene();
    const results: Array<{ requestId: string; accepted: boolean; reason?: string }> = [];
    bridge.on("app:request-result", (x) => results.push(x));
    stops.push(startIntentRouter({ bridge, port: controller, project: { bundle: server.app.project }, pollMs: 15 }));
    const request = (intent: MapIntent, requestId = "r1") => bridge.emit("game:action-request", { intent, requestId, token });
    const elapse = (ms: number) => {
      now += ms;
      device += ms;
    };
    const view = () => controller.getState().me?.participant.view;
    return { ...r, anaId, controller, bridge, seen, results, request, elapse, view };
  }
  type A = Awaited<ReturnType<typeof ana>>;
  const explore = async (a: A) => {
    expect(await a.admin.admin({ type: "room.start" })).toMatchObject({ ok: true });
    expect(await a.admin.admin({ type: "round.open" })).toMatchObject({ ok: true });
    await until(() => a.controller.getState().group?.adventure.round.stage === "exploration" && a.controller.getState().summary?.roundVersion === server.app.service.inspect(a.code)!.state.roundVersion, "exploración visible");
  };

  it("tocar una mesa lejana la abre justo al llegar según el servidor: ni antes (se rechazaría) ni sin que nadie lo pida", async () => {
    const a = await ana();
    await explore(a);
    a.request({ type: "openStation", stationId: "sombras" });
    await until(() => a.controller.getState().me?.participant.character.plan != null, "el plan de Ana");
    expect(a.results).toEqual([{ requestId: "r1", accepted: true }]);
    const duration = planDurationMs(a.controller.getState().me!.participant.character.plan!);
    expect(duration).toBeGreaterThan(1000);
    a.elapse(duration / 2);
    await pause(150);
    expect(a.seen.map((c) => c.type)).toEqual(["player.moveTo"]); // todavía camina: ni un intento de abrir
    expect(a.view()).toEqual({ kind: "map" });
    a.elapse(duration / 2 + 50);
    await until(() => a.view()?.kind === "activity", "mesa abierta al llegar");
    expect(a.seen).toEqual([{ type: "player.moveTo" }, { type: "station.open", origin: "map" }]); // y el servidor la aceptó a la primera
    expect(a.view()).toEqual({ kind: "activity", activityId: "sombras" });
    expect(server.app.service.inspect(a.code)!.state.participants[a.anaId]!.view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("con la sala en pausa el trayecto sigue donde iba, pero no se abre sola: al reanudar y volver a tocar, se abre", async () => {
    const a = await ana();
    await explore(a);
    a.request({ type: "openStation", stationId: "sombras" });
    await until(() => a.controller.getState().me?.participant.character.plan != null, "el plan de Ana");
    const duration = planDurationMs(a.controller.getState().me!.participant.character.plan!);
    a.elapse(duration / 2);
    expect(await a.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    await until(() => a.controller.getState().summary?.phase === "paused" && a.bridge.permissions?.canExplore === false, "pausa visible");
    await until(() => !a.bridge.clock.isRunning, "reloj detenido"); // la muestra con `running: false` ya llegó
    const frozenAt = a.bridge.clock.now();
    a.elapse(10 * 60_000); // diez minutos de conversación con la sala en pausa
    await pause(100);
    expect(a.bridge.clock.now()).toBe(frozenAt); // el tiempo de la pausa no cuenta
    expect(a.seen.map((c) => c.type)).toEqual(["player.moveTo"]);
    expect(await a.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    await until(() => a.controller.getState().summary?.phase === "running" && a.bridge.clock.isRunning && a.bridge.permissions?.canExplore === true, "reanudada");
    a.elapse(duration / 2 + 50);
    await pause(150);
    expect(a.seen.map((c) => c.type)).toEqual(["player.moveTo"]); // el destino pendiente se canceló con el cambio de fase
    a.request({ type: "openStation", stationId: "sombras" }, "r2");
    await until(() => a.view()?.kind === "activity", "mesa abierta tras volver a tocar");
    expect(a.seen).toEqual([{ type: "player.moveTo" }, { type: "station.open", origin: "map" }]);
  });

  it("fuera de la exploración no se abre ninguna mesa: el servidor ni se entera", async () => {
    const a = await ana();
    // Preparación: la persona puede caminar, pero la mesa no está abierta.
    expect(await a.admin.admin({ type: "room.start" })).toMatchObject({ ok: true });
    await until(() => a.controller.getState().group?.adventure.round.stage === "preparation" && a.bridge.permissions?.canMove === true, "preparación visible");
    a.request({ type: "openStation", stationId: "sombras" });
    await pause(50);
    expect(a.results).toEqual([{ requestId: "r1", accepted: false, reason: "Vanessa abrirá la mesa en un momento." }]);
    expect(a.seen).toEqual([]);
    // Conversación: los controles se detienen.
    expect(await a.admin.admin({ type: "round.open" })).toMatchObject({ ok: true });
    expect(await a.admin.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: true });
    await until(() => a.controller.getState().group?.adventure.round.stage === "conversation" && a.bridge.permissions?.canMove === false, "conversación visible");
    a.request({ type: "openStation", stationId: "sombras" }, "r2");
    a.request({ type: "move", target: { x: 640, y: 450 } }, "r3");
    await pause(50);
    expect(a.results.slice(1)).toEqual([
      { requestId: "r2", accepted: false, reason: "Estamos conversando: mira la proyección." },
      { requestId: "r3", accepted: false, reason: "Estamos conversando: mira la proyección." },
    ]);
    expect(a.seen).toEqual([]);
    expect(a.controller.getState().notice).toMatchObject({ kind: "info", text: "Estamos conversando: mira la proyección." }); // y se muestra en la pantalla
  });

  it("quien observa no puede mover ni abrir: la pantalla lo explica y el servidor no recibe nada", async () => {
    const created = await createRoom(server.url);
    const j = await joinRoom(server.url, created.body.code, "Vero", "azul", true);
    const controller = new RoomController(server.url, j.body.token);
    controllers.push(controller);
    const bridge = new GameBridge(new ClientClock(() => device));
    controller.subscribe(() => bridge.emit("app:permissions", permissionsFor(controller.getState())));
    controller.connect();
    await until(() => controller.getState().group !== null, "estado del grupo");
    bridge.emit("app:permissions", permissionsFor(controller.getState()));
    let received = 0;
    server.app.service.participantCommand = () => (received++, Promise.resolve(ok));
    const token = bridge.beginScene();
    const results: Array<{ requestId: string; accepted: boolean; reason?: string }> = [];
    bridge.on("app:request-result", (x) => results.push(x));
    stops.push(startIntentRouter({ bridge, port: controller, project: { bundle: server.app.project }, pollMs: 15 }));
    bridge.emit("game:action-request", { intent: { type: "move", target: { x: 640, y: 450 } }, requestId: "r1", token });
    await pause(50);
    expect(results).toEqual([{ requestId: "r1", accepted: false, reason: "Estás como observador." }]);
    expect(received).toBe(0);
  });
});
