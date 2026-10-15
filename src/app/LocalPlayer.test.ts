import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParticipantAction } from "../../shared/contracts/actions";
import type { ClockSample } from "../../shared/contracts/events";
import type { AdventureState, RampsState, ShadowsState, TelescopeState } from "../../shared/contracts/state";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";
import { planDurationMs } from "../../shared/domain/movement";
import { playerAt } from "../../shared/domain/participant";
import { personReadiness } from "../../shared/domain/results";
import { createInitialAdventure } from "../../shared/domain/round";
import { bundle, Driver } from "../../shared/testing/drive";
import { LocalPlayer, type LocalPlayerOptions } from "./LocalPlayer";

// El jugador local es la persona de demostración que Vanessa usa sobre la proyección de una sala real (propuesta de rondas, sección 11):
// explora la mesa con las reglas de cualquier participante, pero todo ocurre en este dispositivo y no sale nada de él.
vi.mock("socket.io-client", () => ({
  io: () => {
    throw new Error("el jugador local no debe abrir ningún socket");
  },
}));

let now = 0;
const MESAS = ["sombras", "rampas", "cajas"] as const;
const make = (mesa = "sombras", adv: AdventureState = createInitialAdventure(bundle.map), over: LocalPlayerOptions = {}) => new LocalPlayer(bundle, adv, mesa, { mono: () => now, tickMs: 0, ...over });
const advance = (p: LocalPlayer, ms: number) => {
  now += ms;
  p.tick();
};
const ok = async (p: LocalPlayer, action: ParticipantAction) => expect(await p.perform(action), action.type).toMatchObject({ ok: true });

const sombras = (p: LocalPlayer) => p.getParticipant().activities.sombras as ShadowsState;
const rampas = (p: LocalPlayer) => p.getParticipant().activities.rampas as RampsState;
const telescopio = (p: LocalPlayer) => p.getParticipant().activities.cajas as TelescopeState;
const { moon, stars, window: ventana } = TELESCOPE_TARGETS;
const luna: ParticipantAction = { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM };
const estrellas: ParticipantAction = { type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 };
const listo = (p: LocalPlayer) => personReadiness(p.getParticipant(), p.activityId, bundle.config).ready;

/** El estado de grupo de una sala real en la etapa indicada de la primera mesa (la sala puede ir por delante o por detrás de Vanessa). */
function aventura(etapa: "preparation" | "exploration" | "conversation" | "closing"): AdventureState {
  if (etapa === "preparation") return createInitialAdventure(bundle.map);
  const d = new Driver(["ana"]);
  if (etapa === "closing") {
    d.playToClosing();
    return d.room.adventure;
  }
  d.toExploration(0);
  if (etapa === "conversation") d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
  return d.room.adventure;
}

afterEach(() => {
  now = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LocalPlayer: empieza dentro de la mesa y no depende de la ronda de la sala", () => {
  it.each(MESAS)("empieza con la mesa «%s» abierta, en su sitio de la entrada y sin ningún resultado", (mesa) => {
    const p = make(mesa);
    const persona = p.getParticipant();
    expect(p.activityId).toBe(mesa);
    expect(persona.view).toEqual({ kind: "activity", activityId: mesa });
    expect(persona.character.plan).toBeNull();
    expect(persona.character.feet).toEqual(new Driver(["ana"]).person("ana").character.feet); // el primer lugar de la entrada, como la primera persona de una sala
    expect(personReadiness(persona, mesa, bundle.config)).toMatchObject({ done: 0, ready: false });
  });

  it.each(["preparation", "exploration", "conversation", "closing"] as const)("explora con la sala en «%s»: lo que se demuestra es la mesa, no el momento de la ronda", async (etapa) => {
    const p = make("sombras", aventura(etapa));
    await ok(p, { type: "shadows.sample", distanceCm: 20 });
    await ok(p, { type: "shadows.sample", distanceCm: 50 });
    expect(listo(p)).toBe(true);
  });

  it("las tres mesas se pueden demostrar aunque la sala todavía esté en la primera", async () => {
    const adv = aventura("preparation");
    const a = make("rampas", adv);
    await ok(a, { type: "ramps.trial.start", angleDeg: 20 });
    const b = make("cajas", adv);
    await ok(b, luna);
    await ok(b, estrellas);
    expect(listo(b)).toBe(true);
    expect(rampas(a).trials).toHaveLength(1);
  });
});

describe("LocalPlayer: las mismas reglas que un participante", () => {
  it("Sombras: produce el mismo resultado que el dominio con las mismas acciones (es `reduceParticipant`, no otra implementación)", async () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    d.readyShadows("ana");
    const p = make("sombras");
    await ok(p, { type: "shadows.sample", distanceCm: 20 });
    await ok(p, { type: "shadows.sample", distanceCm: 50 });
    expect(p.getParticipant().activities.sombras).toEqual(d.person("ana").activities.sombras);
    expect(p.getParticipant().view).toEqual(d.person("ana").view);
    expect(sombras(p).samples[0]!.shadowCm).toBeCloseTo((8 * (20 + 25)) / 20, 6); // 18 cm: la misma fórmula del modelo compartido
  });

  it("Sombras: una posición muy cercana a otra se guarda pero no cuenta, y la misma posición dos veces seguidas no se repite", async () => {
    const p = make("sombras");
    await ok(p, { type: "shadows.sample", distanceCm: 20 });
    await ok(p, { type: "shadows.sample", distanceCm: 22 });
    await ok(p, { type: "shadows.sample", distanceCm: 22 });
    expect(sombras(p).samples.map((s) => [s.distanceCm, s.counts])).toEqual([[20, true], [22, false]]);
    expect(listo(p)).toBe(false);
    await ok(p, { type: "shadows.sample", distanceCm: 25 });
    expect(listo(p)).toBe(true);
  });

  it("rechaza lo que el servidor rechazaría, con el mismo código y el mismo motivo, y no cambia nada", async () => {
    const p = make("sombras");
    const antes = p.getParticipant();
    const escuchas = vi.fn();
    p.subscribe(escuchas);
    for (const cm of [5, 61, Number.NaN]) {
      const r = await p.perform({ type: "shadows.sample", distanceCm: cm });
      expect(r).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
      expect(!r.ok && r.message).toBe("La linterna debe estar entre 10 y 60 cm del objeto.");
    }
    expect(await p.perform({ type: "ramps.trial.start", angleDeg: 20 })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // acción de otra mesa
    expect(await p.perform(luna)).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await p.perform({ type: "station.open", stationId: "rampas", origin: "quickNav" })).toMatchObject({ ok: false, code: "INVALID_STEP", message: "Esa mesa se habilitará más adelante." });
    expect(await p.perform({ type: "grantPiece" } as unknown as ParticipantAction)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" }); // no hay acciones libres
    expect(p.getParticipant()).toBe(antes);
    expect(escuchas).not.toHaveBeenCalled();
  });

  it("Rampas: una sola prueba a la vez, con inclinaciones válidas, y quedan las condiciones congeladas de la mesa", async () => {
    const p = make("rampas");
    expect(await p.perform({ type: "ramps.trial.start", angleDeg: 10 })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" }); // menos del mínimo
    expect(await p.perform({ type: "ramps.trial.start", angleDeg: 22 })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" }); // no es múltiplo del paso
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    expect(rampas(p).trials[0]).toMatchObject({ angleDeg: 20, model: "solid-sphere-ideal-v1", lengthMeters: 2, state: "running" });
    expect(await p.perform({ type: "ramps.trial.start", angleDeg: 30 })).toMatchObject({ ok: false, code: "INVALID_STEP", message: "Espera a que termine la prueba." });
    expect(rampas(p).trials).toHaveLength(1);
  });

  it("El observatorio: la ventana cierra la cortina sin contar; la Luna de cerca y las estrellas, una vez cada una, la dejan lista", async () => {
    const p = make("cajas");
    await ok(p, { type: "telescope.aim", x: ventana.x, y: ventana.y, zoom: CLOSE_ZOOM });
    expect(telescopio(p)).toMatchObject({ observed: [], curtain: "closed" });
    expect(listo(p)).toBe(false);
    expect(await p.perform({ type: "telescope.aim", x: Number.NaN, y: 0, zoom: 0 })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    await ok(p, luna);
    await ok(p, luna);
    await ok(p, estrellas);
    expect(telescopio(p).observed).toEqual(["moon", "stars"]);
    expect(listo(p)).toBe(true);
  });

  it("también camina por el laboratorio con las reglas del mapa: hay que volver al mapa, y abrir una mesa «desde el mapa» exige estar cerca", async () => {
    const p = make("sombras");
    const destino = { x: 640, y: 450 };
    expect(await p.perform({ type: "player.moveTo", target: destino })).toMatchObject({ ok: false, code: "INVALID_STEP", message: "Vuelve al mapa para moverte." });
    await ok(p, { type: "adventure.returnToMap" });
    expect(p.getParticipant().view).toEqual({ kind: "map" });
    expect(await p.perform({ type: "player.moveTo", target: { x: -50, y: 10 } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    now = 3000;
    const quieto = p.getParticipant().character.feet;
    await ok(p, { type: "player.moveTo", target: destino });
    const plan = p.getParticipant().character.plan!;
    expect(plan).toMatchObject({ planId: "m1", startActiveMs: 3000 }); // el plan arranca en el reloj local
    expect(playerAt(p.getParticipant().character, 3000).feet).toEqual(quieto);
    const llegada = playerAt(p.getParticipant().character, 3000 + planDurationMs(plan) + 1);
    expect(llegada).toMatchObject({ moving: false, feet: destino });
    expect(await p.perform({ type: "station.open", stationId: "sombras", origin: "map" })).toMatchObject({ ok: false, code: "INVALID_STEP", message: "Acércate a la mesa para abrirla." });
    await ok(p, { type: "station.open", stationId: "sombras", origin: "quickNav" });
    expect(p.getParticipant().character.plan).toBeNull(); // al abrir la mesa el personaje se detiene donde está
    expect(p.getParticipant().view).toEqual({ kind: "activity", activityId: "sombras" });
  });

  it("cada comando lleva un identificador propio y la versión que va subiendo con cada cambio", async () => {
    const p = make("sombras");
    const a = await p.perform({ type: "shadows.sample", distanceCm: 20 });
    const b = await p.perform({ type: "shadows.sample", distanceCm: 20 }); // aceptada, sin cambios
    const c = await p.perform({ type: "shadows.sample", distanceCm: 50 });
    const d = await p.perform({ type: "shadows.sample", distanceCm: 5 }); // rechazada
    expect([a, b, c, d].map((r) => r.requestId)).toEqual(["local-2", "local-3", "local-4", "local-5"]); // «local-1» fue abrir la mesa
    if (!a.ok || !b.ok || !c.ok) throw new Error("las tres primeras deben aceptarse");
    expect(b.stateVersion).toBe(a.stateVersion);
    expect(c.stateVersion).toBe(a.stateVersion + 1);
    expect(a.roundVersion).toBe(1);
  });
});

describe("LocalPlayer: reloj propio y pruebas de rampa", () => {
  it("su reloj corre desde que se abre y no depende del reloj de la sala ni del momento en que se creó", () => {
    now = 7000; // la página ya llevaba un rato abierta
    const sala = { ...createInitialAdventure(bundle.map), timeline: { activeMs: 500_000 } };
    const p = make("rampas", sala);
    expect(p.activeMs()).toBe(0);
    now += 1500;
    expect(p.activeMs()).toBe(1500);
    const otro = make("rampas", sala); // otra demostración posterior tiene su propio cero
    expect(otro.activeMs()).toBe(0);
    now += 500;
    expect(p.activeMs()).toBe(2000);
    expect(otro.activeMs()).toBe(500);
  });

  it("las pruebas empiezan en el reloj local, no en el de la sala, y sus identificadores son propios", async () => {
    const sala = { ...createInitialAdventure(bundle.map), timeline: { activeMs: 500_000 }, counters: { note: 3, trial: 7, plan: 2 } };
    const p = make("rampas", sala);
    now += 1500;
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    expect(rampas(p).trials[0]).toMatchObject({ trialId: "t1", startActiveMs: 1500 });
  });

  it("una prueba termina en su instante exacto con `tick()`, una sola vez, y avisa solo entonces", async () => {
    const p = make("rampas");
    const escuchas = vi.fn();
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    const { startActiveMs, durationMs } = rampas(p).trials[0]!;
    p.subscribe(escuchas);
    const antes = p.getParticipant();
    advance(p, durationMs - 1);
    expect(rampas(p).trials[0]!.state).toBe("running");
    expect(p.getParticipant()).toBe(antes);
    expect(escuchas).not.toHaveBeenCalled();
    advance(p, 1);
    expect(rampas(p).trials[0]).toMatchObject({ state: "finished", endedActiveMs: startActiveMs + durationMs });
    expect(escuchas).toHaveBeenCalledTimes(1);
    expect(p.getParticipant()).not.toBe(antes);
    advance(p, 10_000);
    expect(escuchas).toHaveBeenCalledTimes(1); // ya no hay nada que asentar
    expect(rampas(p).trials[0]!.endedActiveMs).toBe(startActiveMs + durationMs);
  });

  it("aunque el tick llegue tarde la prueba termina en su instante, y con dos inclinaciones distintas la mesa queda lista", async () => {
    const p = make("rampas");
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    advance(p, rampas(p).trials[0]!.durationMs + 7000);
    await ok(p, { type: "ramps.trial.start", angleDeg: 40 });
    expect(listo(p)).toBe(false); // la segunda todavía corre
    const segunda = rampas(p).trials[1]!;
    advance(p, segunda.durationMs + 7000);
    expect(rampas(p).trials.map((t) => t.endedActiveMs)).toEqual(rampas(p).trials.map((t) => t.startActiveMs + t.durationMs));
    expect(listo(p)).toBe(true);
  });

  it("si la hora de una prueba llegó y nadie llamó a `tick()`, la siguiente acción la asienta antes de empezar otra", async () => {
    const p = make("rampas");
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    const { startActiveMs, durationMs } = rampas(p).trials[0]!;
    now += durationMs + 500;
    await ok(p, { type: "ramps.trial.start", angleDeg: 40 });
    expect(rampas(p).trials[0]).toMatchObject({ state: "finished", endedActiveMs: startActiveMs + durationMs });
    expect(rampas(p).trials[1]).toMatchObject({ state: "running", startActiveMs: durationMs + 500 });
  });

  it("emite muestras del reloj en cada tick, con la versión del estado y una secuencia creciente, hasta que se da de baja", async () => {
    const p = make("rampas");
    const muestras: ClockSample[] = [];
    const baja = p.subscribeClock((m) => muestras.push(m));
    p.tick(); // nada corre, pero el reloj de Vanessa siempre avanza
    expect(muestras[0]).toMatchObject({ roomGeneration: 1, activeMs: 0, running: true, seq: 1 });
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    advance(p, 250);
    expect(muestras[1]).toMatchObject({ activeMs: 250, seq: 2 });
    expect(muestras[1]!.stateVersion).toBeGreaterThan(muestras[0]!.stateVersion); // la prueba cambió el estado
    const { durationMs } = rampas(p).trials[0]!;
    advance(p, durationMs);
    expect(muestras[2]).toMatchObject({ activeMs: 250 + durationMs, seq: 3 });
    expect(muestras[2]!.stateVersion).toBeGreaterThan(muestras[1]!.stateVersion); // terminar la prueba también
    baja();
    advance(p, 100);
    expect(muestras).toHaveLength(3);
  });

  it("el temporizador propio llama a `tick()` y `dispose()` lo libera; con `tickMs: 0` no hay ninguno", () => {
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
    const p = make("rampas", createInitialAdventure(bundle.map), { tickMs: 100 });
    expect(vi.getTimerCount()).toBe(1);
    const muestras: ClockSample[] = [];
    p.subscribeClock((m) => muestras.push(m));
    vi.advanceTimersByTime(300);
    expect(muestras.map((m) => m.seq)).toEqual([1, 2, 3]);
    p.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(muestras).toHaveLength(3);
    p.dispose(); // idempotente
    make("rampas");
    expect(vi.getTimerCount()).toBe(0);
    new LocalPlayer(bundle, createInitialAdventure(bundle.map), "rampas", { mono: () => now }); // sin opciones: bucle por defecto
    expect(vi.getTimerCount()).toBe(1);
  });

  it("tras `dispose()` ya no entrega nada: ni muestras ni avisos, y `tick()` no hace nada", async () => {
    const p = make("rampas");
    await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
    const escuchas = vi.fn();
    const muestras = vi.fn();
    p.subscribe(escuchas);
    p.subscribeClock(muestras);
    p.dispose();
    advance(p, 60_000);
    expect(muestras).not.toHaveBeenCalled();
    expect(escuchas).not.toHaveBeenCalled();
    expect(rampas(p).trials[0]!.state).toBe("running"); // nadie la asentó
  });
});

describe("LocalPlayer: nada de lo suyo sale del objeto (no hay red)", () => {
  it("no abre sockets, no hace peticiones y no toca el almacenamiento del navegador en toda una sesión", async () => {
    const red = vi.fn(() => {
      throw new Error("el jugador local no debe usar la red");
    });
    const almacenamiento = { getItem: red, setItem: red, removeItem: red, clear: red, key: red, length: 0 };
    vi.stubGlobal("fetch", red);
    vi.stubGlobal("WebSocket", red);
    vi.stubGlobal("XMLHttpRequest", red);
    vi.stubGlobal("EventSource", red);
    vi.stubGlobal("localStorage", almacenamiento);
    vi.stubGlobal("sessionStorage", almacenamiento);
    const sala = aventura("exploration");
    const s = make("sombras", sala);
    await ok(s, { type: "shadows.sample", distanceCm: 20 });
    await ok(s, { type: "shadows.sample", distanceCm: 50 });
    const r = make("rampas", sala);
    await ok(r, { type: "ramps.trial.start", angleDeg: 20 });
    advance(r, 10_000);
    const c = make("cajas", sala);
    await ok(c, luna);
    await ok(c, estrellas);
    for (const p of [s, r, c]) p.dispose();
    expect(red).not.toHaveBeenCalled();
  });

  it("no modifica el estado de la sala que recibió: ni la ronda, ni el cuaderno, ni las piezas, ni los contadores", async () => {
    const d = new Driver(["ana"]);
    d.playToClosing();
    d.must(d.admin({ type: "note.save", activityId: "sombras", kind: "question", text: "¿Y si movemos el objeto?" }), "guardar una pregunta");
    const sala = d.room.adventure;
    const copia = structuredClone(sala);
    for (const mesa of MESAS) {
      const p = make(mesa, sala);
      if (mesa === "sombras") {
        await ok(p, { type: "shadows.sample", distanceCm: 20 });
        await ok(p, { type: "shadows.sample", distanceCm: 50 });
      } else if (mesa === "rampas") {
        await ok(p, { type: "ramps.trial.start", angleDeg: 20 });
        advance(p, 10_000);
      } else {
        await ok(p, luna);
        await ok(p, estrellas);
      }
      p.dispose();
    }
    expect(sala).toEqual(copia);
    expect(sala.counters).toEqual(copia.counters);
  });

  it("dos demostraciones sobre la misma sala no se mezclan entre sí: cada una tiene su persona, sus pruebas y sus contadores", async () => {
    const sala = aventura("exploration");
    const a = make("sombras", sala);
    const b = make("sombras", sala);
    await ok(a, { type: "shadows.sample", distanceCm: 20 });
    expect(sombras(a).samples).toHaveLength(1);
    expect(sombras(b).samples).toEqual([]);
    expect(a.getParticipant()).not.toBe(b.getParticipant());
    const x = make("rampas", sala);
    const y = make("rampas", sala);
    await ok(x, { type: "ramps.trial.start", angleDeg: 20 });
    await ok(y, { type: "ramps.trial.start", angleDeg: 30 });
    expect([rampas(x).trials[0]!.trialId, rampas(y).trials[0]!.trialId]).toEqual(["t1", "t1"]); // contadores propios
    expect(rampas(x).trials[0]!.angleDeg).toBe(20);
    expect(rampas(y).trials[0]!.angleDeg).toBe(30);
  });
});
