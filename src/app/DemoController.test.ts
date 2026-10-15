import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAction, ParticipantAction } from "../../shared/contracts/actions";
import type { ClockSample } from "../../shared/contracts/events";
import type { ParticipantState, RampsState, ShadowsState, TelescopeState } from "../../shared/contracts/state";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";
import { planDurationMs } from "../../shared/domain/movement";
import { playerAt } from "../../shared/domain/participant";
import { bundle, Driver } from "../../shared/testing/drive";
import { DEMO_STORAGE_KEY, DemoController, type DemoOptions, type DemoStorage } from "./DemoController";

// La demostración usa el mismo dominio, sin red y con su propio almacenamiento (SPECS 6.4, CA-32, CT-14). Vanessa conduce la ronda
// (acciones de administradora) y a la vez explora con su propio personaje (acciones personales), como cualquier participante.
vi.mock("socket.io-client", () => ({
  io: () => {
    throw new Error("la demostración no debe abrir ningún socket");
  },
}));

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const touched = new Set<string>();
  const storage: DemoStorage & { data: Map<string, string>; touched: Set<string> } = {
    data,
    touched,
    getItem: (k) => (touched.add(k), data.get(k) ?? null),
    setItem: (k, v) => void (touched.add(k), data.set(k, v)),
    removeItem: (k) => void (touched.add(k), data.delete(k)),
  };
  return storage;
};

let now = 0;
const clock = { mono: () => now, now: () => new Date(1_700_000_000_000 + now) };
const make = (storage: DemoStorage | null = null, over: DemoOptions = {}, b = bundle) => new DemoController(b, { storage, tickMs: 0, ...clock, ...over });
const advance = (c: DemoController, ms: number) => {
  now += ms;
  c.tick();
};

// ---- lectura del estado que ve la interfaz ----
const grupo = (c: DemoController) => c.getState().group!.adventure;
const ronda = (c: DemoController) => grupo(c).round;
const yo = (c: DemoController) => c.getState().me!.participant;
const fase = (c: DemoController) => c.getState().summary!.phase;
const efectos = (c: DemoController) => c.getState().group!.effects;
const presencia = (c: DemoController) => c.getState().presence!;
const ella = (c: DemoController) => presencia(c).participants[0]!;
const rampas = (c: DemoController) => yo(c).activities.rampas as RampsState;
const sombras = (c: DemoController) => yo(c).activities.sombras as ShadowsState;
const telescopio = (c: DemoController) => yo(c).activities.cajas as TelescopeState;
const { moon, stars, window: ventana } = TELESCOPE_TARGETS;

/** Vanessa, que conduce la ronda y explora con su personaje. Es la única persona de la demostración. */
const YO = "demo-vanessa";
const PREGUNTA = "¿Por qué el hielo flota?";

/** Un paso del recorrido: lo que Vanessa hace como administradora, lo que hace con su personaje, o el tiempo que pasa. */
type Paso = { admin: AdminAction } | { act: ParticipantAction } | { espera: number };

const abrirMesa = (mesa: string): Paso[] => [{ admin: { type: "round.open" } }, { act: { type: "station.open", stationId: mesa, origin: "quickNav" } }];
/** Cada mesa explorada hasta cumplir su criterio de finalización. */
const EXPLORAR: Record<"sombras" | "rampas" | "cajas", Paso[]> = {
  sombras: [...abrirMesa("sombras"), { act: { type: "shadows.sample", distanceCm: 20 } }, { act: { type: "shadows.sample", distanceCm: 50 } }],
  rampas: [...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }, { espera: 6000 }, { act: { type: "ramps.trial.start", angleDeg: 40 } }, { espera: 6000 }],
  cajas: [...abrirMesa("cajas"), { act: { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM } }, { act: { type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 } }],
};
/**
 * La conversación de la mesa: reunir, mostrar la frase, proyectar sus resultados, guardar la síntesis y abrir la siguiente. En el
 * observatorio no se proyecta la exploración de nadie (se muestra la casa con la demostración de la consola).
 */
const conversar = (mesa: string): Paso[] => [
  { admin: { type: "round.converse" } },
  { admin: { type: "round.showFreire" } },
  ...(mesa === "cajas" ? [] : [{ admin: { type: "present.select", principalId: YO } } as Paso]),
  { admin: { type: "note.save", activityId: mesa, kind: "synthesis", text: `Lo que vimos en ${mesa}` } },
  { admin: { type: "round.next" } },
];
/** Las tres rondas completas, hasta el cierre del inventor (sin la pregunta final). */
const TRES_RONDAS: Paso[] = [...EXPLORAR.sombras, ...conversar("sombras"), ...EXPLORAR.rampas, ...conversar("rampas"), ...EXPLORAR.cajas, ...conversar("cajas")];
const PREGUNTA_FINAL: Paso = { admin: { type: "final.confirm", value: { kind: "written", text: PREGUNTA } } };
const RECORRIDO: Paso[] = [...TRES_RONDAS, PREGUNTA_FINAL];

const nombre = (p: Paso) => ("admin" in p ? p.admin.type : "act" in p ? p.act.type : "espera");

/** Corre los pasos en la demostración; un rechazo en medio es un error de la prueba, no un resultado. */
async function correr(c: DemoController, pasos: Paso[]) {
  for (const p of pasos) {
    if ("espera" in p) {
      advance(c, p.espera);
      continue;
    }
    const r = await ("admin" in p ? c.admin(p.admin) : c.act(p.act));
    if (!r.ok) throw new Error(`${nombre(p)}: ${r.code} ${r.message}`);
  }
}

/** Los mismos pasos sobre el dominio puro, con el reloj del `Driver`. */
function correrEnDominio(d: Driver, pasos: Paso[]) {
  for (const p of pasos) {
    if ("espera" in p) d.tick(p.espera);
    else d.must("admin" in p ? d.admin(p.admin) : d.act(YO, p.act), nombre(p));
  }
}

const ok = async (r: Promise<{ ok: boolean }>, que: string) => expect(await r, que).toMatchObject({ ok: true });
/** Termina la prueba de rampa que acaba de empezar, justo en su instante. */
const terminarPrueba = (c: DemoController) => advance(c, rampas(c).trials.find((t) => t.state === "running")!.durationMs);

afterEach(() => {
  now = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DemoController: mismo dominio, sin servidor (CA-32)", () => {
  it("Vanessa conduce las tres rondas y explora con su personaje: llega a `finished` con las tres piezas y la pregunta final", async () => {
    const c = make();
    // `room.start` ya está aplicado: la primera mesa espera a que Vanessa la abra, sin pantalla de bienvenida.
    expect(c.getState()).toMatchObject({ status: "connected", pending: 0, notice: null, summary: { phase: "running", code: "DEMO", adminConnected: true, configMismatch: false, self: { principalId: YO, role: "admin", observer: false, displayName: "Vanessa" } } });
    expect(ronda(c)).toMatchObject({ index: 0, stage: "preparation" });
    await correr(c, RECORRIDO);
    expect(fase(c)).toBe("finished");
    expect(grupo(c).pieces).toEqual(["lupa", "dialogo", "corazon"]);
    expect(grupo(c).completed).toEqual(["sombras", "rampas", "cajas"]);
    expect(ronda(c)).toMatchObject({ index: 3, stage: "closing" });
    expect(grupo(c).notebook.find((n) => n.kind === "finalQuestion")?.text).toBe(PREGUNTA);
    // Lo proyectado en cada mesa quedó en el cuaderno común, con su nombre.
    expect(grupo(c).notebook.filter((n) => n.kind === "comparison").map((n) => [n.activityId, n.comparison!.authorName])).toEqual([["sombras", "Vanessa"], ["rampas", "Vanessa"]]);
  });

  it("es una sala de una persona: Vanessa conduce (administradora) y juega (participante) a la vez, y su personaje es el que ve el laboratorio", async () => {
    const c = make();
    const s = c.getState();
    expect(s.summary!.self).toMatchObject({ role: "admin", displayName: "Vanessa", observer: false });
    expect(Object.keys(s.characters)).toEqual([YO]);
    expect(s.characters[YO]).toMatchObject({ displayName: "Vanessa", connected: true });
    expect(s.characters[YO]!.character).toEqual(s.me!.participant.character);
    expect(presencia(c)).toMatchObject({ connectedCount: 1 });
    expect(presencia(c).participants).toHaveLength(1);
    expect(ella(c)).toMatchObject({ principalId: YO, role: "participant", displayName: "Vanessa", connected: true, observer: false });
    // Cuando camina, el laboratorio y su estado personal cuentan lo mismo.
    await ok(c.act({ type: "player.moveTo", target: { x: 640, y: 450 } }), "caminar");
    expect(c.getState().characters[YO]!.character).toEqual(yo(c).character);
    expect(yo(c).character.plan).not.toBeNull();
  });

  it("produce el MISMO resultado que el dominio puro con las mismas acciones (no es otra implementación)", async () => {
    const c = make();
    await correr(c, RECORRIDO);
    const d = new Driver([]);
    d.join(YO, "Vanessa");
    d.must(d.admin({ type: "room.start" }), "comenzar");
    correrEnDominio(d, RECORRIDO);
    const sinInstantes = (p: ParticipantState) => JSON.parse(JSON.stringify(p, (k, v) => (["atActiveMs", "startActiveMs", "endedActiveMs"].includes(k) ? undefined : v)));
    const forma = (a: typeof d.room.adventure, p: ParticipantState) => ({
      round: a.round,
      completed: a.completed,
      pieces: a.pieces,
      counters: a.counters,
      inventor: a.inventor,
      presentedNoteId: a.presentedNoteId,
      notebook: a.notebook.map((n) => ({ id: n.id, activityId: n.activityId, kind: n.kind, text: n.text, comparison: n.comparison, revision: n.revision })),
      persona: sinInstantes(p),
    });
    // Las dos recorren lo mismo: mismas piezas y notas, mismas comparaciones proyectadas y los mismos resultados de Vanessa.
    expect(forma(grupo(c), yo(c))).toEqual(forma(d.room.adventure, d.person(YO)));
    expect(fase(c)).toBe(d.room.phase);
  });

  it("las reglas del servidor se cumplen: nada se salta el orden de la ronda, y cada rechazo avisa con el motivo del dominio", async () => {
    const c = make();
    // Preparación: ni Vanessa con su personaje puede abrir la mesa antes de abrirla como administradora.
    expect(await c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice).toMatchObject({ kind: "error", text: "Vanessa abrirá la mesa en un momento." });
    expect(yo(c).view).toEqual({ kind: "map" });
    expect(await c.admin({ type: "round.converse" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await c.admin({ type: "round.next" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await c.admin({ type: "room.start" })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // ya comenzó
    expect(c.getState().notice).toMatchObject({ kind: "error", text: "La aventura ya comenzó." });

    // Exploración: solo se explora la mesa de la ronda.
    await ok(c.admin({ type: "round.open" }), "abrir");
    expect(await c.admin({ type: "round.open" })).toMatchObject({ ok: false });
    expect(await c.act({ type: "shadows.sample", distanceCm: 20 })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // la mesa no está abierta
    expect(c.getState().notice).toMatchObject({ text: "Abre la mesa habilitada para explorarla." });
    expect(await c.act({ type: "station.open", stationId: "rampas", origin: "quickNav" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice).toMatchObject({ text: "Esa mesa se habilitará más adelante." });
    await ok(c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "abrir Sombras");
    expect(await c.act({ type: "shadows.sample", distanceCm: 5 })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await c.act({ type: "ramps.trial.start", angleDeg: 20 })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // acción de otra mesa

    // No existen acciones libres: la pieza la deriva el dominio.
    expect(await c.act({ type: "grantPiece" } as unknown as ParticipantAction)).toMatchObject({ ok: false });
    expect(grupo(c).pieces).toEqual([]);
    // El avance solo se decide con las acciones de la ronda.
    expect(await c.admin({ type: "round.next" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await c.admin({ type: "final.confirm", value: { kind: "written", text: PREGUNTA } })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice?.text).toContain("se confirma en el cierre");
  });

  it("un rechazo no cambia nada: ni la versión del estado ni el de la ronda, y los comandos aceptados llevan las versiones vigentes", async () => {
    const c = make();
    const antes = c.getState().summary!;
    expect(await c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, requestId: "demo-1" });
    expect(c.getState().summary).toMatchObject({ stateVersion: antes.stateVersion, roundVersion: antes.roundVersion });
    const r = await c.admin({ type: "round.open" });
    const despues = c.getState().summary!;
    expect(r).toEqual({ ok: true, requestId: "demo-2", stateVersion: despues.stateVersion, roundVersion: despues.roundVersion });
    expect(despues.stateVersion).toBeGreaterThan(antes.stateVersion);
    expect(despues.roundVersion).toBeGreaterThan(antes.roundVersion); // abrir la mesa abre una ronda nueva
  });

  it("no abre sockets ni hace peticiones de red en todo el recorrido", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("la demostración no debe usar la red");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("WebSocket", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", fetchSpy);
    const c = make(memoryStorage());
    await correr(c, RECORRIDO);
    await c.admin({ type: "room.pause" });
    await c.restart();
    c.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("participación simultánea: el contador de la ronda y el criterio de cada mesa", () => {
  it("antes de abrir la mesa el contador está vacío; al abrirla, Vanessa es la única persona de la ronda y todavía no está lista", async () => {
    const c = make();
    expect(presencia(c).round).toEqual({ ready: 0, total: 0 });
    expect(ella(c)).toMatchObject({ inRound: false, ready: false, progress: null });
    await ok(c.admin({ type: "round.open" }), "abrir");
    expect(ronda(c).roster).toEqual([YO]); // la lista de la ronda se fija al abrirla
    expect(presencia(c).round).toEqual({ ready: 0, total: 1 });
    expect(ella(c)).toMatchObject({ inRound: true, ready: false, progress: { done: 0, needed: 2 } });
  });

  it("Sombras: queda «lista» con dos posiciones de la linterna que cuentan; una muy cercana a otra se guarda pero no suma", async () => {
    const c = make();
    await correr(c, abrirMesa("sombras"));
    await ok(c.act({ type: "shadows.sample", distanceCm: 20 }), "20");
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 1, needed: 2 } });
    await ok(c.act({ type: "shadows.sample", distanceCm: 22 }), "22: a 2 cm de la primera, la separación mínima son 5");
    expect(sombras(c).samples.map((s) => [s.distanceCm, s.counts])).toEqual([[20, true], [22, false]]);
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 1, needed: 2 } });
    expect(presencia(c).round).toEqual({ ready: 0, total: 1 });
    await ok(c.act({ type: "shadows.sample", distanceCm: 50 }), "50");
    expect(ella(c)).toMatchObject({ ready: true, progress: { done: 2, needed: 2 } });
    expect(presencia(c).round).toEqual({ ready: 1, total: 1 }); // «1 de 1 listos»
    // Seguir probando no le quita el estado «lista».
    await ok(c.act({ type: "shadows.sample", distanceCm: 35 }), "35");
    expect(ella(c)).toMatchObject({ ready: true });
    expect(presencia(c).round).toEqual({ ready: 1, total: 1 });
  });

  it("Rampas: la prueba en marcha no cuenta, y con dos terminadas hace falta que difieran en inclinación para quedar «lista»", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas")]);
    await ok(c.act({ type: "ramps.trial.start", angleDeg: 20 }), "prueba 1");
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 0, needed: 2 } }); // en marcha: todavía no es un resultado
    terminarPrueba(c);
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 1, needed: 2 } });
    await ok(c.act({ type: "ramps.trial.start", angleDeg: 20 }), "prueba 2, con la misma inclinación");
    terminarPrueba(c);
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 1, needed: 2 } }); // dos pruebas, pero no comparables: todavía falta una de otra inclinación
    await ok(c.act({ type: "ramps.trial.start", angleDeg: 25 }), "prueba 3, 5° más");
    terminarPrueba(c);
    expect(ella(c)).toMatchObject({ ready: true });
    expect(presencia(c).round).toEqual({ ready: 1, total: 1 });
  });

  it("El observatorio: la casa no cuenta; con la Luna de cerca y el grupo de estrellas queda «lista», y no se proyecta su exploración", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...EXPLORAR.rampas, ...conversar("rampas"), ...abrirMesa("cajas")]);
    expect(telescopio(c)).toMatchObject({ zoom: 0, observed: [], curtain: "open" });
    await ok(c.act({ type: "telescope.aim", x: ventana.x, y: ventana.y, zoom: CLOSE_ZOOM }), "mirar la ventana");
    expect(telescopio(c)).toMatchObject({ observed: [], curtain: "closed" });
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 0, needed: 2 } });
    expect(await c.act({ type: "telescope.aim", x: 0, y: 0, zoom: 7 })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    await ok(c.act({ type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "la Luna");
    await ok(c.act({ type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "las estrellas");
    expect(ella(c)).toMatchObject({ ready: true, progress: { done: 2, needed: 2 } });
    expect(presencia(c).round).toEqual({ ready: 1, total: 1 });
    await ok(c.admin({ type: "round.converse" }), "reunir");
    expect(await c.admin({ type: "present.select", principalId: YO })).toMatchObject({ ok: false, code: "INVALID_STEP" });
  });

  it("durante la conversación sigue contada en la ronda; al abrir la siguiente mesa el contador vuelve a empezar", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, { admin: { type: "round.converse" } }]);
    expect(ronda(c)).toMatchObject({ stage: "conversation", pendingAtConversation: [] });
    expect(presencia(c).round).toEqual({ ready: 1, total: 1 });
    expect(ella(c)).toMatchObject({ inRound: true, ready: true });
    await correr(c, [{ admin: { type: "round.next" } }]);
    expect(presencia(c).round).toEqual({ ready: 0, total: 0 });
    expect(ella(c)).toMatchObject({ inRound: false, ready: false, progress: null });
    await ok(c.admin({ type: "round.open" }), "abrir Rampas");
    expect(presencia(c).round).toEqual({ ready: 0, total: 1 }); // en Rampas todavía no hizo nada
    expect(ella(c)).toMatchObject({ inRound: true, ready: false, progress: { done: 0, needed: 2 } });
  });

  it("reunir al grupo con pendientes pide confirmarlo; con `withPending` se conserva su trabajo parcial y queda registrada como pendiente", async () => {
    const c = make();
    await correr(c, [...abrirMesa("sombras"), { act: { type: "shadows.sample", distanceCm: 20 } }]);
    expect(await c.admin({ type: "round.converse" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice?.text).toContain("Faltan 1 persona por terminar");
    expect(ronda(c).stage).toBe("exploration");
    await ok(c.admin({ type: "round.converse", withPending: true }), "reunir con pendientes");
    expect(ronda(c)).toMatchObject({ stage: "conversation", pendingAtConversation: [YO] });
    expect(sombras(c).samples).toHaveLength(1); // su trabajo parcial se conserva
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 1, needed: 2 } });
    expect(presencia(c).round).toEqual({ ready: 0, total: 1 });
    // En la conversación ya no se explora: se mira la proyección.
    expect(await c.act({ type: "shadows.sample", distanceCm: 50 })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice?.text).toBe("Estamos conversando: mira la proyección.");
  });

  it("pasar a la conversación cancela la prueba en marcha: no cuenta como terminada y ya nada la simula", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }]);
    const prueba = () => rampas(c).trials[0]!;
    advance(c, 1000);
    expect(prueba().state).toBe("running");
    expect(await c.admin({ type: "round.converse" })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // sigue pendiente
    expect(prueba().state).toBe("running"); // un rechazo no la toca
    await ok(c.admin({ type: "round.converse", withPending: true }), "reunir con pendientes");
    expect(prueba()).toMatchObject({ state: "cancelled", endedActiveMs: prueba().startActiveMs + 1000 });
    expect(prueba().endedActiveMs).toBeLessThan(prueba().startActiveMs + prueba().durationMs);
    expect(ronda(c)).toMatchObject({ stage: "conversation", pendingAtConversation: [YO] });
    expect(ella(c)).toMatchObject({ ready: false, progress: { done: 0, needed: 2 } }); // una prueba cancelada no es un resultado

    // Ya no hay nada que simular: ningún reloj la termina después.
    const muestras: ClockSample[] = [];
    c.subscribeClock((m) => muestras.push(m));
    advance(c, 60_000);
    expect(muestras).toEqual([]);
    expect(prueba().state).toBe("cancelled");
    expect(await c.act({ type: "ramps.trial.start", angleDeg: 30 })).toMatchObject({ ok: false, code: "INVALID_STEP" });
  });

  it("una prueba cuya hora ya llegó se asienta antes de reunir al grupo: termina en su instante en vez de cancelarse", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }]);
    const { startActiveMs, durationMs } = rampas(c).trials[0]!;
    now += durationMs + 3000; // el tiempo pasó pero el bucle todavía no corrió
    expect(rampas(c).trials[0]!.state).toBe("running");
    await ok(c.act({ type: "ramps.trial.start", angleDeg: 40 }), "prueba 2"); // la primera se asienta al actuar y la segunda arranca
    expect(rampas(c).trials[0]).toMatchObject({ state: "finished", endedActiveMs: startActiveMs + durationMs });
    now += rampas(c).trials[1]!.durationMs + 1;
    await ok(c.admin({ type: "round.converse" }), "reunir sin pendientes");
    expect(rampas(c).trials.map((t) => t.state)).toEqual(["finished", "finished"]);
    expect(ronda(c).pendingAtConversation).toEqual([]);
  });

  it("Vanessa proyecta sus resultados y guarda notas: se copian al cuaderno común, una comparación por mesa", async () => {
    const c = make();
    await correr(c, EXPLORAR.sombras);
    expect(await c.admin({ type: "present.select", principalId: YO })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // se proyecta al conversar
    expect(await c.admin({ type: "note.save", activityId: "rampas", kind: "synthesis", text: "Todavía no" })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" }); // la mesa aún no se abre
    await correr(c, [{ admin: { type: "round.converse" } }, { admin: { type: "present.select", principalId: YO } }]);
    const comparacion = grupo(c).notebook.find((n) => n.kind === "comparison")!;
    expect(comparacion).toMatchObject({ activityId: "sombras", comparison: { authorId: YO, authorName: "Vanessa", data: { type: "shadows" } }, revision: 1 });
    expect(grupo(c).presentedNoteId).toBe(comparacion.id);
    expect(sombras(c).samples).toHaveLength(2); // seleccionarlos no altera sus pruebas
    await correr(c, [{ admin: { type: "present.clear" } }]);
    expect(grupo(c).presentedNoteId).toBeNull();
    await correr(c, [{ admin: { type: "present.select", principalId: YO } }]);
    expect(grupo(c).notebook.filter((n) => n.kind === "comparison")).toHaveLength(1); // se actualiza, no se duplica
    expect(grupo(c).notebook.find((n) => n.kind === "comparison")).toMatchObject({ revision: 2 });

    await correr(c, [{ admin: { type: "note.save", activityId: "sombras", kind: "initialIdea", text: "Será por la luz" } }, { admin: { type: "note.save", activityId: "sombras", kind: "question", text: "¿Y si movemos el objeto?" } }]);
    expect(grupo(c).notebook.map((n) => n.kind)).toEqual(["comparison", "initialIdea", "question"]);
    const idea = grupo(c).notebook.find((n) => n.kind === "initialIdea")!;
    expect(await c.admin({ type: "note.edit", noteId: idea.id, expectedRevision: 9, text: "otra" })).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    await ok(c.admin({ type: "note.edit", noteId: idea.id, expectedRevision: 1, text: "Será por la distancia de la luz" }), "editar");
    expect(grupo(c).notebook.find((n) => n.id === idea.id)).toMatchObject({ text: "Será por la distancia de la luz", revision: 2, history: [{ revision: 1, text: "Será por la luz" }] });
  });
});

describe("la pieza de cada mesa y la pregunta final", () => {
  it("la pieza se incorpora solo con «siguiente mesa», una vez, y se anuncia como efecto de esa transición", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, { admin: { type: "round.converse" } }, { admin: { type: "round.showFreire" } }, { admin: { type: "present.select", principalId: YO } }]);
    // Terminar de explorar, conversar y proyectar no dan la pieza todavía.
    expect(grupo(c).pieces).toEqual([]);
    expect(grupo(c).completed).toEqual([]);
    expect(efectos(c)).toEqual([]);
    expect(ronda(c)).toMatchObject({ stage: "conversation", freireShown: true });

    await ok(c.admin({ type: "round.next" }), "siguiente mesa");
    expect(grupo(c).pieces).toEqual(["lupa"]);
    expect(grupo(c).completed).toEqual(["sombras"]);
    expect(efectos(c)).toEqual([{ effectId: "1:piece:lupa", kind: "piece.earned", pieceId: "lupa", activityId: "sombras" }]);
    expect(ronda(c)).toMatchObject({ index: 1, stage: "preparation", roster: [], freireShown: false });
    expect(grupo(c).presentedNoteId).toBeNull(); // la proyección de la mesa anterior se retira
    expect(yo(c).view).toEqual({ kind: "map" }); // todas las personas regresan al mapa para recibir la siguiente mesa

    // No se cuenta dos veces: avanzar de nuevo se rechaza y el efecto no se repite.
    expect(await c.admin({ type: "round.next" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(grupo(c).pieces).toEqual(["lupa"]);
    expect(efectos(c)).toHaveLength(1);
    // El efecto pertenece a su transición: la siguiente ya no lo trae.
    await ok(c.admin({ type: "round.open" }), "abrir Rampas");
    expect(efectos(c)).toEqual([]);
    expect(grupo(c).pieces).toEqual(["lupa"]);
  });

  it("la última mesa activa el inventor junto con su pieza; un reinicio da identificadores de efecto nuevos", async () => {
    const c = make();
    await correr(c, TRES_RONDAS.slice(0, TRES_RONDAS.length - 1));
    expect(grupo(c).pieces).toEqual(["lupa", "dialogo"]);
    await ok(c.admin({ type: "round.next" }), "siguiente tras Cajas");
    expect(efectos(c).map((e) => [e.kind, e.pieceId])).toEqual([["piece.earned", "corazon"], ["inventor.activated", undefined]]);
    expect(grupo(c).pieces).toEqual(["lupa", "dialogo", "corazon"]);
    expect(ronda(c)).toMatchObject({ index: 3, stage: "closing" });
    await ok(c.restart(), "reiniciar");
    await correr(c, [...EXPLORAR.sombras, { admin: { type: "round.converse" } }, { admin: { type: "round.next" } }]);
    expect(efectos(c)).toEqual([{ effectId: "2:piece:lupa", kind: "piece.earned", pieceId: "lupa", activityId: "sombras" }]); // otra generación: otro efecto
  });

  it("la pregunta final solo se confirma en el cierre y cierra la aventura: `finished`, efecto de cierre y nada más que hacer", async () => {
    const c = make();
    await correr(c, TRES_RONDAS);
    expect(fase(c)).toBe("running");
    expect(ronda(c).stage).toBe("closing");
    expect(presencia(c).round).toEqual({ ready: 0, total: 0 }); // en el cierre nadie explora
    expect(await c.admin({ type: "final.confirm", value: { kind: "written", text: "   " } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(await c.admin({ type: "final.confirm", value: { kind: "saved", noteId: "n1" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" }); // n1 no es una pregunta guardada
    expect(fase(c)).toBe("running");

    await ok(c.admin({ type: "final.confirm", value: { kind: "written", text: PREGUNTA } }), "pregunta final");
    expect(fase(c)).toBe("finished");
    const final = grupo(c).notebook.find((n) => n.kind === "finalQuestion")!;
    expect(final).toMatchObject({ text: PREGUNTA, activityId: "inventor", revision: 1 });
    expect(grupo(c).inventor.finalQuestionId).toBe(final.id);
    expect(efectos(c)).toEqual([{ effectId: "1:adventure.finished", kind: "adventure.finished" }]);
    expect(grupo(c).pieces).toEqual(["lupa", "dialogo", "corazon"]);
    // Terminada: no se explora ni se conduce más, y el reloj queda quieto.
    expect(await c.act({ type: "player.moveTo", target: { x: 640, y: 450 } })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice?.text).toBe("La aventura terminó.");
    expect(await c.admin({ type: "final.confirm", value: { kind: "written", text: "otra" } })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await c.admin({ type: "round.open" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    // Un error de escritura sí se corrige, y se conserva la versión anterior.
    await ok(c.admin({ type: "final.correct", expectedRevision: 1, text: "¿Por qué flota el hielo?" }), "corregir");
    expect(grupo(c).notebook.find((n) => n.id === final.id)).toMatchObject({ text: "¿Por qué flota el hielo?", revision: 2, history: [{ revision: 1, text: PREGUNTA }] });
    expect(fase(c)).toBe("finished");
  });

  it("la pregunta final puede ser una pregunta que el grupo ya guardó, y queda ligada a su nota", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, { admin: { type: "round.converse" } }, { admin: { type: "note.save", activityId: "sombras", kind: "question", text: "¿Por qué la sombra crece?" } }, { admin: { type: "round.next" } }]);
    await correr(c, [...EXPLORAR.rampas, ...conversar("rampas"), ...EXPLORAR.cajas, ...conversar("cajas")]);
    const guardada = grupo(c).notebook.find((n) => n.kind === "question")!;
    await ok(c.admin({ type: "final.confirm", value: { kind: "saved", noteId: guardada.id } }), "pregunta guardada");
    expect(fase(c)).toBe("finished");
    expect(grupo(c).notebook.find((n) => n.kind === "finalQuestion")).toMatchObject({ text: "¿Por qué la sombra crece?", sourceNoteId: guardada.id });
  });
});

describe("estado y almacenamiento aislados de cualquier sala (CT-14)", () => {
  it("usa solo su clave, sin credenciales ni IDs de sala compartida, y no toca lo de una sala real", async () => {
    const credentialKey = "laboratorio-cosas-cotidianas:v1:sala:ABC234";
    const draftKey = "laboratorio-cosas-cotidianas:v1:borrador:ABC234:sombras:firstIdea";
    const storage = memoryStorage({ [credentialKey]: '{"token":"SECRETO-DE-LA-SALA"}', [draftKey]: "borrador de la sala" });
    storage.touched.clear();
    const c = make(storage);
    await correr(c, EXPLORAR.sombras);
    await c.restart();
    c.dispose();
    expect([...storage.touched].sort()).toEqual([DEMO_STORAGE_KEY]); // solo su espacio: ni siquiera LEE el de una sala
    expect(storage.data.get(credentialKey)).toBe('{"token":"SECRETO-DE-LA-SALA"}');
    expect(storage.data.get(draftKey)).toBe("borrador de la sala");
    const saved = storage.data.get(DEMO_STORAGE_KEY)!;
    expect(saved).not.toMatch(/token|SECRETO/i);
    expect(JSON.parse(saved).room).toMatchObject({ roomId: "demo", code: "DEMO" });
  });

  it("al reiniciar vuelve directamente a la primera mesa ya comenzada, y solo se borra el avance de la demostración", async () => {
    const storage = memoryStorage({ otraClave: "intacta" });
    const c = make(storage);
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas")]);
    expect(grupo(c).notebook.length).toBeGreaterThan(0);
    expect(grupo(c).pieces).toEqual(["lupa"]);
    expect(await c.restart()).toMatchObject({ ok: true });
    expect(grupo(c)).toMatchObject({ notebook: [], pieces: [], completed: [], presentedNoteId: null });
    expect(ronda(c)).toMatchObject({ index: 0, stage: "preparation", roster: [] }); // sin «comenzar» que pulsar ni a quién esperar
    expect(c.getState().summary).toMatchObject({ phase: "running", roomGeneration: 2 });
    expect(yo(c).view).toEqual({ kind: "map" });
    expect(sombras(c).samples).toEqual([]);
    expect(rampas(c).trials).toEqual([]);
    expect(efectos(c)).toEqual([]);
    expect(storage.data.get("otraClave")).toBe("intacta");
    await correr(c, EXPLORAR.sombras); // y se puede volver a jugar sin más
    expect(ella(c).ready).toBe(true);
  });

  it("recargar la página conserva lo confirmado, vuelve en pausa y no suma el tiempo transcurrido", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await correr(a, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }]);
    advance(a, 1000);
    a.dispose();

    now += 10 * 60_000; // diez minutos con la pestaña cerrada
    const b = make(storage);
    expect(b.getState().summary).toMatchObject({ phase: "paused", resumePhase: "running", adminConnected: true, self: { role: "admin", displayName: "Vanessa" } });
    expect(grupo(b).notebook.map((n) => [n.kind, n.activityId])).toEqual(grupo(a).notebook.map((n) => [n.kind, n.activityId]));
    expect(grupo(b).pieces).toEqual(["lupa"]);
    expect(ronda(b)).toMatchObject({ index: 1, stage: "exploration", roster: [YO] });
    expect(yo(b).view).toEqual({ kind: "activity", activityId: "rampas" });
    expect(grupo(b).timeline.activeMs).toBe(1000); // solo el segundo que corrió: los diez minutos cerrada no cuentan
    expect(rampas(b).trials[0]!.state).toBe("running");

    // En pausa nadie actúa, tampoco Vanessa: primero reanuda.
    expect(await b.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await b.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    await ok(b.admin({ type: "room.resume" }), "reanudar");
    expect(fase(b)).toBe("running");
    advance(b, 60_000);
    const prueba = rampas(b).trials[0]!;
    expect(prueba).toMatchObject({ state: "finished" });
    expect(prueba.endedActiveMs! - prueba.startActiveMs).toBe(prueba.durationMs);
  });

  it("una aventura terminada también vuelve en pausa y, al reanudar, sigue terminada con su pregunta final", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await correr(a, RECORRIDO);
    a.dispose();
    const b = make(storage);
    expect(b.getState().summary).toMatchObject({ phase: "paused", resumePhase: "finished" });
    expect(grupo(b).notebook.find((n) => n.kind === "finalQuestion")?.text).toBe(PREGUNTA);
    await ok(b.admin({ type: "room.resume" }), "reanudar");
    expect(fase(b)).toBe("finished");
    expect(grupo(b).pieces).toEqual(["lupa", "dialogo", "corazon"]);
  });

  it("si el contenido cambió, la versión guardada es de otro modelo, lo guardado está dañado o el almacenamiento falla, empieza de cero sin romperse", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await correr(a, [...EXPLORAR.sombras, ...conversar("sombras")]);
    a.dispose();
    const guardado = JSON.parse(storage.data.get(DEMO_STORAGE_KEY)!);
    expect(make(storage).getState().summary).toMatchObject({ phase: "paused" }); // lo guardado, tal cual, sí se reanuda
    /** Empezar de cero: en curso (no en pausa), en la primera mesa y sin nada del avance guardado. */
    const deCero = (c: DemoController) => {
      expect(c.getState().summary).toMatchObject({ phase: "running", roomGeneration: 1 });
      expect(ronda(c)).toMatchObject({ index: 0, stage: "preparation" });
      expect(grupo(c)).toMatchObject({ notebook: [], pieces: [], completed: [] });
    };
    const con = (cambios: Record<string, unknown>) => storage.data.set(DEMO_STORAGE_KEY, JSON.stringify({ ...guardado, ...cambios }));

    deCero(make(storage, {}, { ...bundle, configHash: "otro-contenido" }));
    deCero(make(storage, {}, { ...bundle, mapHash: "otro-mapa" }));
    con({ v: 1 }); // el formato del modelo de un solo turno ya no se puede reanudar
    deCero(make(storage));
    con({ v: undefined });
    deCero(make(storage));
    con({ room: { ...guardado.room, code: "XYZ789" } });
    deCero(make(storage));
    con({ room: { ...guardado.room, roomId: "otra-sala" } });
    deCero(make(storage));
    con({ room: { ...guardado.room, participants: {} } }); // sin Vanessa no hay a quién reanudar
    deCero(make(storage));
    con({ room: { ...guardado.room, adventure: { mapId: bundle.map.mapId, round: "turno" } } }); // forma del modelo anterior
    deCero(make(storage));
    con({ room: { ...guardado.room, roundVersion: undefined } });
    deCero(make(storage));
    storage.data.set(DEMO_STORAGE_KEY, "{no es json");
    deCero(make(storage));
    storage.data.set(DEMO_STORAGE_KEY, "null");
    deCero(make(storage));
    storage.data.set(DEMO_STORAGE_KEY, JSON.stringify({ v: 1, configHash: bundle.configHash, mapHash: bundle.mapHash, room: { roomId: "otra-sala", code: "XYZ789" } }));
    deCero(make(storage));

    const roto: DemoStorage = { getItem: () => { throw new Error("sin almacenamiento"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => undefined };
    const c = make(roto);
    await correr(c, EXPLORAR.sombras);
    expect(sombras(c).samples).toHaveLength(2); // sigue funcionando en memoria
    expect(() => c.dispose()).not.toThrow();
    // Y sin almacenamiento alguno (modo privado, `storage: null`) tampoco guarda nada.
    await correr(make(null), EXPLORAR.sombras);
  });

  it("empezar de cero sobre lo incompatible reemplaza lo guardado en el primer cambio, y entonces sí se reanuda", async () => {
    const storage = memoryStorage({ [DEMO_STORAGE_KEY]: JSON.stringify({ v: 1, room: {} }) });
    const a = make(storage);
    await correr(a, EXPLORAR.sombras);
    a.dispose();
    const b = make(storage);
    expect(b.getState().summary).toMatchObject({ phase: "paused" });
    expect(sombras(b).samples).toHaveLength(2);
    expect(JSON.parse(storage.data.get(DEMO_STORAGE_KEY)!).v).toBe(2);
  });
});

describe("reloj y pausa de la demostración (CA-11)", () => {
  it("pausar congela la prueba; reanudar no suma la conversación y termina en su instante exacto", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }]);
    const t = () => rampas(c).trials[0]!;
    advance(c, 1000);
    expect(await c.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    expect(fase(c)).toBe("paused");
    const congelado = grupo(c).timeline.activeMs;
    expect(congelado).toBe(1000);
    advance(c, 90_000); // charla larga
    expect(grupo(c).timeline.activeMs).toBe(congelado);
    expect(t().state).toBe("running");
    expect(await c.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    expect(await c.admin({ type: "round.converse", withPending: true })).toMatchObject({ ok: false, code: "ROOM_PAUSED" }); // Vanessa tampoco conduce en pausa
    await c.admin({ type: "room.resume" });
    advance(c, t().durationMs - 1000 - 1);
    expect(t().state).toBe("running");
    advance(c, 2);
    expect(t()).toMatchObject({ state: "finished", endedActiveMs: t().startActiveMs + t().durationMs });
  });

  it("`tick()` termina la prueba de rampa en su instante exacto, aunque el bucle llegue tarde", async () => {
    const c = make();
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }]);
    const primera = rampas(c).trials[0]!;
    advance(c, primera.durationMs - 1);
    expect(rampas(c).trials[0]!.state).toBe("running");
    advance(c, 1);
    expect(rampas(c).trials[0]).toMatchObject({ state: "finished", endedActiveMs: primera.startActiveMs + primera.durationMs });
    await ok(c.act({ type: "ramps.trial.start", angleDeg: 40 }), "prueba 2");
    const segunda = rampas(c).trials[1]!;
    advance(c, segunda.durationMs + 7000); // el tick llega siete segundos tarde
    expect(rampas(c).trials[1]).toMatchObject({ state: "finished", endedActiveMs: segunda.startActiveMs + segunda.durationMs });
    expect(ella(c).ready).toBe(true);
  });

  it("emite muestras del reloj mientras algo se simula, ninguna en pausa y ninguna cuando todo está quieto", async () => {
    const c = make();
    const muestras: ClockSample[] = [];
    const baja = c.subscribeClock((m) => muestras.push(m));
    advance(c, 100);
    expect(muestras).toEqual([]); // nada se mueve ni corre una prueba: no hay nada que emitir
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas")]);
    muestras.length = 0;
    await ok(c.act({ type: "ramps.trial.start", angleDeg: 20 }), "prueba");
    expect(muestras).toHaveLength(1); // cada transición confirmada lleva su muestra
    for (let i = 0; i < 5; i++) advance(c, 100);
    expect(muestras).toHaveLength(6);
    const seqs = muestras.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(muestras.every((m) => m.running && m.roomGeneration === 1)).toBe(true);
    expect(muestras.at(-1)!.activeMs - muestras[0]!.activeMs).toBe(500);
    expect(muestras.at(-1)!.stateVersion).toBe(c.getState().summary!.stateVersion);

    await c.admin({ type: "room.pause" });
    expect(muestras.at(-1)).toMatchObject({ running: false });
    const n = muestras.length;
    for (let i = 0; i < 5; i++) advance(c, 100);
    expect(muestras).toHaveLength(n);
    await c.admin({ type: "room.resume" });
    expect(muestras.at(-1)).toMatchObject({ running: true });
    baja();
    const m = muestras.length;
    advance(c, 100);
    expect(muestras).toHaveLength(m); // darse de baja corta la entrega
  });

  it("tras reiniciar, las muestras llevan la generación nueva", async () => {
    const c = make();
    const muestras: ClockSample[] = [];
    c.subscribeClock((m) => muestras.push(m));
    await c.restart();
    expect(muestras.at(-1)).toMatchObject({ roomGeneration: 2, running: true });
    expect(c.getState().summary!.roomGeneration).toBe(2);
  });

  it("el movimiento de Vanessa se simula igual que el de cualquier participante: llega por reloj, sin servidor, y el reloj calla al llegar", async () => {
    const c = make();
    const salida = yo(c).character.feet;
    const destino = { x: bundle.map.stations[0]!.point.x, y: bundle.map.stations[0]!.point.y };
    await ok(c.act({ type: "player.moveTo", target: destino }), "caminar"); // en la preparación sí se camina por el laboratorio
    const plan = yo(c).character.plan!;
    expect(plan).not.toBeNull();
    expect(planDurationMs(plan)).toBeGreaterThan(1000);
    const muestras: ClockSample[] = [];
    c.subscribeClock((m) => muestras.push(m));
    advance(c, 100);
    expect(muestras).toHaveLength(1); // mientras camina, el bucle sigue emitiendo
    advance(c, planDurationMs(plan));
    expect(muestras).toHaveLength(1); // ya llegó: nada más que simular
    advance(c, 100);
    expect(muestras).toHaveLength(1);
    const llegada = playerAt(yo(c).character, plan.startActiveMs + planDurationMs(plan) + 200);
    expect(llegada.moving).toBe(false);
    expect(Math.hypot(llegada.feet.x - destino.x, llegada.feet.y - destino.y)).toBeLessThan(2);
    expect(llegada.feet).not.toEqual(salida);
    // Al abrir la mesa se detiene donde está.
    await correr(c, abrirMesa("sombras"));
    expect(yo(c).character.plan).toBeNull();
  });
});

describe("ciclo de vida y contrato observable", () => {
  it("`connect()` arranca el bucle una sola vez, `dispose()` lo libera y con `tickMs: 0` no hay temporizador", async () => {
    vi.useFakeTimers();
    const c = make(null, { tickMs: 100 });
    const muestras: ClockSample[] = [];
    c.subscribeClock((m) => muestras.push(m));
    expect(vi.getTimerCount()).toBe(0); // crear el controlador no arranca nada
    c.connect();
    c.connect();
    expect(vi.getTimerCount()).toBe(1);
    expect(muestras).toHaveLength(1); // una muestra al conectar
    await ok(c.act({ type: "player.moveTo", target: { x: 640, y: 450 } }), "caminar");
    expect(muestras).toHaveLength(2);
    now += 100;
    vi.advanceTimersByTime(100);
    expect(muestras).toHaveLength(3); // el temporizador llama a tick()
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    now += 100;
    vi.advanceTimersByTime(1000);
    c.tick();
    expect(muestras).toHaveLength(3);
    c.connect(); // una demostración cerrada no revive
    expect(vi.getTimerCount()).toBe(0);

    const sinBucle = make(null, { tickMs: 0 });
    sinBucle.connect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("`dispose()` guarda lo último que se vio, incluso el tiempo corrido desde el último cambio", async () => {
    const storage = memoryStorage();
    const a = make(storage, { checkpointMs: 1_000_000 });
    await correr(a, EXPLORAR.sombras);
    now += 750; // nada lo confirmó: ni un tick ni una acción
    a.dispose();
    const b = make(storage);
    expect(sombras(b).samples).toHaveLength(2);
    expect(grupo(b).timeline.activeMs).toBe(750);
    expect(b.getState().summary!.phase).toBe("paused");
  });

  it("los checkpoints del bucle guardan el avance sin esperar a un cambio, y solo cuando algo se simula", async () => {
    const storage = memoryStorage();
    const c = make(storage, { checkpointMs: 500 });
    await correr(c, [...EXPLORAR.sombras, ...conversar("sombras"), ...abrirMesa("rampas"), { act: { type: "ramps.trial.start", angleDeg: 20 } }]);
    const guardado = () => JSON.parse(storage.data.get(DEMO_STORAGE_KEY)!).room.adventure.timeline.activeMs as number;
    advance(c, 300);
    expect(guardado()).toBe(0); // aún no toca checkpoint
    advance(c, 300);
    expect(guardado()).toBe(600);
  });

  it("avisa a quien está suscrito solo cuando algo cambia, y deja de avisar al darse de baja o al cerrar", async () => {
    const c = make();
    const avisos = vi.fn();
    const baja = c.subscribe(avisos);
    const antes = c.getState();
    expect(c.getState()).toBe(antes); // estable mientras nada cambia (lo necesita useSyncExternalStore)
    expect(await c.act({ type: "adventure.returnToMap" })).toMatchObject({ ok: true }); // ya está en el mapa: aceptada, sin cambios
    expect(avisos).not.toHaveBeenCalled();
    expect(c.getState()).toBe(antes);
    await ok(c.admin({ type: "round.open" }), "abrir");
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(c.getState()).not.toBe(antes);
    baja();
    await ok(c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "abrir Sombras");
    expect(avisos).toHaveBeenCalledTimes(1);
    const otro = vi.fn();
    c.subscribe(otro);
    c.dispose();
    await c.act({ type: "shadows.sample", distanceCm: 20 }).catch(() => undefined);
    expect(otro).not.toHaveBeenCalled();
  });

  it("los avisos llevan un identificador nuevo cada vez y solo se retira el que se pide", async () => {
    const c = make();
    await c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const primero = c.getState().notice!;
    expect(primero).toMatchObject({ kind: "error", text: "Vanessa abrirá la mesa en un momento." });
    await c.act({ type: "station.open", stationId: "sombras", origin: "quickNav" });
    const segundo = c.getState().notice!;
    expect(segundo.text).toBe(primero.text);
    expect(segundo.id).toBeGreaterThan(primero.id); // dos veces el mismo texto se anuncian dos veces
    c.clearNotice(primero.id);
    expect(c.getState().notice).toEqual(segundo);
    c.clearNotice(segundo.id);
    expect(c.getState().notice).toBeNull();
    c.notify("info", "Listo");
    expect(c.getState().notice).toMatchObject({ kind: "info", text: "Listo" });
  });
});
