// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PARTICIPANT_ACTION_TYPES, type CommandResult, type ParticipantAction } from "../../../shared/contracts/actions";
import type { RampsActivityConfig, ShadowsActivityConfig, TelescopeActivityConfig } from "../../../shared/contracts/config";
import type { RampsState, ShadowsState, TelescopeState } from "../../../shared/contracts/state";
import { describeShadow, formatNumber, rampDurationMs, shadowHeightCm } from "../../../shared/domain/models";
import { readiness } from "../../../shared/domain/results";
import { CLOSE_ZOOM, startView, TELESCOPE_TARGETS } from "../../../shared/domain/telescope";
import type { Driver } from "../../../shared/testing/drive";
import { config, denied, mesaAbierta, OK } from "../../testing/clientState";
import { LightControls } from "./LightControls";
import { PersonalPanel } from "./PersonalPanel";
import { RampsControls } from "./RampsControls";
import { ShadowsControls } from "./ShadowsControls";
import { TelescopeControls } from "./TelescopeControls";
import type { LocalExperiment } from "../../game/bridge/events";
import type { PersonalActions } from "./types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sombras = config.activities.sombras as ShadowsActivityConfig;
const rampas = config.activities.rampas as RampsActivityConfig;
const observatorio = config.activities.cajas as TelescopeActivityConfig;
const exp = sombras.experiment;

/** La persona «ana» con su mesa abierta (0 Sombras, 1 Rampas, 2 El observatorio) en una sala conducida de verdad. */
function conMesa(n: 0 | 1 | 2, listas: string[] = []): Driver {
  const d = mesaAbierta(n, listas);
  d.openStation("ana", ["sombras", "rampas", "cajas"][n]!);
  return d;
}
const ana = (d: Driver) => d.person("ana");
const estado = <T extends "shadows" | "ramps" | "telescope">(d: Driver, id: string, _tipo: T) => d.person("ana").activities[id] as Extract<ShadowsState | RampsState | TelescopeState, { type: T }>;

/** Las acciones personales de una persona llevadas al dominio real: lo que el servidor haría con ellas. */
function alDominio(d: Driver, id = "ana") {
  return vi.fn(async (a: ParticipantAction): Promise<CommandResult> => (d.act(id, a) ? OK : denied("INVALID_STEP", d.lastError!.message)));
}

/** El panel personal de una persona con sus acciones registradas; `ui(d)` lo vuelve a pintar con el estado actual de la sala. */
function panel(d: Driver, over: { busy?: boolean; interactive?: boolean; onClose?: () => void; act?: (a: ParticipantAction) => Promise<CommandResult> } = {}) {
  const act = vi.fn(over.act ?? (async (_a: ParticipantAction) => OK));
  const setLocal = vi.fn();
  const ui = (dd: Driver = d) => <PersonalPanel config={config} adv={dd.room.adventure} participant={ana(dd)} act={act} setLocal={setLocal} busy={over.busy ?? false} interactive={over.interactive ?? true} {...(over.onClose ? { onClose: over.onClose } : {})} />;
  return { act, setLocal, ui };
}

const REMOVIDOS = [/Tengo una pregunta/, /Entendido/, /Colocar las piezas/, /Anotar/, /Tu respuesta/, /Esta idea se compartirá con el grupo/, /Lo diremos en voz alta/, /Todavía no sé/, /Escribir/, /Elegir una idea/];
/** Ninguna pieza de interfaz del modelo anterior: formularios, modalidades de respuesta, «Tengo una pregunta», «Entendido», «Colocar las piezas». */
function sinControlesEliminados(container: HTMLElement) {
  for (const texto of REMOVIDOS) expect(screen.queryByText(texto), String(texto)).toBeNull();
  for (const nombre of REMOVIDOS) expect(screen.queryByRole("button", { name: nombre }), String(nombre)).toBeNull();
  expect(container.querySelector("form, textarea, input[type=text], input[type=radio], select")).toBeNull();
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
}

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre }) as HTMLButtonElement;
const slider = (nombre: string) => screen.getByRole("slider", { name: nombre }) as HTMLInputElement;
const avanzar = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

// ---- el panel personal ---------------------------------------------------------------------------------------------------

describe("PersonalPanel", () => {
  it("con el personaje en el mapa no pinta nada", () => {
    const d = mesaAbierta(0);
    const { container } = render(panel(d).ui());
    expect(container.firstChild).toBeNull();
  });

  it("una mesa que no existe en la configuración tampoco pinta nada", () => {
    const d = conMesa(0);
    const participant = { ...ana(d), view: { kind: "activity" as const, activityId: "inventada" } };
    const { container } = render(<PersonalPanel config={config} adv={d.room.adventure} participant={participant} act={vi.fn()} setLocal={vi.fn()} busy={false} interactive />);
    expect(container.firstChild).toBeNull();
  });

  it("muestra el nombre de la mesa, su objetivo corto y el estado de avance con nombre accesible", () => {
    const d = conMesa(0);
    render(panel(d).ui());
    expect(screen.getByRole("region", { name: "Sombras" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Sombras" })).toBeTruthy();
    expect(screen.getByText(sombras.goal)).toBeTruthy();
    expect(screen.getByText("Explorando · 0 de 2")).toBeTruthy();
    expect(screen.getByText(config.ui.labels.notReadyYou!)).toBeTruthy();
  });

  it("«Volver al mapa» envía la acción personal y se bloquea mientras hay un comando en vuelo", () => {
    const d = conMesa(0);
    const { act: enviar, ui } = panel(d);
    const { unmount } = render(ui());
    fireEvent.click(boton("Volver al mapa"));
    expect(enviar).toHaveBeenCalledWith({ type: "adventure.returnToMap" });
    unmount();
    render(panel(d, { busy: true }).ui());
    expect(boton("Volver al mapa").disabled).toBe(true);
  });

  it("en la demostración de Vanessa no hay «Volver al mapa»: se termina la demostración", () => {
    const d = conMesa(0);
    const onClose = vi.fn();
    const { act: enviar, ui } = panel(d, { onClose });
    render(ui());
    expect(screen.queryByRole("button", { name: "Volver al mapa" })).toBeNull();
    fireEvent.click(boton("Terminar la demostración"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(enviar).not.toHaveBeenCalled();
  });

  describe("el chip «Listo para conversar» sale de `readiness`, no de que alguien lo marque", () => {
    const leer = (d: Driver, id: string) => readiness(ana(d).activities[id], config.activities[id]!);

    it("Sombras: pasa de 0 de 2 a 1 de 2 y a listo con dos posiciones que cuentan", () => {
      const d = conMesa(0);
      const { ui } = panel(d);
      const { rerender } = render(ui());
      expect(leer(d, "sombras")).toEqual({ done: 0, needed: 2, ready: false });
      expect(screen.getByText("Explorando · 0 de 2")).toBeTruthy();
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 20 }), "1");
      rerender(ui(d));
      expect(leer(d, "sombras")).toEqual({ done: 1, needed: 2, ready: false });
      expect(screen.getByText("Explorando · 1 de 2")).toBeTruthy();
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 50 }), "2");
      rerender(ui(d));
      expect(leer(d, "sombras").ready).toBe(true);
      expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
      expect(screen.getByText(config.ui.labels.readyYou!)).toBeTruthy();
      expect(screen.queryByText(config.ui.labels.notReadyYou!)).toBeNull();
    });

    it("Sombras: una posición muy parecida a otra no cuenta para estar lista", () => {
      const d = conMesa(0);
      for (const cm of [20, 22]) d.must(d.act("ana", { type: "shadows.sample", distanceCm: cm }), `posición ${cm}`);
      render(panel(d).ui());
      expect(screen.getByText("Explorando · 1 de 2")).toBeTruthy();
      expect(screen.queryByText("✓ Listo para conversar")).toBeNull();
    });

    it("Rampas: dos pruebas terminadas con inclinaciones distintas dejan lista; con la misma inclinación no", () => {
      const d = conMesa(1);
      const { ui } = panel(d);
      const { rerender } = render(ui());
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "prueba 1");
      d.tick(6000);
      rerender(ui(d));
      expect(screen.getByText("Explorando · 1 de 2")).toBeTruthy();
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "prueba 2, misma inclinación");
      d.tick(6000);
      rerender(ui(d));
      expect(leer(d, "rampas")).toEqual({ done: 1, needed: 2, ready: false });
      expect(screen.queryByText("✓ Listo para conversar")).toBeNull();
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 40 }), "prueba 3");
      d.tick(6000);
      rerender(ui(d));
      expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
    });

    it("Rampas: una prueba que todavía rueda no cuenta", () => {
      const d = conMesa(1);
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "prueba");
      render(panel(d).ui());
      expect(screen.getByText("Explorando · 0 de 2")).toBeTruthy();
    });

    it("El observatorio: la Luna de cerca y el grupo de estrellas; acercarse a la ventana no cuenta", () => {
      const d = conMesa(2);
      const { ui } = panel(d);
      const { rerender } = render(ui());
      expect(screen.getByText("Explorando · 0 de 2")).toBeTruthy();
      const { moon, stars, window: win } = TELESCOPE_TARGETS;
      d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ventana");
      rerender(ui(d));
      expect(screen.getByText("Explorando · 0 de 2")).toBeTruthy();
      d.must(d.act("ana", { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "Luna");
      d.must(d.act("ana", { type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "estrellas");
      rerender(ui(d));
      expect(leer(d, "cajas")).toEqual({ done: 2, needed: 2, ready: true });
      expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
      expect(screen.getByText(observatorio.readyText!)).toBeTruthy(); // el texto propio de la mesa: puede seguir mirando
    });

    it("seguir probando no quita lo ya conseguido", () => {
      const d = conMesa(0, ["ana"]);
      render(panel(d).ui());
      expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 30 }), "una más");
      cleanup();
      render(panel(d).ui());
      expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
    });
  });

  describe("fuera de la exploración los controles se detienen y la pantalla lo explica", () => {
    it("en la conversación manda a mirar la proyección y deshabilita los controles", () => {
      const d = conMesa(0, ["ana", "beto"]);
      d.must(d.admin({ type: "round.converse" }), "conversar");
      render(panel(d, { interactive: false }).ui());
      expect(screen.getByText("Miremos la proyección y compartamos lo que descubrimos.")).toBeTruthy();
      expect(slider("Distancia de la linterna al objeto").disabled).toBe(true);
      expect(boton("Alejar la linterna del objeto").disabled).toBe(true);
      expect(boton("Acercar la linterna al objeto").disabled).toBe(true);
      expect(screen.getByText("✓ Listo para conversar")).toBeTruthy(); // lo conseguido se conserva
    });

    it("con la mesa abierta pero en pausa lo dice con texto", () => {
      const d = conMesa(0);
      render(panel(d, { interactive: false }).ui());
      expect(screen.getByText("La mesa está en pausa.")).toBeTruthy();
    });

    it("con la mesa abierta no aparece ningún aviso de detención", () => {
      render(panel(conMesa(0)).ui());
      expect(screen.queryByText("La mesa está en pausa.")).toBeNull();
      expect(screen.queryByText(/Miremos la proyección/)).toBeNull();
    });
  });

  describe("no existen los elementos del modelo anterior", () => {
    it.each([0, 1, 2] as const)("mesa %i: ni formularios, ni modalidades de respuesta, ni «Tengo una pregunta», «Entendido» o «Colocar las piezas»", (n) => {
      for (const interactive of [true, false]) {
        const { container, unmount } = render(panel(conMesa(n), { interactive }).ui());
        expect(container.querySelector(".personal"), `mesa ${n}`).toBeTruthy(); // hay panel: la ausencia que sigue no es vacía
        sinControlesEliminados(container);
        unmount();
      }
    });

    it("tampoco después de explorar, ya lista la persona", () => {
      const d = conMesa(0, ["ana"]);
      const { container } = render(panel(d).ui());
      expect(container.querySelector(".personal")).toBeTruthy();
      sinControlesEliminados(container);
    });

    it("las únicas acciones personales de las mesas son las del juego: no hay acciones de formularios ni de «anotar»", () => {
      expect([...PARTICIPANT_ACTION_TYPES].sort()).toEqual(["adventure.returnToMap", "player.moveTo", "ramps.trial.start", "shadows.sample", "station.open", "telescope.aim"].sort());
    });
  });
});

// ---- linterna ------------------------------------------------------------------------------------------------------------------

describe("LightControls: la linterna se ajusta en local y la posición se registra al terminar", () => {
  const luz = (over: { initialCm?: number; disabled?: boolean } = {}) => {
    const onMove = vi.fn();
    const onCommit = vi.fn();
    const ui = () => <LightControls experiment={exp} initialCm={over.initialCm ?? exp.sourceDistanceMinCm} disabled={over.disabled ?? false} onMove={onMove} onCommit={onCommit} />;
    return { onMove, onCommit, ui };
  };
  const SLIDER = "Distancia de la linterna al objeto";
  /** El slider crece hacia «más cerca»: su valor es `min + max − distancia`. */
  const alSlider = (cm: number) => String(exp.sourceDistanceMinCm + exp.sourceDistanceMaxCm - cm);

  it("al abrirse enseña la posición inicial en la escena y no registra nada", () => {
    const { onMove, onCommit, ui } = luz({ initialCm: 25 });
    render(ui());
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(25);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("mover el slider actualiza la escena al instante pero NO registra; soltarlo registra la posición una sola vez", () => {
    const { onMove, onCommit, ui } = luz();
    render(ui());
    const s = slider(SLIDER);
    fireEvent.change(s, { target: { value: alSlider(30) } });
    fireEvent.change(s, { target: { value: alSlider(35) } });
    expect(onMove).toHaveBeenLastCalledWith(35);
    expect(onMove).toHaveBeenCalledTimes(3); // inicial + dos movimientos
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(s);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(35);
    fireEvent.pointerUp(s); // soltar de nuevo sin mover no vuelve a registrar
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("tocar el slider sin moverlo no registra nada", () => {
    const { onCommit, ui } = luz();
    render(ui());
    fireEvent.pointerUp(slider(SLIDER));
    fireEvent.blur(slider(SLIDER));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("con teclado el ajuste termina al soltar la tecla, y al salir del control se registra lo pendiente", () => {
    const { onCommit, ui } = luz();
    render(ui());
    const s = slider(SLIDER);
    fireEvent.change(s, { target: { value: alSlider(20) } });
    fireEvent.keyUp(s, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(20);
    fireEvent.change(s, { target: { value: alSlider(40) } });
    fireEvent.blur(s);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(40);
  });

  it("el slider va de «más lejos» (izquierda) a «más cerca» (derecha) y dice la distancia en centímetros", () => {
    const { ui } = luz({ initialCm: 40 });
    const { container } = render(ui());
    const s = slider(SLIDER);
    expect(s.getAttribute("aria-valuetext")).toBe("40 centímetros del objeto");
    expect(s.value).toBe(alSlider(40));
    expect([...container.querySelectorAll(".light-controls__ends span")].map((x) => x.textContent)).toEqual(["Más lejos del objeto", "Más cerca del objeto"]);
    fireEvent.change(s, { target: { value: String(Number(s.value) + 5) } }); // hacia la derecha = más cerca
    expect(s.getAttribute("aria-valuetext")).toBe("35 centímetros del objeto");
  });

  describe("botones −/+ equivalentes", () => {
    it("− aleja y + acerca de uno en uno, y la posición se registra tras una pausa", () => {
      vi.useFakeTimers();
      const { onMove, onCommit, ui } = luz({ initialCm: 30 });
      render(ui());
      fireEvent.click(boton("Alejar la linterna del objeto"));
      expect(onMove).toHaveBeenLastCalledWith(31);
      avanzar(599);
      expect(onCommit).not.toHaveBeenCalled();
      avanzar(1);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(31);
      fireEvent.click(boton("Acercar la linterna al objeto"));
      expect(onMove).toHaveBeenLastCalledWith(30);
      avanzar(600);
      expect(onCommit).toHaveBeenLastCalledWith(30);
    });

    it("varias pulsaciones seguidas son un solo ajuste: la pausa se reinicia con cada una y se registra el valor final", () => {
      vi.useFakeTimers();
      const { onCommit, ui } = luz({ initialCm: 30 });
      render(ui());
      for (let i = 0; i < 3; i++) {
        fireEvent.click(boton("Alejar la linterna del objeto"));
        avanzar(400);
      }
      expect(onCommit).not.toHaveBeenCalled();
      avanzar(200);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(33);
    });

    it("no se sale del rango: en el extremo el botón correspondiente se deshabilita", () => {
      const lejos = luz({ initialCm: exp.sourceDistanceMaxCm });
      const { unmount } = render(lejos.ui());
      expect(boton("Alejar la linterna del objeto").disabled).toBe(true);
      expect(boton("Acercar la linterna al objeto").disabled).toBe(false);
      unmount();
      render(luz({ initialCm: exp.sourceDistanceMinCm }).ui());
      expect(boton("Acercar la linterna al objeto").disabled).toBe(true);
      expect(boton("Alejar la linterna del objeto").disabled).toBe(false);
    });

    it("pulsar un botón y pasar enseguida al slider registra una sola vez, sin esperar la pausa", () => {
      vi.useFakeTimers();
      const { onCommit, ui } = luz({ initialCm: 30 });
      render(ui());
      fireEvent.click(boton("Alejar la linterna del objeto"));
      fireEvent.change(slider(SLIDER), { target: { value: alSlider(45) } });
      fireEvent.pointerUp(slider(SLIDER));
      avanzar(2000);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith(45);
    });

    it("si el panel se cierra a mitad de un ajuste con botones no se envía nada después", () => {
      vi.useFakeTimers();
      const { onCommit, ui } = luz({ initialCm: 30 });
      const { unmount } = render(ui());
      fireEvent.click(boton("Alejar la linterna del objeto"));
      unmount();
      avanzar(2000);
      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  it("deshabilitada (fuera de la exploración) ni el slider ni los botones responden", () => {
    const { ui } = luz({ disabled: true });
    render(ui());
    expect(slider(SLIDER).disabled).toBe(true);
    expect(boton("Alejar la linterna del objeto").disabled).toBe(true);
    expect(boton("Acercar la linterna al objeto").disabled).toBe(true);
  });

  it("no hay botón «Anotar»: no existe una forma de registrar que no sea terminar el ajuste", () => {
    render(luz().ui());
    expect(screen.queryByRole("button", { name: /Anotar/ })).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Alejar la linterna del objeto", "Acercar la linterna al objeto"]);
  });
});

// ---- Sombras -----------------------------------------------------------------------------------------------------------------

describe("ShadowsControls", () => {
  const SLIDER = "Distancia de la linterna al objeto";
  const alSlider = (cm: number) => String(exp.sourceDistanceMinCm + exp.sourceDistanceMaxCm - cm);
  const sombra = (cm: number) => shadowHeightCm(cm, exp.screenDistanceCm, exp.objectHeightCm);
  const anuncio = (c: HTMLElement) => c.querySelector(".experiment__readout .visually-hidden")!.textContent;
  const actions = (over: Partial<PersonalActions> = {}) => ({ act: vi.fn(async (_a: ParticipantAction) => OK), setLocal: vi.fn(), busy: false, interactive: true, config, ...over });
  const vista = (d: Driver, a = actions()) => ({ a, ui: (dd: Driver = d) => <ShadowsControls cfg={sombras} st={estado(dd, "sombras", "shadows")} a={a} /> });

  it("al abrir, la linterna empieza en la distancia mínima y la escena la recibe como ajuste local; no se registra nada", () => {
    const d = conMesa(0);
    const { a, ui } = vista(d);
    render(ui());
    expect(a.setLocal).toHaveBeenCalledWith({ lanternCm: exp.sourceDistanceMinCm });
    expect(a.act).not.toHaveBeenCalled();
  });

  it("al volver a abrirla retoma la última posición registrada", () => {
    const d = conMesa(0);
    for (const cm of [20, 50]) d.must(d.act("ana", { type: "shadows.sample", distanceCm: cm }), `posición ${cm}`);
    const { a, ui } = vista(d);
    render(ui());
    expect(a.setLocal).toHaveBeenCalledWith({ lanternCm: 50 });
    expect(slider(SLIDER).value).toBe(alSlider(50));
  });

  it("el ajuste es local con setLocal({lanternCm}); solo al soltar se envía shadows.sample con la distancia elegida", () => {
    const d = conMesa(0);
    const { a, ui } = vista(d);
    render(ui());
    const s = slider(SLIDER);
    fireEvent.change(s, { target: { value: alSlider(30) } });
    expect(a.setLocal).toHaveBeenLastCalledWith({ lanternCm: 30 });
    fireEvent.change(s, { target: { value: alSlider(42) } });
    expect(a.setLocal).toHaveBeenLastCalledWith({ lanternCm: 42 });
    expect(a.act).not.toHaveBeenCalled();
    fireEvent.pointerUp(s);
    expect(a.act).toHaveBeenCalledTimes(1);
    expect(a.act).toHaveBeenCalledWith({ type: "shadows.sample", distanceCm: 42 });
  });

  it("con los botones −/+ la posición se registra sola tras una pausa", () => {
    vi.useFakeTimers();
    const d = conMesa(0);
    const { a, ui } = vista(d);
    render(ui());
    fireEvent.click(boton("Alejar la linterna del objeto"));
    fireEvent.click(boton("Alejar la linterna del objeto"));
    expect(a.setLocal).toHaveBeenLastCalledWith({ lanternCm: exp.sourceDistanceMinCm + 2 });
    expect(a.act).not.toHaveBeenCalled();
    avanzar(600);
    expect(a.act).toHaveBeenCalledTimes(1);
    expect(a.act).toHaveBeenCalledWith({ type: "shadows.sample", distanceCm: exp.sourceDistanceMinCm + 2 });
  });

  it("fuera de la exploración los controles están deshabilitados y no se registra nada", () => {
    vi.useFakeTimers();
    const d = conMesa(0);
    const { a, ui } = vista(d, actions({ interactive: false }));
    render(ui());
    expect(slider(SLIDER).disabled).toBe(true);
    for (const nombre of ["Alejar la linterna del objeto", "Acercar la linterna al objeto"]) {
      expect(boton(nombre).disabled, nombre).toBe(true);
      fireEvent.click(boton(nombre));
    }
    avanzar(2000);
    expect(a.act).not.toHaveBeenCalled();
    expect(a.setLocal).toHaveBeenCalledTimes(1); // solo la posición inicial
  });

  it("el texto que describe la sombra sale del mismo modelo que el dibujo y se actualiza con la linterna", () => {
    const d = conMesa(0);
    const { ui } = vista(d);
    const { container } = render(ui());
    const visible = () => container.querySelector(".experiment__readout [aria-hidden=true]")!.textContent;
    expect(visible()).toBe(describeShadow(exp.sourceDistanceMinCm, sombra(exp.sourceDistanceMinCm), exp.objectHeightCm));
    fireEvent.change(slider(SLIDER), { target: { value: alSlider(40) } });
    expect(visible()).toBe(describeShadow(40, sombra(40), exp.objectHeightCm));
  });

  it("a los lectores de pantalla se les anuncia el valor solo cuando se estabiliza, no a cada movimiento del slider", () => {
    vi.useFakeTimers();
    const d = conMesa(0);
    const { ui } = vista(d);
    const { container } = render(ui());
    const inicial = describeShadow(exp.sourceDistanceMinCm, sombra(exp.sourceDistanceMinCm), exp.objectHeightCm);
    expect(anuncio(container)).toBe(inicial);
    for (const cm of [20, 30, 40]) {
      fireEvent.change(slider(SLIDER), { target: { value: alSlider(cm) } });
      avanzar(300);
    }
    expect(anuncio(container)).toBe(inicial); // el slider sigue en movimiento: nada nuevo que leer
    avanzar(700);
    expect(anuncio(container)).toBe(describeShadow(40, sombra(40), exp.objectHeightCm));
  });

  describe("posiciones registradas", () => {
    it("lista solo las que cuentan, numeradas, con la distancia y la sombra que produjeron", () => {
      const d = conMesa(0);
      for (const cm of [20, 22, 50]) d.must(d.act("ana", { type: "shadows.sample", distanceCm: cm }), `posición ${cm}`);
      render(vista(d).ui());
      const lista = screen.getByRole("list", { name: "Posiciones registradas" });
      expect(within(lista).getAllByRole("listitem").map((li) => li.textContent)).toEqual([`Posición 1: linterna a 20 cm → sombra de ${formatNumber(sombra(20), 1)} cm`, `Posición 2: linterna a 50 cm → sombra de ${formatNumber(sombra(50), 1)} cm`]);
    });

    it("la ayuda dice cuánto falta, avisa de las muy parecidas y felicita al llegar a dos", () => {
      const d = conMesa(0);
      const { ui } = vista(d);
      const { rerender, container } = render(ui());
      const ayuda = () => container.querySelector("p.hint")!.textContent;
      expect(ayuda()).toBe(`Mueve la linterna y suéltala en otro lugar: hacen falta 2 posiciones separadas al menos 5 cm (llevas 0).`);
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 20 }), "1");
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 22 }), "casi igual");
      rerender(ui(d));
      expect(ayuda()).toContain("(llevas 1)");
      expect(ayuda()).toContain("Una posición era muy parecida a otra y no cuenta.");
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 24 }), "otra casi igual");
      rerender(ui(d));
      expect(ayuda()).toContain("2 posiciones eran muy parecidas a otras y no cuentan.");
      d.must(d.act("ana", { type: "shadows.sample", distanceCm: 50 }), "distinta");
      rerender(ui(d));
      expect(ayuda()).toContain("Ya tienes dos posiciones para comparar: puedes seguir probando.");
    });
  });

  it("de punta a punta: soltar la linterna registra la posición en el dominio, y dos distintas dejan a la persona lista", async () => {
    const d = conMesa(0);
    const { act: enviar, ui } = panel(d, { act: alDominio(d) });
    const { rerender } = render(ui());
    const mover = async (cm: number) => {
      fireEvent.change(slider(SLIDER), { target: { value: alSlider(cm) } });
      fireEvent.pointerUp(slider(SLIDER));
      await waitFor(() => expect(enviar).toHaveBeenLastCalledWith({ type: "shadows.sample", distanceCm: cm }));
      rerender(ui(d));
    };
    await mover(30);
    expect(screen.getByText(`Posición 1: linterna a 30 cm → sombra de ${formatNumber(sombra(30), 1)} cm`)).toBeTruthy();
    expect(screen.getByText("Explorando · 1 de 2")).toBeTruthy();
    await mover(55);
    expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
    expect(estado(d, "sombras", "shadows").samples.map((s) => s.distanceCm)).toEqual([30, 55]);
  });
});

// ---- Rampas ------------------------------------------------------------------------------------------------------------------

describe("RampsControls", () => {
  const e = rampas.experiment;
  const ANGULO = "Inclinación de la rampa";
  const actions = (over: Partial<PersonalActions> = {}) => ({ act: vi.fn(async (_a: ParticipantAction) => OK), setLocal: vi.fn(), busy: false, interactive: true, config, ...over });
  const vista = (d: Driver, a = actions()) => ({ a, ui: (dd: Driver = d) => <RampsControls cfg={rampas} st={estado(dd, "rampas", "ramps")} a={a} /> });

  it("empieza en la inclinación mínima, la dice y la escena la recibe como ajuste local", () => {
    const { a, ui } = vista(conMesa(1));
    render(ui());
    expect(screen.getByText(`${e.minAngleDeg}°`, { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/la pelota recorre 2 m/)).toBeTruthy();
    expect(a.setLocal).toHaveBeenCalledWith({ angleDeg: e.minAngleDeg });
    expect(a.act).not.toHaveBeenCalled();
  });

  it("retoma la inclinación de la última prueba", () => {
    const d = conMesa(1);
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 30 }), "prueba");
    d.tick(8000);
    const { a, ui } = vista(d);
    render(ui());
    expect(a.setLocal).toHaveBeenCalledWith({ angleDeg: 30 });
    expect(screen.getByText("30°", { selector: "strong" })).toBeTruthy();
  });

  it("− y + cambian la inclinación de un paso en un paso solo en local, y el slider dice los grados", () => {
    const { a, ui } = vista(conMesa(1));
    render(ui());
    expect(boton("Bajar la inclinación").disabled).toBe(true); // ya está en el mínimo
    fireEvent.click(boton("Subir la inclinación"));
    expect(a.setLocal).toHaveBeenLastCalledWith({ angleDeg: e.minAngleDeg + e.angleStepDeg });
    expect(slider(ANGULO).getAttribute("aria-valuetext")).toBe("20 grados");
    fireEvent.click(boton("Bajar la inclinación"));
    expect(a.setLocal).toHaveBeenLastCalledWith({ angleDeg: e.minAngleDeg });
    fireEvent.change(slider(ANGULO), { target: { value: "3" } });
    expect(screen.getByText("30°", { selector: "strong" })).toBeTruthy();
    expect(slider(ANGULO).getAttribute("aria-valuetext")).toBe("30 grados");
    expect(a.act).not.toHaveBeenCalled(); // elegir un ángulo no registra nada
  });

  it("no se sale del rango: en la inclinación máxima «Subir» se deshabilita", () => {
    const { ui } = vista(conMesa(1));
    render(ui());
    fireEvent.change(slider(ANGULO), { target: { value: "6" } });
    expect(screen.getByText(`${e.maxAngleDeg}°`, { selector: "strong" })).toBeTruthy();
    expect(boton("Subir la inclinación").disabled).toBe(true);
    expect(boton("Bajar la inclinación").disabled).toBe(false);
  });

  it("«Soltar la pelota» envía ramps.trial.start con el ángulo elegido", () => {
    const { a, ui } = vista(conMesa(1));
    render(ui());
    fireEvent.change(slider(ANGULO), { target: { value: "4" } });
    fireEvent.click(boton("Soltar la pelota"));
    expect(a.act).toHaveBeenCalledTimes(1);
    expect(a.act).toHaveBeenCalledWith({ type: "ramps.trial.start", angleDeg: 35 });
  });

  describe("mientras hay una prueba en marcha", () => {
    const rodando = () => {
      const d = conMesa(1);
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "prueba");
      return d;
    };

    it("se bloquea soltar otra pelota y cambiar la inclinación, y el botón dice por qué", () => {
      const { a, ui } = vista(rodando());
      render(ui());
      const b = boton("La pelota está rodando…");
      expect(b.disabled).toBe(true);
      expect(slider(ANGULO).disabled).toBe(true);
      expect(boton("Bajar la inclinación").disabled).toBe(true);
      expect(boton("Subir la inclinación").disabled).toBe(true);
      fireEvent.click(b);
      expect(a.act).not.toHaveBeenCalled();
      expect(screen.getByText("rodando…")).toBeTruthy();
    });

    it("al terminar la prueba se desbloquea, y el tiempo de la simulación queda en la tabla", () => {
      const d = rodando();
      const { ui } = vista(d);
      const { rerender } = render(ui());
      d.tick(rampDurationMs(20, e.lengthMeters, e.visualTimeScale));
      rerender(ui(d));
      expect(boton("Soltar la pelota").disabled).toBe(false);
      expect(slider(ANGULO).disabled).toBe(false);
      expect(screen.queryByText("rodando…")).toBeNull();
      expect(screen.getByText(`${formatNumber(rampDurationMs(20, e.lengthMeters, e.visualTimeScale) / 1000, 1)} s`)).toBeTruthy();
    });

    it("una prueba cancelada al pasar a la conversación se ve como «cancelada» y no cuenta", () => {
      const d = rodando();
      d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
      render(vista(d).ui());
      expect(screen.getByText("cancelada")).toBeTruthy();
      expect(screen.getByText(/\(llevas 0\)/)).toBeTruthy();
    });
  });

  it("con un comando en vuelo solo se bloquea soltar la pelota", () => {
    const { ui } = vista(conMesa(1), actions({ busy: true }));
    render(ui());
    expect(boton("Soltar la pelota").disabled).toBe(true);
    expect(slider(ANGULO).disabled).toBe(false);
  });

  it("fuera de la exploración todo se detiene", () => {
    const { a, ui } = vista(conMesa(1), actions({ interactive: false }));
    render(ui());
    for (const nombre of ["Soltar la pelota", "Bajar la inclinación", "Subir la inclinación"]) expect(boton(nombre).disabled, nombre).toBe(true);
    expect(slider(ANGULO).disabled).toBe(true);
    fireEvent.click(boton("Soltar la pelota"));
    expect(a.act).not.toHaveBeenCalled();
  });

  it("la tabla de pruebas tiene título accesible, cabeceras y una fila por prueba; el tiempo es el de la simulación", () => {
    const d = conMesa(1);
    for (const angulo of [20, 40]) {
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: angulo }), `prueba ${angulo}`);
      d.tick(8000);
    }
    const { container } = render(vista(d).ui());
    const tabla = screen.getByRole("table", { name: "Tus pruebas de la rampa" });
    expect(within(tabla).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Prueba", "Inclinación", "Tiempo de la simulación"]);
    const filas = within(tabla).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(2);
    expect(filas[0]!.textContent).toContain("20°");
    expect(filas[1]!.textContent).toContain("40°");
    expect(container.textContent).toContain("El tiempo es el de la simulación, no una medición real.");
  });

  it("sin pruebas no hay tabla; la ayuda dice cuántas hacen falta y, con dos comparables, que ya se puede comparar", () => {
    const d = conMesa(1);
    const { ui } = vista(d);
    const { rerender, container } = render(ui());
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector("p.hint")!.textContent).toContain("Para comparar hacen falta 2 pruebas terminadas con inclinaciones que se diferencien al menos 5° (llevas 0).");
    for (const angulo of [20, 40]) {
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: angulo }), `prueba ${angulo}`);
      d.tick(8000);
    }
    rerender(ui(d));
    expect(container.querySelector("p.hint")!.textContent).toContain("Ya tienes pruebas que se pueden comparar: puedes seguir probando.");
  });

  it("de punta a punta: soltar la pelota arranca una prueba en el dominio y, al terminar, queda registrada con su ángulo y tiempo", async () => {
    const d = conMesa(1);
    const { act: enviar, ui } = panel(d, { act: alDominio(d) });
    const { rerender } = render(ui());
    fireEvent.change(slider(ANGULO), { target: { value: "5" } }); // 40°
    fireEvent.click(boton("Soltar la pelota"));
    await waitFor(() => expect(enviar).toHaveBeenCalledWith({ type: "ramps.trial.start", angleDeg: 40 }));
    rerender(ui(d));
    expect(boton("La pelota está rodando…").disabled).toBe(true);
    d.tick(10_000);
    rerender(ui(d));
    expect(boton("Soltar la pelota").disabled).toBe(false);
    const t = estado(d, "rampas", "ramps").trials;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ angleDeg: 40, state: "finished", durationMs: rampDurationMs(40, e.lengthMeters, e.visualTimeScale) });
  });
});

// ---- El observatorio ----------------------------------------------------------------------------------------------------------

describe("TelescopeControls", () => {
  const { moon, stars, window: win } = TELESCOPE_TARGETS;
  const e = observatorio.experiment;
  /** Acciones de la mesa con `onLocal`: `arrastrar` simula lo que la escena avisa cuando la persona arrastra el visor. */
  const actions = (over: { act?: (a: ParticipantAction) => Promise<CommandResult>; interactive?: boolean } = {}) => {
    let listener: ((l: LocalExperiment) => void) | null = null;
    const enviar = vi.fn(over.act ?? (async (_a: ParticipantAction) => OK));
    const setLocal = vi.fn();
    const a: PersonalActions = {
      act: enviar,
      setLocal,
      onLocal: (fn) => ((listener = fn), () => (listener = null)),
      busy: false,
      interactive: over.interactive ?? true,
      config,
    };
    const arrastrar = (x: number, y: number, zoom: number) => act(() => listener!({ lanternCm: null, angleDeg: null, telescope: { x, y, zoom } }));
    return { a: { ...a, act: enviar, setLocal }, arrastrar };
  };
  const vista = (d: Driver, acc = actions()) => ({ ...acc, ui: (dd: Driver = d) => <TelescopeControls cfg={observatorio} st={estado(dd, "cajas", "telescope")} a={acc.a} /> });
  /** Lo que se ve, escrito (la versión visible; la anunciada espera a que la vista se asiente). */
  const descripcion = (container: HTMLElement) => container.querySelector(".experiment__readout [aria-hidden=true]")!.textContent!;
  const pasar = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("empieza en el cielo con el aumento general, lo describe con palabras y le pasa la vista a la escena", () => {
    vi.useFakeTimers();
    const { a, ui } = vista(conMesa(2));
    const { container, unmount } = render(ui());
    expect(descripcion(container)).toBe("Aumento general. La Luna está a la vista. Abajo se ven los tejados de unas casas.");
    expect(within(screen.getByRole("list", { name: "Observaciones del cielo" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Luna: acércala y céntrala", "Grupo de estrellas: búscalo y céntralo"]);
    expect(a.setLocal).toHaveBeenCalledWith({ telescope: startView(e) });
    pasar(5000);
    expect(a.act).not.toHaveBeenCalled(); // sin moverse no hay nada que enviar
    unmount();
    expect(a.setLocal).toHaveBeenLastCalledWith({ telescope: null }); // al salir la escena deja de usar la vista local
  });

  it("moverse es local; al quedarse quieta con la Luna de cerca centrada, se envía telescope.aim tras la pausa de observación", () => {
    vi.useFakeTimers();
    const { a, ui } = vista(conMesa(2));
    const { container } = render(ui());
    fireEvent.click(boton("Luna"));
    pasar(e.dwellMs);
    expect(a.act).not.toHaveBeenCalled(); // centrada con el aumento general no es una observación de la Luna
    fireEvent.click(boton("Acercar la vista: aumento cercano"));
    expect(descripcion(container)).toBe("Aumento cercano. La Luna de cerca: zonas claras y oscuras y algunos cráteres.");
    expect(a.setLocal).toHaveBeenLastCalledWith({ telescope: { x: moon.x, y: moon.y, zoom: CLOSE_ZOOM } });
    pasar(e.dwellMs - 1);
    expect(a.act).not.toHaveBeenCalled();
    pasar(1);
    expect(a.act.mock.calls).toEqual([[{ type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }]]);
  });

  it("las flechas recorren el panorama; sin observar nada, la vista quieta se guarda un poco después", () => {
    vi.useFakeTimers();
    const { a, ui } = vista(conMesa(2));
    render(ui());
    fireEvent.click(boton("Mirar más abajo"));
    fireEvent.click(boton("Mirar más abajo"));
    fireEvent.click(boton("Mirar a la derecha"));
    const [{ telescope: v }] = a.setLocal.mock.lastCall as [{ telescope: { x: number; y: number; zoom: number } }];
    expect(v.y).toBeGreaterThan(startView(e).y);
    expect(v.x).toBeGreaterThan(startView(e).x);
    pasar(e.dwellMs);
    expect(a.act).not.toHaveBeenCalled();
    pasar(2000);
    expect(a.act.mock.calls).toEqual([[{ type: "telescope.aim", ...v }]]);
  });

  it("zonas accesibles: Luna, Estrellas, Horizonte y Volver al cielo; ninguna lleva a la ventana ni se llama «Espiar»", () => {
    vi.useFakeTimers();
    const { ui } = vista(conMesa(2));
    const { container } = render(ui());
    const zonas = within(screen.getByRole("group", { name: "Ir a una zona del panorama" })).getAllByRole("button").map((b) => b.textContent);
    expect(zonas).toEqual(["Luna", "Estrellas", "Horizonte", "Volver al cielo"]);
    expect(screen.queryByRole("button", { name: /espiar|casa|ventana/i })).toBeNull();
    fireEvent.click(boton("Horizonte"));
    expect(descripcion(container)).toContain("Abajo se ven los tejados de unas casas.");
    expect(descripcion(container)).toContain("Ventana iluminada; dos siluetas gesticulan como si discutieran.");
    fireEvent.click(boton("Estrellas"));
    expect(descripcion(container)).toContain("Un grupo de estrellas brillantes, muy juntas.");
    fireEvent.click(boton("Volver al cielo"));
    expect(descripcion(container)).toBe("Aumento general. La Luna está a la vista. Abajo se ven los tejados de unas casas.");
  });

  it("la ventana de cerca: tras la pausa se envía; «Una persona cierra la cortina» se dice una vez y después queda cerrada", async () => {
    vi.useFakeTimers();
    const d = conMesa(2);
    const acc = actions({ act: alDominio(d) });
    const { ui, arrastrar } = vista(d, acc);
    const { container, rerender } = render(ui());
    arrastrar(win.x, win.y, CLOSE_ZOOM); // la persona arrastró el visor hasta la ventana
    expect(descripcion(container)).toContain("Ventana iluminada; dos siluetas gesticulan como si discutieran.");
    pasar(e.curtainDelayMs);
    expect(acc.a.act).toHaveBeenCalledWith({ type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM });
    expect(estado(d, "cajas", "telescope").curtain).toBe("closed");
    rerender(ui(d));
    expect(descripcion(container)).toContain("Una persona cierra la cortina.");
    pasar(4000);
    expect(descripcion(container)).toContain("La ventana tiene la cortina cerrada.");
    vi.mocked(acc.a.act).mockClear();
    fireEvent.click(boton("Volver al cielo")); // sigue disponible después
    arrastrar(win.x, win.y, CLOSE_ZOOM);
    pasar(e.curtainDelayMs);
    expect(acc.a.act).not.toHaveBeenCalled(); // ya está cerrada: no se repite nada
  });

  it("al reabrir la mesa parte de la vista y la cortina que guardó el servidor", () => {
    vi.useFakeTimers();
    const d = conMesa(2);
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ventana");
    const { a, ui } = vista(d);
    const { container } = render(ui());
    expect(a.setLocal).toHaveBeenCalledWith({ telescope: { x: win.x, y: win.y, zoom: CLOSE_ZOOM } });
    expect(descripcion(container)).toBe("Aumento cercano. Abajo se ven los tejados de unas casas. La ventana tiene la cortina cerrada.");
    expect(screen.queryByText(/cierra la cortina/)).toBeNull(); // la cortina ya estaba cerrada: no se vuelve a anunciar
  });

  it("fuera de la exploración los controles se detienen y no se envía nada", () => {
    vi.useFakeTimers();
    const { a, ui } = vista(conMesa(2), actions({ interactive: false }));
    render(ui());
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled, b.textContent!).toBe(true);
    pasar(5000);
    expect(a.act).not.toHaveBeenCalled();
  });

  it("de punta a punta: la Luna de cerca y el grupo de estrellas, con los controles, dejan lista a la persona", async () => {
    vi.useFakeTimers();
    const d = conMesa(2);
    const { act: enviar, ui } = panel(d, { act: alDominio(d) });
    const { rerender } = render(ui());
    fireEvent.click(boton("Estrellas"));
    pasar(e.dwellMs);
    expect(enviar).toHaveBeenCalledWith({ type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 });
    rerender(ui(d));
    expect(screen.getByText("✓ Estrellas observadas")).toBeTruthy();
    fireEvent.click(boton("Luna"));
    fireEvent.click(boton("Acercar la vista: aumento cercano"));
    pasar(e.dwellMs);
    rerender(ui(d));
    expect(screen.getByText("✓ Luna observada")).toBeTruthy();
    expect(screen.getByText("✓ Listo para conversar")).toBeTruthy();
    expect(estado(d, "cajas", "telescope")).toMatchObject({ observed: ["stars", "moon"], curtain: "open" });
  });
});
