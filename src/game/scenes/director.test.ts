import { describe, expect, it, vi } from "vitest";
import type { PersonalView } from "../../../shared/contracts/state";
import { Driver } from "../../../shared/testing/drive";
import type { Viewer, VisualState } from "../bridge/events";
import type { GameDeps } from "../createGame";
import { desiredScene } from "./sceneKeys";

// El director solo usa de Phaser unas constantes; se sustituye para probar su lógica sin navegador.
vi.mock("phaser", () => ({ default: { Scenes: { LOADING: 3, CREATING: 4, RUNNING: 5 }, Core: { Events: { POST_STEP: "poststep" } } } }));
const { SceneDirector } = await import("./director");

const ACTIVITIES = { sombras: { type: "shadows" }, rampas: { type: "ramps" }, cajas: { type: "telescope" } } as const;

/** Lo que el puente entrega a Phaser, armado con la ronda y las personas de la sala del Driver. */
const visual = (d: Driver, viewer: Viewer): VisualState => ({ phase: d.room.phase, group: d.room.adventure, viewer, characters: [] });
/** Quien juega: ve SU estado personal. `view` fuerza la vista (el dominio solo la deja en una mesa durante la exploración). */
const persona = (d: Driver, id: string, view?: PersonalView): Viewer => ({ kind: "participant", principalId: id, me: view ? { ...d.person(id), view } : d.person(id) });
const mesa = (activityId: string): PersonalView => ({ kind: "activity", activityId });
/** La proyección de Vanessa; con `demo` está mostrando su demostración local. */
const proyeccion = (d: Driver, view?: PersonalView): Viewer => ({ kind: "projection", demo: view ? { ...d.person("ana"), view } : null });

/** La sala en la fase de la ronda indicada, con Ana y Beto dados de alta. */
function sala(etapa: "preparacion" | "exploracion" | "conversacion" | "cierre"): Driver {
  const d = new Driver(["ana", "beto"]);
  if (etapa === "cierre") {
    d.playToClosing();
    return d;
  }
  d.must(d.admin({ type: "room.start" }), "comenzar");
  if (etapa === "preparacion") return d;
  d.must(d.admin({ type: "round.open" }), "abrir");
  if (etapa === "conversacion") d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
  return d;
}

describe("qué escena corresponde a lo que ve cada audiencia", () => {
  it("quien juega ve la mesa que tiene abierta, según su tipo", () => {
    const d = sala("exploracion");
    expect(desiredScene(visual(d, persona(d, "ana", mesa("sombras"))), ACTIVITIES)).toBe("ShadowsScene");
    expect(desiredScene(visual(d, persona(d, "ana", mesa("rampas"))), ACTIVITIES)).toBe("RampsScene");
    expect(desiredScene(visual(d, persona(d, "ana", mesa("cajas"))), ACTIVITIES)).toBe("TelescopeScene");
  });

  it("quien no tiene ninguna mesa abierta ve el laboratorio compartido, en cualquier fase de la ronda", () => {
    for (const etapa of ["preparacion", "exploracion", "conversacion"] as const) {
      const d = sala(etapa);
      expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("LaboratoryScene");
    }
  });

  it("en la misma ronda cada persona ve lo suyo: quien abrió la mesa, la mesa; quien sigue en el mapa, el laboratorio", () => {
    const d = sala("exploracion");
    d.openStation("ana", "sombras");
    expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("ShadowsScene");
    expect(desiredScene(visual(d, persona(d, "beto")), ACTIVITIES)).toBe("LaboratoryScene");
    d.must(d.act("ana", { type: "adventure.returnToMap" }), "volver al mapa");
    expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("LaboratoryScene");
  });

  it("la conversación no cierra la mesa de quien la tenía abierta; al abrir la siguiente mesa todas regresan al laboratorio", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("ShadowsScene");
    d.must(d.admin({ type: "round.next" }), "avanzar");
    expect(d.round.stage).toBe("preparation");
    expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("LaboratoryScene");
  });

  it("la pausa no cambia de escena: quien tenía la mesa abierta la sigue viendo", () => {
    const d = sala("exploracion");
    d.openStation("ana", "sombras");
    d.must(d.admin({ type: "room.pause" }), "pausar");
    expect(d.room.phase).toBe("paused");
    expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("ShadowsScene");
  });

  it("una mesa desconocida cae en el laboratorio en vez de dejar un lienzo en blanco", () => {
    const d = sala("exploracion");
    expect(desiredScene(visual(d, persona(d, "ana", mesa("no-existe"))), ACTIVITIES)).toBe("LaboratoryScene");
    expect(desiredScene(visual(d, proyeccion(d, mesa("no-existe"))), ACTIVITIES)).toBe("LaboratoryScene");
  });

  it("en el cierre todas las pantallas ven la máquina del inventor: quien juega (aunque tuviera una mesa abierta), la proyección y quien acompaña", () => {
    const d = sala("cierre");
    expect(d.round.stage).toBe("closing");
    expect(desiredScene(visual(d, persona(d, "ana")), ACTIVITIES)).toBe("InventorScene");
    expect(desiredScene(visual(d, persona(d, "ana", mesa("cajas"))), ACTIVITIES)).toBe("InventorScene"); // el cierre manda sobre la vista personal
    expect(desiredScene(visual(d, proyeccion(d)), ACTIVITIES)).toBe("InventorScene");
    expect(desiredScene(visual(d, proyeccion(d, mesa("rampas"))), ACTIVITIES)).toBe("InventorScene"); // ni una demostración tapa al inventor
    expect(desiredScene(visual(d, { kind: "observer" }), ACTIVITIES)).toBe("InventorScene");
  });

  it("con la aventura terminada todas siguen viendo al inventor, también en pausa", () => {
    const d = sala("cierre");
    d.must(d.admin({ type: "final.confirm", value: { kind: "written", text: "¿Por qué cambia la sombra?" } }), "pregunta final");
    expect(d.room.phase).toBe("finished");
    expect(desiredScene(visual(d, persona(d, "beto")), ACTIVITIES)).toBe("InventorScene");
    expect(desiredScene(visual(d, proyeccion(d)), ACTIVITIES)).toBe("InventorScene");
    expect(desiredScene(visual(d, { kind: "observer" }), ACTIVITIES)).toBe("InventorScene");
    d.must(d.admin({ type: "room.pause" }), "pausar");
    expect(desiredScene(visual(d, persona(d, "beto")), ACTIVITIES)).toBe("InventorScene");
    // La fase terminada basta por sí sola, sin depender de la etapa de la ronda.
    const g = d.room.adventure;
    const sinCierre: VisualState = { phase: "finished", group: { ...g, round: { ...g.round, stage: "conversation" } }, viewer: persona(d, "beto", mesa("sombras")), characters: [] };
    expect(desiredScene(sinCierre, ACTIVITIES)).toBe("InventorScene");
  });

  it("la proyección ve el laboratorio, aunque las personas tengan sus mesas abiertas; solo ve una mesa durante la demostración de Vanessa", () => {
    const d = sala("exploracion");
    d.openStation("ana", "sombras");
    expect(desiredScene(visual(d, proyeccion(d)), ACTIVITIES)).toBe("LaboratoryScene"); // el estado de grupo no trae vistas personales
    expect(desiredScene(visual(d, proyeccion(d, mesa("sombras"))), ACTIVITIES)).toBe("ShadowsScene");
    expect(desiredScene(visual(d, proyeccion(d, mesa("rampas"))), ACTIVITIES)).toBe("RampsScene");
    expect(desiredScene(visual(d, proyeccion(d, mesa("cajas"))), ACTIVITIES)).toBe("TelescopeScene");
    expect(desiredScene(visual(d, proyeccion(d, { kind: "map" })), ACTIVITIES)).toBe("LaboratoryScene"); // la demostración volvió al mapa
  });

  it("quien acompaña como observadora ve siempre el laboratorio compartido, sin estado personal", () => {
    for (const etapa of ["preparacion", "exploracion", "conversacion"] as const) {
      const d = sala(etapa);
      expect(desiredScene(visual(d, { kind: "observer" }), ACTIVITIES)).toBe("LaboratoryScene");
    }
  });
});

/** Un `Phaser.Game` mínimo: registra qué escenas se paran y arrancan, y deja controlar el estado de cada una. */
function fakeGame() {
  const status: Record<string, number> = {};
  const calls: string[] = [];
  const stepListeners: Array<() => void> = [];
  const keys = ["LaboratoryScene", "ShadowsScene", "RampsScene", "TelescopeScene", "InventorScene"];
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
  let current: VisualState | null = null;
  const bridge = {
    get visual() {
      return current;
    },
    on: (e: string, fn: () => void) => ((handlers[e] = fn), () => delete handlers[e]),
  };
  const deps = { bridge, project: { bundle: { config: { activities: ACTIVITIES } } } } as unknown as GameDeps;
  const director = new SceneDirector(f.game as never, deps);
  /** El puente guarda el último estado visual y avisa: así lo hace `GameBridge.emit("app:visual", …)`. */
  const show = (v: VisualState) => {
    current = v;
    handlers["app:visual"]?.();
  };
  return { ...f, director, handlers, show };
}

describe("SceneDirector: cambia de escena dentro del mismo juego", () => {
  it("abrir una mesa para y arranca; volver al mapa regresa al laboratorio; repetir el mismo estado no reinicia nada", () => {
    const t = setup();
    const d = sala("exploracion");
    t.status.LaboratoryScene = 5;
    t.handlers["game:ready"]!();
    t.show(visual(d, persona(d, "ana")));
    expect(t.calls).toEqual([]);
    t.show(visual(d, persona(d, "ana", mesa("rampas"))));
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:RampsScene"]);
    t.show(visual(d, persona(d, "ana", mesa("rampas"))));
    t.show(visual(d, persona(d, "ana", mesa("rampas"))));
    expect(t.calls).toHaveLength(2); // una mesa abierta que recibe más estados no se reinicia
    t.show(visual(d, persona(d, "ana")));
    expect(t.calls.slice(2)).toEqual(["stop:RampsScene", "start:LaboratoryScene"]);
  });

  it("lo que hacen las demás personas no mueve mi escena: otros personajes caminando no reinician mi mesa", () => {
    const t = setup();
    const d = sala("exploracion");
    d.openStation("ana", "sombras");
    t.status.LaboratoryScene = 5;
    t.handlers["game:ready"]!();
    t.show(visual(d, persona(d, "ana")));
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:ShadowsScene"]);
    d.must(d.act("beto", { type: "player.moveTo", target: { x: 640, y: 450 } }), "caminar");
    const beto = { principalId: "beto", displayName: "beto", color: null, connected: true, character: d.person("beto").character };
    t.show({ ...visual(d, persona(d, "ana")), characters: [beto] });
    expect(t.calls).toHaveLength(2);
  });

  it("si el estado llega ANTES de que el laboratorio esté listo (nuevo controlador, recarga), espera y no deja dos escenas en marcha", () => {
    const t = setup();
    const d = sala("exploracion");
    t.show(visual(d, persona(d, "ana", mesa("sombras")))); // el laboratorio todavía carga: no hay nada que cambiar
    expect(t.calls).toEqual([]);
    t.status.LaboratoryScene = 4; // `game:ready` se emite DENTRO de su create (estado «creando»)
    t.handlers["game:ready"]!();
    expect(t.calls).toEqual([]); // parar una escena que está en su create no es fiable: se aplaza
    t.status.LaboratoryScene = 5; // termina el create; al final del fotograma se reconcilia
    t.endStep();
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:ShadowsScene"]);
    expect(Object.entries(t.status).filter(([, s]) => s === 5).map(([k]) => k)).toEqual(["ShadowsScene"]);
  });

  it("no actúa sin estado visual ni antes de que el laboratorio exista", () => {
    const t = setup();
    t.handlers["game:ready"]!(); // sin estado visual aún
    expect(t.calls).toEqual([]);
    const u = setup();
    const d = sala("exploracion");
    u.show(visual(d, persona(d, "ana", mesa("cajas"))));
    expect(u.calls).toEqual([]);
  });

  it("al llegar el cierre todas las pantallas pasan al inventor, aunque tuvieran una mesa abierta; un reinicio de la sala regresa al laboratorio", () => {
    const t = setup();
    const d = sala("cierre");
    t.status.LaboratoryScene = 5;
    t.handlers["game:ready"]!();
    t.show(visual(d, persona(d, "ana", mesa("cajas"))));
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:InventorScene"]); // abre ya en el cierre (recarga): directo al inventor
    t.show(visual(d, persona(d, "ana")));
    t.show(visual(d, { kind: "observer" }));
    expect(t.calls).toHaveLength(2); // sigue en el cierre: no se reinicia
    d.must(d.admin({ type: "room.reset", confirm: true }), "reiniciar");
    t.show(visual(d, persona(d, "ana")));
    expect(t.calls.slice(2)).toEqual(["stop:InventorScene", "start:LaboratoryScene"]);
  });

  it("de la mesa al cierre: quien tenía una mesa abierta cambia directamente de la mesa al inventor", () => {
    const t = setup();
    const d = sala("exploracion");
    t.status.LaboratoryScene = 5;
    t.handlers["game:ready"]!();
    t.show(visual(d, persona(d, "ana", mesa("sombras"))));
    const c = sala("cierre");
    t.show(visual(c, persona(c, "ana", mesa("sombras"))));
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:ShadowsScene", "stop:ShadowsScene", "start:InventorScene"]);
    expect(Object.entries(t.status).filter(([, s]) => s === 5).map(([k]) => k)).toEqual(["InventorScene"]);
  });

  it("la proyección sigue la demostración de Vanessa: la mesa mientras demuestra y el laboratorio al terminar", () => {
    const t = setup();
    const d = sala("exploracion");
    t.status.LaboratoryScene = 5;
    t.handlers["game:ready"]!();
    t.show(visual(d, proyeccion(d)));
    expect(t.calls).toEqual([]);
    t.show(visual(d, proyeccion(d, mesa("rampas"))));
    expect(t.calls).toEqual(["stop:LaboratoryScene", "start:RampsScene"]);
    t.show(visual(d, proyeccion(d)));
    expect(t.calls.slice(2)).toEqual(["stop:RampsScene", "start:LaboratoryScene"]);
  });

  it("tras dispose deja de escuchar", () => {
    const t = setup();
    t.director.dispose();
    expect(Object.keys(t.handlers)).toEqual([]);
  });
});
