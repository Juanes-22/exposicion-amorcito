import { useEffect, useMemo, useState } from "react";
import type { TelescopeActivityConfig } from "../../shared/contracts/config";
import type { ParticipantState } from "../../shared/contracts/state";
import { clampView, CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";

/** Cuánto se ven las siluetas antes de que una se gire y cierre la cortina en la demostración (ms). */
export const HOUSE_DEMO_HOLD_MS = 3000;

export interface HouseDemo {
  active: boolean;
  /** Estado de una persona ficticia que mira la ventana de cerca: lo dibuja la proyección. `null` si no está activa. */
  participant: ParticipantState | null;
  start(): void;
  stop(): void;
}

/**
 * La demostración de Vanessa en el observatorio (SPECS 3.4): en la conversación, la proyección muestra la ventana de cerca, las dos
 * siluetas discutiendo con gestos y, a los pocos segundos, cómo una se gira y cierra la cortina. Es un estado propio de la proyección:
 * no pasa por el servidor, no cuenta para nadie y no se puede explorar. `activityId` nulo (otra mesa u otra fase) la apaga.
 */
export function useHouseDemo(activityId: string | null, cfg: TelescopeActivityConfig | null, holdMs = HOUSE_DEMO_HOLD_MS): HouseDemo {
  const [phase, setPhase] = useState<"off" | "open" | "closed">("off");

  useEffect(() => {
    if (!activityId) setPhase("off");
  }, [activityId]);
  useEffect(() => {
    if (phase !== "open") return;
    const t = setTimeout(() => setPhase("closed"), holdMs);
    return () => clearTimeout(t);
  }, [phase, holdMs]);

  const participant = useMemo<ParticipantState | null>(() => {
    if (phase === "off" || !activityId || !cfg) return null;
    const view = clampView({ x: TELESCOPE_TARGETS.window.x, y: TELESCOPE_TARGETS.window.y, zoom: CLOSE_ZOOM }, cfg.experiment);
    return {
      character: { feet: { x: 0, y: 0 }, facing: "down", plan: null },
      view: { kind: "activity", activityId },
      activities: { [activityId]: { type: "telescope", ...view, observed: [], curtain: phase === "closed" ? "closed" : "open" } },
    };
  }, [phase, activityId, cfg]);

  return { active: phase !== "off" && activityId !== null, participant, start: () => setPhase("open"), stop: () => setPhase("off") };
}
