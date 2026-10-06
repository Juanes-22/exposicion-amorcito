import { describe, expect, it, vi } from "vitest";
import type { AdventureView } from "../../../shared/contracts/state";
import type { GameDeps } from "../createGame";
import { desiredScene } from "./sceneKeys";

// El director solo usa de Phaser unas constantes; se sustituye para probar su lógica sin navegador.
vi.mock("phaser", () => ({ default: { Scenes: { LOADING: 3, CREATING: 4, RUNNING: 5 }, Core: { Events: { POST_STEP: "poststep" } } } }));
const { SceneDirector } = await import("./director");

const ACTIVITIES = { sombras: { type: "shadows" }, rampas: { type: "ramps" }, cajas: { type: "boxes" } } as const;

describe("qué escena corresponde a la vista", () => {
  it("el mapa vive en el laboratorio, el inventor tiene su escena y cada mesa la suya por tipo", () => {
    expect(desiredScene({ kind: "map" }, ACTIVITIES)).toBe("LaboratoryScene");
    expect(desiredScene({ kind: "final" }, ACTIVITIES)).toBe("InventorScene");
    expect(desiredScene({ kind: "activity", activityId: "sombras" }, ACTIVITIES)).toBe("ShadowsScene");
    expect(desiredScene({ kind: "activity", activityId: "rampas" }, ACTIVITIES)).toBe("RampsScene");
    expect(desiredScene({ kind: "activity", activityId: "cajas" }, ACTIVITIES)).toBe("BoxesScene");
  });
  it("una mesa desconocida cae en el laboratorio en vez de dejar un lienzo en blanco", () => {
    expect(desiredScene({ kind: "activity", activityId: "no-existe" }, ACTIVITIES)).toBe("LaboratoryScene");
  });
});

/** Un `Phaser.Game` mínimo: registra qué escenas se paran y arrancan, y deja controlar el estado de cada una. */
function fakeGame() {
  const status: Record<string, number> = {};
  const calls: string[] = [];
  const stepListeners: Array<() => void> = [];
  const keys = ["LaboratoryScene", "ShadowsScene", "RampsScene", "BoxesScene", "InventorScene"];
  const game = {
    isBooted: true,
    events: { once: (_e: string, fn: () => void) => void stepListeners.push(fn) },
    scene: {
      getScenes: () => keys.filter((k) => k in status).map((k) => ({ sys: { settings: { status: status[k] } } })),
      isActive: (k: string) => status[k] === 5,
      isPaused: (k: string) => status[k] === 6,
      isSleeping: (k: string) => status[k] === 7,
      stop: (k: string) => {
        calls.push(`stop:${k}`);
        status[k] = 8;
      },
      start: (k: string) => {
        calls.push(`start:${k}`);
        status[k] = 5;
      },
    },
  };
  return { game, status, calls, endStep: () => stepListeners.splice(0).forEach((f) => f()) };
}

function setup() {
  const f = fakeGame();
  const handlers: Record<string, () => void> = {};
  let view: AdventureView = { kind: "map" };
  let snapshot: unknown = null;
  const bridge = {
    get snapshot() {
      return snapshot;
    },
    on: (e: string, fn: () => void) => ((handlers[e] = fn), () => delete handlers[e]),
  };
  const deps = { bridge, project: { bundle: { config: { activities: ACTIVITIES } } } } as unknown as GameDeps;
  const director = new SceneDirector(f.game as never, deps);
  const snap = (v: AdventureView) => {
    view = v;
    snapshot = { state: { adventure: { view } } };
    handlers["app:snapshot"]?.();
  };
  return { ...f, director, handlers, snap };
}

describe("SceneDirector: cambia de escena dentro del mismo juego", () => {
  it("abrir una mesa para y arranca; volver al mapa regresa al laboratorio; repetir el mismo snapshot no reinicia nada", () => {
    const t = setup();
    t.status.LaboratoryScene = 5;
    t.handlers["game:ready"]!();
    t.snap({ kind: "map" });
    expect(t.calls).toEqual([]);
    t.snap({ kind: "activity", activityId: "rampas" });
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:RampsScene"]);
    t.snap({ kind: "activity", activityId: "rampas" });
    t.snap({ kind: "activity", activityId: "rampas" });
    expect(t.calls).toHaveLength(2); // una mesa abierta que recibe más snapshots no se reinicia
    t.snap({ kind: "map" });
    expect(t.calls.slice(2)).toEqual(["stop:RampsScene", "start:LaboratoryScene"]);
  });

  it("si el snapshot llega ANTES de que el laboratorio esté listo (nuevo controlador, recarga), espera y no deja dos escenas en marcha", () => {
    const t = setup();
    t.snap({ kind: "activity", activityId: "sombras" }); // el laboratorio todavía carga: no hay nada que cambiar
    expect(t.calls).toEqual([]);
    t.status.LaboratoryScene = 4; // `game:ready` se emite DENTRO de su create (estado «creando»)
    t.handlers["game:ready"]!();
    expect(t.calls).toEqual([]); // parar una escena que está en su create no es fiable: se aplaza
    t.status.LaboratoryScene = 5; // termina el create; al final del fotograma se reconcilia
    t.endStep();
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:ShadowsScene"]);
    expect(Object.entries(t.status).filter(([, s]) => s === 5).map(([k]) => k)).toEqual(["ShadowsScene"]);
  });

  it("no actúa sin snapshot ni antes de que el laboratorio exista", () => {
    const t = setup();
    t.handlers["game:ready"]!(); // sin snapshot aún
    expect(t.calls).toEqual([]);
    const u = setup();
    u.snap({ kind: "activity", activityId: "cajas" });
    expect(u.calls).toEqual([]);
  });

  it("tras dispose deja de escuchar", () => {
    const t = setup();
    t.director.dispose();
    expect(Object.keys(t.handlers)).toEqual([]);
  });
});
