import type { LaboratorioConfig } from "../../shared/contracts/config";
import type { AdventureState, ParticipantState } from "../../shared/contracts/state";
import { emptyActivityState } from "../../shared/domain/results";
import { currentActivity } from "./view";

/**
 * Lo que la proyección dibuja mientras se explora una mesa: la escena de esa mesa en su estado inicial, como la ve quien la abre (la
 * linterna cerca del objeto, la rampa con la pelota arriba, el cielo por el telescopio). Es una persona ficticia propia de la
 * proyección: no pasa por el servidor, nadie la maneja y no muestra las pruebas de nadie. `null` fuera de la exploración.
 */
export function tableShowcase(adv: AdventureState, config: LaboratorioConfig): ParticipantState | null {
  const current = adv.round.stage === "exploration" ? currentActivity(adv, config) : null;
  if (!current) return null;
  return {
    character: { feet: { x: 0, y: 0 }, facing: "down", plan: null },
    view: { kind: "activity", activityId: current.id },
    activities: { [current.id]: emptyActivityState(current.config) },
  };
}
