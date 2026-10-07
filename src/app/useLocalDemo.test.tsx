// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RampsState, ShadowsState } from "../../shared/contracts/state";
import { createInitialAdventure } from "../../shared/domain/round";
import { bundle } from "../../shared/testing/drive";
import type { LoadedProject } from "../config/loadProject";
import type { LocalPlayer } from "./LocalPlayer";
import { useLocalDemo, type LocalDemo } from "./useLocalDemo";

// La demostración de Vanessa sobre la proyección de una sala real: el jugador local nace al pedirla y se libera al terminarla o al
// desmontar. Bajo StrictMode (desarrollo) los efectos se ejecutan y se deshacen una vez: eso no debe destruir una demostración en uso.

const project = { bundle } as unknown as LoadedProject;
const sala = createInitialAdventure(bundle.map);
const sombras = (d: LocalDemo) => d.participant!.activities.sombras as ShadowsState;

/** ¿El jugador sigue vivo? Uno liberado ya no entrega muestras del reloj, aunque alguien se suscriba después. */
function vivo(p: LocalPlayer): boolean {
  let muestras = 0;
  const baja = p.subscribeClock(() => void muestras++);
  p.tick();
  baja();
  return muestras === 1;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLocalDemo: abrir y cerrar la demostración", () => {
  it("empieza sin demostración: nada activo, sin persona y sin jugador", () => {
    const { result } = renderHook(() => useLocalDemo(project));
    expect(result.current).toMatchObject({ active: false, participant: null, player: null });
  });

  it("`start()` abre la mesa pedida con una persona nueva, y el hook refleja lo que esa persona hace", () => {
    const { result } = renderHook(() => useLocalDemo(project));
    act(() => result.current.start("sombras", sala));
    expect(result.current.active).toBe(true);
    expect(result.current.player!.activityId).toBe("sombras");
    expect(result.current.participant!.view).toEqual({ kind: "activity", activityId: "sombras" });
    expect(sombras(result.current).samples).toEqual([]);
    act(() => void result.current.player!.perform({ type: "shadows.sample", distanceCm: 20 }));
    expect(sombras(result.current).samples).toHaveLength(1);
    act(() => void result.current.player!.perform({ type: "shadows.sample", distanceCm: 50 }));
    expect(sombras(result.current).samples.map((s) => s.distanceCm)).toEqual([20, 50]);
  });

  it("`stop()` cierra la demostración y libera el temporizador del jugador", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLocalDemo(project));
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.start("rampas", sala));
    expect(vi.getTimerCount()).toBe(1);
    const jugador = result.current.player!;
    const muestras = vi.fn();
    jugador.subscribeClock(muestras);
    vi.advanceTimersByTime(200);
    expect(muestras).toHaveBeenCalledTimes(2); // el bucle propio corre mientras está abierta
    act(() => result.current.stop());
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current).toMatchObject({ active: false, participant: null, player: null });
    vi.advanceTimersByTime(1000);
    expect(muestras).toHaveBeenCalledTimes(2);
    expect(vivo(jugador)).toBe(false);
  });

  it("`stop()` sin demostración abierta no hace nada ni falla, y se puede volver a abrir después", () => {
    const { result } = renderHook(() => useLocalDemo(project));
    expect(() => act(() => result.current.stop())).not.toThrow();
    expect(result.current.active).toBe(false);
    act(() => result.current.start("cajas", sala));
    act(() => result.current.stop());
    act(() => result.current.start("cajas", sala));
    expect(result.current.active).toBe(true);
    expect(vivo(result.current.player!)).toBe(true);
    expect(result.current.participant!.activities.cajas).toMatchObject({ inspected: [] }); // una persona nueva, sin lo de la anterior
  });

  it("abrir otra mesa libera el jugador anterior: nunca quedan dos temporizadores", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLocalDemo(project));
    act(() => result.current.start("sombras", sala));
    const primero = result.current.player!;
    act(() => void primero.perform({ type: "shadows.sample", distanceCm: 20 }));
    act(() => result.current.start("rampas", sala));
    const segundo = result.current.player!;
    expect(segundo).not.toBe(primero);
    expect(segundo.activityId).toBe("rampas");
    expect(vi.getTimerCount()).toBe(1);
    expect(vivo(primero)).toBe(false);
    expect(vivo(segundo)).toBe(true);
    expect((result.current.participant!.activities.rampas as RampsState).trials).toEqual([]);
    expect(result.current.participant!.activities.sombras).toMatchObject({ samples: [] }); // no hereda lo de la mesa anterior
  });

  it("`start` y `stop` conservan su identidad entre renderizados (sirven como dependencias de un efecto)", () => {
    const { result, rerender } = renderHook(() => useLocalDemo(project));
    const { start, stop } = result.current;
    act(() => start("sombras", sala));
    rerender();
    expect(result.current.start).toBe(start);
    expect(result.current.stop).toBe(stop);
  });

  it("al desmontar el componente se libera el jugador y su temporizador", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useLocalDemo(project));
    act(() => result.current.start("rampas", sala));
    const jugador = result.current.player!;
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(vivo(jugador)).toBe(false);
  });
});

describe("useLocalDemo bajo StrictMode (desarrollo)", () => {
  it("la demostración iniciada no se destruye: el jugador sigue vivo, con su temporizador, y el estado sigue llegando al hook", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLocalDemo(project), { wrapper: StrictMode });
    act(() => result.current.start("sombras", sala));
    const jugador = result.current.player!;
    expect(result.current.active).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    expect(vivo(jugador)).toBe(true);
    act(() => void jugador.perform({ type: "shadows.sample", distanceCm: 20 }));
    expect(sombras(result.current).samples).toHaveLength(1);
    act(() => result.current.stop());
    expect(vi.getTimerCount()).toBe(0);
    expect(vivo(jugador)).toBe(false);
  });

  it("si `start()` se pide desde un efecto, el desmontaje simulado de StrictMode no deja la demostración muerta", () => {
    vi.useFakeTimers();
    let demo!: LocalDemo;
    function Pantalla() {
      demo = useLocalDemo(project);
      const { start } = demo;
      useEffect(() => start("rampas", sala), [start]);
      return null;
    }
    render(
      <StrictMode>
        <Pantalla />
      </StrictMode>,
    );
    expect(demo.active).toBe(true);
    expect(demo.player!.activityId).toBe("rampas");
    expect(vivo(demo.player!)).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // los jugadores descartados por el doble montaje no dejan temporizadores
    act(() => void demo.player!.perform({ type: "ramps.trial.start", angleDeg: 20 }));
    expect((demo.participant!.activities.rampas as RampsState).trials).toHaveLength(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("al desmontar la pantalla también se libera lo que se abrió", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useLocalDemo(project), { wrapper: StrictMode });
    act(() => result.current.start("cajas", sala));
    const jugador = result.current.player!;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(vivo(jugador)).toBe(false);
  });
});
