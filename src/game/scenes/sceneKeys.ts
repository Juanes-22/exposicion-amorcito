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
 * - Cuando la aventura terminó, todas las pantallas ven la máquina del inventor con la pregunta del grupo.
 * - En el cierre el inventor es una mesa más: la proyección (y quien observa) lo ve cuando Vanessa lo abre (antes, el laboratorio,
 *   mientras todas las personas caminan hasta él) y cada persona lo ve al entrar a él.
 * - Una persona ve la mesa que tiene abierta; si no tiene ninguna, el laboratorio compartido.
 * - La proyección ve el laboratorio, salvo durante una demostración de Vanessa (la mesa que demuestra).
 * Una mesa desconocida cae en el laboratorio en lugar de dejar un lienzo en blanco.
 */
export function desiredScene(visual: VisualState, activities: Record<string, Pick<ActivityConfig, "type">>): string {
  // Con la pregunta del grupo impresa (aunque después se pause) la aventura terminó: todas las pantallas ven la máquina.
  if (visual.phase === "finished" || visual.group.inventor.finalQuestionId) return INVENTOR_SCENE;
  // Quien no tiene personaje (la proyección y quien observa) no entra a la máquina: la ve en cuanto se abre.
  if (visual.group.round.stage === "closing" && visual.viewer.kind !== "participant" && visual.group.inventor.open === true) return INVENTOR_SCENE;
  const personal = visual.viewer.kind === "participant" ? visual.viewer.me : visual.viewer.kind === "projection" ? visual.viewer.demo : null;
  if (personal?.view.kind === "inventor") return INVENTOR_SCENE;
  // En el cierre ya no hay mesas abiertas (al pasar al inventor todas las personas vuelven al mapa).
  if (personal?.view.kind !== "activity" || visual.group.round.stage === "closing") return LABORATORY_SCENE;
  const cfg = activities[personal.view.activityId];
  return cfg ? SCENE_BY_ACTIVITY_TYPE[cfg.type] : LABORATORY_SCENE;
}
