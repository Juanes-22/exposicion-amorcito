// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelescopeActivityConfig } from "../../shared/contracts/config";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";
import { bundle } from "../../shared/testing/drive";
import { HOUSE_DEMO_HOLD_MS, useHouseDemo } from "./useHouseDemo";

const cfg = bundle.config.activities.cajas as TelescopeActivityConfig;
const cortina = (p: ReturnType<typeof useHouseDemo>["participant"]) => (p?.activities.cajas as { curtain: string } | undefined)?.curtain;

afterEach(() => vi.useRealTimers());

describe("useHouseDemo: la casa en la proyección, con la frase de Freire del observatorio", () => {
  it("apagada no dibuja a nadie; al activarse muestra la ventana de cerca con las siluetas y, pasado un momento, se cierra la cortina", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ id }) => useHouseDemo(id, cfg), { initialProps: { id: null as string | null } });
    expect(result.current).toMatchObject({ active: false, participant: null });
    rerender({ id: "cajas" }); // se mostró la frase de Freire
    expect(result.current.active).toBe(true);
    expect(result.current.participant).toMatchObject({ view: { kind: "activity", activityId: "cajas" } });
    expect(result.current.participant!.activities.cajas).toEqual({ type: "telescope", x: TELESCOPE_TARGETS.window.x, y: TELESCOPE_TARGETS.window.y, zoom: CLOSE_ZOOM, observed: [], curtain: "open" });
    act(() => void vi.advanceTimersByTime(HOUSE_DEMO_HOLD_MS - 1));
    expect(cortina(result.current.participant)).toBe("open");
    act(() => void vi.advanceTimersByTime(1));
    expect(cortina(result.current.participant)).toBe("closed");
    act(() => void vi.advanceTimersByTime(60_000));
    expect(cortina(result.current.participant)).toBe("closed"); // se queda así hasta pasar al inventor
    rerender({ id: null });
    expect(result.current).toMatchObject({ active: false, participant: null });
  });

  it("si la consola se abre (o recarga) con la frase ya mostrada, empieza de nuevo con las siluetas", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHouseDemo("cajas", cfg));
    expect(result.current.active).toBe(true);
    expect(cortina(result.current.participant)).toBe("open");
  });

  it("al volver a activarse empieza otra vez con la cortina abierta", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ id }) => useHouseDemo(id, cfg), { initialProps: { id: "cajas" as string | null } });
    act(() => void vi.advanceTimersByTime(HOUSE_DEMO_HOLD_MS));
    rerender({ id: null });
    rerender({ id: "cajas" });
    expect(cortina(result.current.participant)).toBe("open");
  });
});
