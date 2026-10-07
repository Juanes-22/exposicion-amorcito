// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectEvent, RoomSnapshot } from "../../../shared/contracts/events";
import { createRoomState } from "../../../shared/domain/room";
import { bundle, Driver } from "../../../shared/testing/drive";
import { SignalText, SoundControl } from "../../components/room/SoundControl";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState } from "../RoomController";
import type { AudioPlayer, AudioStatus } from "./player";
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
    play: vi.fn(() => status === "on"),
    dispose: vi.fn(),
  };
  return p as typeof p & AudioPlayer;
}
const room = (version: number) => ({ ...createRoomState({ roomId: "r", code: "ABC234", config: bundle.config, map: bundle.map, configHash: bundle.configHash, mapHash: bundle.mapHash, nowIso: "2026-10-06T10:00:00.000Z" }), stateVersion: version, adventure: new Driver().state });
const state = (version: number, effects: EffectEvent[] = [], status: RoomClientState["status"] = "connected"): RoomClientState => ({ status, summary: null, presence: null, snapshot: { state: room(version), controller: null, effects } as RoomSnapshot, pending: 0, notice: null });
const earned = (id: string): EffectEvent => ({ effectId: `1:piece.earned:${id}`, kind: "piece.earned", pieceId: "lupa" });

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

  it("una reconexión no repite señales: tras perder la conexión el siguiente snapshot es solo línea de base", () => {
    const player = fakePlayer();
    const { result, rerender } = renderHook(({ s }) => useAudioSignals({ project, state: s, device: "computer", player }), { initialProps: { s: state(1) } });
    rerender({ s: state(2, [earned("a")]) });
    expect(player.play).toHaveBeenCalledTimes(1);
    rerender({ s: state(2, [earned("a")], "reconnecting") });
    rerender({ s: state(9, [earned("a"), earned("x")]) }); // el snapshot de la reconexión
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(result.current.signal?.id).toBe("1:piece.earned:a");
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
