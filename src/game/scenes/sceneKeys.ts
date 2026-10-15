import type { ActivityConfig } from "../../../shared/contracts/config";
import type { VisualState } from "../bridge/events";

/** Claves de escena y decisión de cuál corresponde a lo que ve cada audiencia. Sin dependencia de Phaser: se puede probar sin navegador. */
export const LABORATORY_SCENE = "LaboratoryScene";
export const SHADOWS_SCENE = "ShadowsScene";
export const RAMPS_SCENE = "RampsScene";
export const TELESCOPE_SCENE = "TelescopeScene";
export const INVENTOR_SCENE = "InventorScene";

export const SCENE_BY_ACTIVITY_TYPE: Record<ActivityConfig["type"], string> = { shadows: SHADOWS_SCENE, ramps: RAMPS_SCENE, telescope: TELESCOPE_SCENE };
export const ALL_SCENES = [LABORATORY_SCENE, SHADOWS_SCENE, RAMPS_SCENE, TELESCOPE_SCENE, INVENTOR_SCENE] as const;

/**
 * Qué escena corresponde a lo que ve esta audiencia:
 * - En el cierre (y cuando la aventura terminó) todas las pantallas ven la máquina del inventor con sus piezas.
 * - Una persona ve la mesa que tiene abierta; si no tiene ninguna, el laboratorio compartido.
 * - La proyección ve el laboratorio, salvo durante una demostración de Vanessa (la mesa que demuestra).
 * Una mesa desconocida cae en el laboratorio en lugar de dejar un lienzo en blanco.
 */
export function desiredScene(visual: VisualState, activities: Record<string, Pick<ActivityConfig, "type">>): string {
  if (visual.group.round.stage === "closing" || visual.phase === "finished") return INVENTOR_SCENE;
  const personal = visual.viewer.kind === "participant" ? visual.viewer.me : visual.viewer.kind === "projection" ? visual.viewer.demo : null;
  if (personal?.view.kind !== "activity") return LABORATORY_SCENE;
  const cfg = activities[personal.view.activityId];
  return cfg ? SCENE_BY_ACTIVITY_TYPE[cfg.type] : LABORATORY_SCENE;
}
