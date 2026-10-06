import type { ActivityConfig } from "../../../shared/contracts/config";
import type { AdventureView } from "../../../shared/contracts/state";

/** Claves de escena y decisión de cuál corresponde a la vista. Sin dependencia de Phaser: se puede probar sin navegador. */
export const LABORATORY_SCENE = "LaboratoryScene";
export const SHADOWS_SCENE = "ShadowsScene";
export const RAMPS_SCENE = "RampsScene";
export const BOXES_SCENE = "BoxesScene";
export const INVENTOR_SCENE = "InventorScene";

export const SCENE_BY_ACTIVITY_TYPE: Record<ActivityConfig["type"], string> = { shadows: SHADOWS_SCENE, ramps: RAMPS_SCENE, boxes: BOXES_SCENE };
export const ALL_SCENES = [LABORATORY_SCENE, SHADOWS_SCENE, RAMPS_SCENE, BOXES_SCENE, INVENTOR_SCENE] as const;

/**
 * Qué escena corresponde a la vista autorizada. La vista `final` es la máquina del inventor, con escena propia (SPECS 10.1 permite
 * que sea una vista del laboratorio; una escena cercana permite ver los tres espacios y la tarjeta). Una mesa desconocida cae en el
 * laboratorio en lugar de dejar un lienzo en blanco.
 */
export function desiredScene(view: AdventureView, activities: Record<string, Pick<ActivityConfig, "type">>): string {
  if (view.kind === "final") return INVENTOR_SCENE;
  if (view.kind !== "activity") return LABORATORY_SCENE;
  const cfg = activities[view.activityId];
  return cfg ? SCENE_BY_ACTIVITY_TYPE[cfg.type] : LABORATORY_SCENE;
}
