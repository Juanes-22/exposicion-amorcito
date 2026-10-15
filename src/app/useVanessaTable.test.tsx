// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RampsActivityConfig } from "../../shared/contracts/config";
import type { AdventureState } from "../../shared/contracts/state";
import { rampDurationMs } from "../../shared/domain/models";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";
import { bundle } from "../../shared/testing/drive";
import { enEtapa, mesaAbierta } from "../testing/clientState";
import { useVanessaTable } from "./useVanessaTable";

const montar = (adv: AdventureState) => renderHook(({ a }) => useVanessaTable(a, bundle), { initialProps: { a: adv } });

describe("Vanessa explora la mesa abierta en la proyección", () => {
  it("fuera de la exploración no hay mesa que probar", () => {
    for (const etapa of ["welcome", "preparation", "conversation", "closing"] as const) {
      const { result } = montar(enEtapa(etapa).room.adventure);
      expect(result.current.participant, etapa).toBeNull();
      expect(result.current.act({ type: "shadows.sample", distanceCm: 20 }, 0).ok, etapa).toBe(false);
    }
  });

  it("en Sombras registra sus posiciones con las reglas del juego, sin tocar la sala ni el contador", () => {
    const d = mesaAbierta(0);
    const antes = JSON.stringify(d.room);
    const { result } = montar(d.room.adventure);
    expect(result.current.participant!.view).toEqual({ kind: "activity", activityId: "sombras" });
    act(() => void result.current.act({ type: "shadows.sample", distanceCm: 20 }, 1000));
    act(() => void result.current.act({ type: "shadows.sample", distanceCm: 50 }, 2000));
    const st = result.current.participant!.activities.sombras!;
    expect(st.type === "shadows" && st.samples.map((s) => [s.distanceCm, s.counts])).toEqual([[20, true], [50, true]]);
    expect(JSON.stringify(d.room)).toBe(antes); // la sala no cambia: es un experimento local de la consola
    expect(result.current.act({ type: "shadows.sample", distanceCm: 500 }, 3000)).toMatchObject({ ok: false }); // mismas validaciones
  });

  it("en Rampas la pelota rueda con el reloj de la sala y la prueba termina al llegar abajo", () => {
    const { result } = montar(mesaAbierta(1).room.adventure);
    act(() => void result.current.act({ type: "ramps.trial.start", angleDeg: 20 }, 10_000));
    const ramps = () => result.current.participant!.activities.rampas as { trials: Array<{ state: string }> };
    expect(ramps().trials.map((t) => t.state)).toEqual(["running"]);
    expect(result.current.act({ type: "ramps.trial.start", angleDeg: 25 }, 10_100)).toMatchObject({ ok: false }); // espera a que termine
    const e = (bundle.config.activities.rampas as RampsActivityConfig).experiment;
    const fin = 10_000 + rampDurationMs(20, e.lengthMeters, e.visualTimeScale);
    act(() => result.current.settle(fin - 50));
    expect(ramps().trials.map((t) => t.state)).toEqual(["running"]);
    act(() => result.current.settle(fin + 50));
    expect(ramps().trials.map((t) => t.state)).toEqual(["finished"]);
  });

  it("en El observatorio registra la Luna con aumento; no camina ni entra al inventor", () => {
    const { result } = montar(mesaAbierta(2).room.adventure);
    const { moon } = TELESCOPE_TARGETS;
    act(() => void result.current.act({ type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }, 1000));
    expect((result.current.participant!.activities.cajas as { observed: string[] }).observed).toEqual(["moon"]);
    expect(result.current.act({ type: "player.moveTo", target: { x: 600, y: 450 } }, 1000)).toMatchObject({ ok: false });
    expect(result.current.act({ type: "adventure.returnToMap" }, 1000)).toMatchObject({ ok: false });
  });

  it("al conversar desaparece, y la mesa siguiente empieza desde su estado inicial", () => {
    const d = mesaAbierta(0);
    const { result, rerender } = montar(d.room.adventure);
    act(() => void result.current.act({ type: "shadows.sample", distanceCm: 20 }, 1000));
    d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    rerender({ a: d.room.adventure });
    expect(result.current.participant).toBeNull();
    d.must(d.admin({ type: "round.next" }), "siguiente");
    d.must(d.admin({ type: "round.open" }), "abrir rampas");
    rerender({ a: d.room.adventure });
    expect(result.current.participant!.view).toEqual({ kind: "activity", activityId: "rampas" });
    expect(Object.keys(result.current.participant!.activities)).toEqual(["rampas"]);
  });
});
