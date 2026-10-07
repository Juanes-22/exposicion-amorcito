// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectEvent, GroupSnapshot, MeSnapshot } from "../../../shared/contracts/events";
import { bundle, Driver } from "../../../shared/testing/drive";
import { SignalText, SoundControl } from "../../components/room/SoundControl";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState } from "../RoomController";
import { createAudioPlayer, createHolder, type AudioPlayer, type AudioStatus } from "./player";
import { loadSoundPreference, saveSoundPreference } from "./preferences";
import { useAudioSignals, type AudioSignals } from "./useAudioSignals";

const project = { bundle, registry: { has: () => true, url: (id: string) => `http://localhost/assets/${id}` } } as unknown as LoadedProject;

/** Un reproductor de mentira: registra qué se le pide y deja controlar si «activar» funciona. */
function fakePlayer(result: AudioStatus = "on") {
  let status: AudioStatus = "off";
  const listeners = new Set<() => void>();
  const set = (s: AudioStatus) => ((status = s), listeners.forEach((l) => l()));
  const p = {
    getStatus: () => status,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    enable: vi.fn(async (_urls: Record<string, string>) => (set(result), status)),
    disable: vi.fn(() => set("off")),
    setVolume: vi.fn(),
    play: vi.fn((_event: string) => status === "on"),
    attach: vi.fn(),
    dispose: vi.fn(),
  };
  return p as typeof p & AudioPlayer;
}
/** Una sala cualquiera: de ella salen la ronda y los participantes que viajan en los estados de la prueba. */
const sala = new Driver(["ana"]);
const group = (version: number, effects: EffectEvent[] = [], generation = 1): GroupSnapshot => ({ roomGeneration: generation, stateVersion: version, roundVersion: 1, phase: sala.room.phase, adventure: sala.room.adventure, effects });
/** Mi estado personal: el de Ana en la sala del Driver que se indique. */
const mine = (d: Driver, version: number, generation = 1): MeSnapshot => ({ roomGeneration: generation, stateVersion: version, participant: d.person("ana") });
/** Lo que el hook lee del controlador: `group` para todas las pantallas y `me` solo para quien juega (un observador no lo tiene). */
const state = (version: number, effects: EffectEvent[] = [], status: RoomClientState["status"] = "connected", me: MeSnapshot | null = null, generation = 1): RoomClientState => ({ status, summary: null, group: group(version, effects, generation), me, characters: {}, presence: null, pending: 0, notice: null });
/** Lo que deja el controlador al perder la conexión: descarta el grupo y lo personal hasta recibirlos de nuevo. */
const sinEstado = (status: RoomClientState["status"]): RoomClientState => ({ status, summary: null, group: null, me: null, characters: {}, presence: null, pending: 0, notice: null });
const earned = (id: string): EffectEvent => ({ effectId: `1:piece:${id}`, kind: "piece.earned", pieceId: "lupa" });

/** Ana en la mesa de Sombras (exploración): `muestra` anota una posición de la linterna. */
function conSombras() {
  const d = new Driver(["ana"]);
  d.toExploration(0);
  d.openStation("ana", "sombras");
  return { d, muestra: (cm: number) => d.must(d.act("ana", { type: "shadows.sample", distanceCm: cm }), `posición ${cm}`) };
}
/** Ana en La caja de las sorpresas: `mirar` selecciona un objeto compartido. */
function conCajas() {
  const d = new Driver(["ana"]);
  d.toExploration(2);
  d.openStation("ana", "cajas");
  return { d, mirar: (id: string) => d.must(d.act("ana", { type: "boxes.object.inspect", objectId: id }), `mirar ${id}`) };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("useAudioSignals (SPECS 10.4)", () => {
  it("el teléfono empieza en silencio aunque la última vez lo hubieran activado, y no pide nada al navegador antes de un gesto", () => {
    saveSoundPreference({ on: true, volume: 0.5 });
    const player = fakePlayer();
    const { result } = renderHook(() => useAudioSignals({ project, state: state(1), device: "phone", player }));
    expect(result.current.status).toBe("off");
    fireEvent.pointerDown(window); // un toque cualquiera en el teléfono NO lo activa solo
    expect(player.enable).not.toHaveBeenCalled();
    expect(result.current.volume).toBe(0.5);
  });

  it("en la computadora proyectada, si estaba activado, el PRIMER gesto lo retoma; sin gesto no hace nada", async () => {
    saveSoundPreference({ on: true, volume: 0.8 });
    const player = fakePlayer();
    renderHook(() => useAudioSignals({ project, state: state(1), device: "computer", player }));
    expect(player.enable).not.toHaveBeenCalled();
    fireEvent.pointerDown(window);
    await waitFor(() => expect(player.enable).toHaveBeenCalledTimes(1));
    fireEvent.pointerDown(window);
    expect(player.enable).toHaveBeenCalledTimes(1); // una sola vez
    expect(Object.keys(player.enable.mock.calls[0]![0]).sort()).toEqual(["adventure.finished", "boxes.bell", "inventor.activated", "piece.earned", "shadows.click"]);
  });

  it("sin preferencia previa nada se activa solo en ninguna pantalla", () => {
    for (const device of ["phone", "computer"] as const) {
      const player = fakePlayer();
      renderHook(() => useAudioSignals({ project, state: state(1), device, player }));
      fireEvent.pointerDown(window);
      expect(player.enable).not.toHaveBeenCalled();
    }
  });

  it("activar y silenciar guardan la preferencia LOCAL; el volumen también", async () => {
    const player = fakePlayer();
    const { result } = renderHook(() => useAudioSignals({ project, state: state(1), device: "computer", player }));
    act(() => result.current.enable());
    await waitFor(() => expect(result.current.status).toBe("on"));
    expect(loadSoundPreference()).toMatchObject({ on: true });
    act(() => result.current.setVolume(0.3));
    expect(player.setVolume).toHaveBeenLastCalledWith(0.3);
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.3 });
    act(() => result.current.disable());
    expect(loadSoundPreference()).toMatchObject({ on: false, volume: 0.3 });
  });

  it("si activar falla, no se recuerda «activado» y el control queda como no disponible", async () => {
    const player = fakePlayer("unavailable");
    const { result } = renderHook(() => useAudioSignals({ project, state: state(1), device: "computer", player }));
    act(() => result.current.enable());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(loadSoundPreference().on).toBe(false);
  });

  it("bajo StrictMode (desarrollo: desmonta y monta con el mismo reproductor) «Activar sonido» sí activa el sonido", async () => {
    const ctx = {
      state: "suspended",
      destination: {},
      createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
      createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: vi.fn() }),
      decodeAudioData: vi.fn(async () => ({})),
      resume: vi.fn(async () => void (ctx.state = "running")),
    };
    const player = createAudioPlayer({ holder: createHolder(), createContext: () => ctx as unknown as AudioContext, fetchBytes: async () => new ArrayBuffer(8) });
    const { result } = renderHook(() => useAudioSignals({ project, state: state(1), device: "computer", player }), { wrapper: StrictMode });
    act(() => result.current.enable());
    await waitFor(() => expect(result.current.status).toBe("on"));
  });

  it("el texto de la señal aparece AUNQUE el sonido esté apagado, y el sonido solo suena si está activado", async () => {
    const player = fakePlayer();
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "computer", player }), { initialProps: { s: state(1) } });
    rerender({ s: state(2, [earned("a")]) });
    expect(result.current.signal?.text).toBe("Pieza conseguida: Lupa.");
    expect(player.play).toHaveBeenCalledWith("piece.earned");
    expect(player.play.mock.results[0]!.value).toBe(false); // apagado: no sonó, pero el texto sí salió
    act(() => result.current.enable());
    await waitFor(() => expect(result.current.status).toBe("on"));
    rerender({ s: state(3, [earned("b")]) });
    expect(player.play.mock.results.at(-1)!.value).toBe(true);
  });

  it("una reconexión no repite señales: tras perder la conexión el siguiente estado es solo línea de base", () => {
    const player = fakePlayer();
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "computer", player }), { initialProps: { s: state(1) } });
    rerender({ s: state(2, [earned("a")]) });
    expect(player.play).toHaveBeenCalledTimes(1);
    rerender({ s: state(2, [earned("a")], "reconnecting") }); // un estado que llega sin conexión vigente no es una transición
    rerender({ s: state(9, [earned("a"), earned("x")]) }); // el estado de la reconexión
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(result.current.signal?.id).toBe("1:piece:a");
    rerender({ s: state(10, [earned("n")]) }); // lo que ocurre ya reconectada sí suena
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(result.current.signal?.id).toBe("1:piece:n");
  });

  it("el controlador descarta el estado al reconectar: los estados nuevos de grupo y personales son solo línea de base, y lo que sigue suena", () => {
    const player = fakePlayer();
    const { d, muestra } = conSombras();
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "phone", player }), { initialProps: { s: state(1, [], "connected", mine(d, 1)) } });
    muestra(20);
    rerender({ s: state(2, [], "connected", mine(d, 2)) });
    expect(player.play).toHaveBeenCalledTimes(1);
    rerender({ s: sinEstado("reconnecting") });
    muestra(50); // mientras estaba desconectada su acción llegó al servidor
    rerender({ s: state(9, [earned("x")], "connected", mine(d, 9)) });
    expect(player.play).toHaveBeenCalledTimes(1); // ni el «clic» perdido ni la pieza de mientras: es la línea de base
    muestra(35);
    rerender({ s: state(10, [earned("n")], "connected", mine(d, 10)) });
    expect(player.play.mock.calls.map(([e]) => e)).toEqual(["shadows.click", "piece.earned", "shadows.click"]); // lo nuevo, de grupo y mío
    expect(result.current.signal).not.toBeNull();
  });

  it("un reinicio de la sala (otra generación) también es línea de base en el hook", () => {
    const player = fakePlayer();
    const { rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "computer", player }), { initialProps: { s: state(1) } });
    rerender({ s: state(50, [{ effectId: "2:piece:lupa", kind: "piece.earned", pieceId: "lupa" }], "connected", null, 2) }); // otra generación: aunque su versión sea mayor y traiga efectos
    expect(player.play).not.toHaveBeenCalled();
    rerender({ s: state(51, [{ effectId: "2:piece:dialogo", kind: "piece.earned", pieceId: "dialogo" }], "connected", null, 2) });
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("mis señales personales suenan por transición: anotar una posición hace «clic» y el primer estado propio solo fija la línea de base", () => {
    const player = fakePlayer();
    const { d, muestra } = conSombras();
    muestra(20); // ya había una posición anotada al abrir el juego
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "phone", player }), { initialProps: { s: state(1, [], "connected", mine(d, 1)) } });
    expect(player.play).not.toHaveBeenCalled();
    expect(result.current.signal).toBeNull();
    muestra(50);
    rerender({ s: state(2, [], "connected", mine(d, 2)) });
    expect(player.play).toHaveBeenCalledWith("shadows.click");
    expect(result.current.signal?.text).toBe("Se anotó la posición de la linterna.");
    rerender({ s: state(3, [], "connected", mine(d, 2)) }); // el mismo estado personal otra vez: no suena de nuevo
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("la campanita suena en el teléfono de quien la mira, una vez por mirada", () => {
    const player = fakePlayer();
    const { d, mirar } = conCajas();
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "phone", player }), { initialProps: { s: state(1, [], "connected", mine(d, 1)) } });
    mirar("lupa");
    rerender({ s: state(2, [], "connected", mine(d, 2)) });
    expect(player.play).not.toHaveBeenCalled();
    mirar("campanita");
    rerender({ s: state(3, [], "connected", mine(d, 3)) });
    expect(player.play).toHaveBeenCalledWith("boxes.bell");
    expect(result.current.signal?.text).toBe("Suena la campanita.");
    rerender({ s: state(4, [], "connected", mine(d, 4)) });
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it("quien acompaña como observadora (sin estado personal) oye las señales de grupo y ninguna personal", () => {
    const player = fakePlayer();
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "phone", player }), { initialProps: { s: state(1) } });
    rerender({ s: state(2, [earned("a")]) });
    expect(player.play.mock.calls).toEqual([["piece.earned"]]);
    expect(result.current.signal?.text).toBe("Pieza conseguida: Lupa.");
  });

  it("bajo StrictMode el estado con el que se abre el juego no suena, aunque traiga efectos y posiciones ya anotadas", () => {
    const player = fakePlayer();
    const { d, muestra } = conSombras();
    muestra(20);
    renderHook(() => useAudioSignals({ project, state: state(5, [earned("a")], "connected", mine(d, 5)), device: "phone", player }), { wrapper: StrictMode });
    expect(player.play).not.toHaveBeenCalled();
  });

  it("el texto de la señal se retira solo", () => {
    vi.useFakeTimers();
    try {
      const player = fakePlayer();
      const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "computer", player }), { initialProps: { s: state(1) } });
      rerender({ s: state(2, [earned("a")]) });
      expect(result.current.signal).not.toBeNull();
      act(() => void vi.advanceTimersByTime(6100));
      expect(result.current.signal).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("al desmontar suelta al reproductor", () => {
    const player = fakePlayer();
    const { unmount } = renderHook(() => useAudioSignals({ project, state: state(1), device: "computer", player }));
    unmount();
    expect(player.dispose).toHaveBeenCalled();
  });
});

describe("controles de sonido y texto de las señales", () => {
  const audio = (over: Partial<AudioSignals> = {}): AudioSignals => ({ status: "off", volume: 0.8, enable: vi.fn(), disable: vi.fn(), setVolume: vi.fn(), signal: null, ...over });

  it("apagado: «Activar sonido»; un toque lo activa. Encendido: «Silenciar» y el volumen", () => {
    const a = audio();
    const { rerender } = render(<SoundControl audio={a} />);
    fireEvent.click(screen.getByRole("button", { name: /Activar sonido/ }));
    expect(a.enable).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Volumen del sonido")).toBeNull();
    const on = audio({ status: "on" });
    rerender(<SoundControl audio={on} />);
    expect(screen.getByRole("button", { name: /Silenciar/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Volumen del sonido"), { target: { value: "0.4" } });
    expect(on.setVolume).toHaveBeenCalledWith(0.4);
    fireEvent.click(screen.getByRole("button", { name: /Silenciar/ }));
    expect(on.disable).toHaveBeenCalledTimes(1);
  });

  it("en el teléfono (compacto) no hay deslizador de volumen", () => {
    render(<SoundControl audio={audio({ status: "on" })} compact />);
    expect(screen.queryByLabelText("Volumen del sonido")).toBeNull();
  });

  it("si el navegador no puede, lo dice, deshabilita el botón y no bloquea nada", () => {
    render(<SoundControl audio={audio({ status: "unavailable" })} />);
    expect((screen.getByRole("button", { name: /Activar sonido/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("La aventura sigue igual");
  });

  it("el texto equivalente de la señal se anuncia en una región viva y se ve", () => {
    const { container, rerender } = render(<SignalText audio={audio()} />);
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("");
    rerender(<SignalText audio={audio({ signal: { id: "x", text: "Suena la campanita." } })} />);
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Suena la campanita.");
    expect(container.querySelector(".signal")?.textContent).toBe("Suena la campanita.");
  });
});
