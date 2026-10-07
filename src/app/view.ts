import type { ActivityConfig, LaboratorioConfig } from "../../shared/contracts/config";
import type { AdventureState, RoundStage } from "../../shared/contracts/state";
import { currentActivityId } from "../../shared/domain/round";
import type { BridgePermissions } from "../game/bridge/events";
import type { RoomClientState } from "./RoomController";

/**
 * Lo que la interfaz deduce del estado de la sala: qué mesa está habilitada, qué puede hacer esta persona ahora y por qué no.
 * Son funciones puras: el servidor es la autoridad, pero la pantalla da una respuesta inmediata y comprensible.
 */

export interface CurrentActivity {
  id: string;
  config: ActivityConfig;
}

/** La mesa de la ronda actual, o `null` en el cierre. */
export function currentActivity(adv: AdventureState, config: LaboratorioConfig): CurrentActivity | null {
  const id = currentActivityId(adv, config);
  return id ? { id, config: config.activities[id]! } : null;
}

const NOT_PLAYING: Record<string, string> = {
  welcome: "La aventura todavía no comienza.",
  paused: "La aventura está en pausa.",
  finished: "La aventura terminó.",
  closed: "La aventura terminó.",
  expired: "La sala venció por inactividad.",
};

const STAGE_REASON: Record<RoundStage, string | null> = {
  preparation: null,
  exploration: null,
  conversation: "Estamos conversando: mira la proyección.",
  closing: "Estamos en el cierre: mira la proyección.",
};

/**
 * Qué puede hacer esta pantalla: caminar por el laboratorio y explorar la mesa habilitada (propuesta de rondas, sección 4). Solo quien
 * tiene personaje (`me`): una persona que juega y, en la demostración local, Vanessa. La proyección de una sala real y quien acompaña
 * como observadora solo miran.
 */
export function permissionsFor(state: RoomClientState): BridgePermissions {
  const self = state.summary?.self;
  if (!self || self.observer || !state.me) return { canMove: false, canExplore: false, reason: self?.observer ? "Estás como observador." : null };
  if (state.status !== "connected") return { canMove: false, canExplore: false, reason: "Sin conexión con la sala." };
  const phase = state.summary!.phase;
  if (phase !== "running") return { canMove: false, canExplore: false, reason: NOT_PLAYING[phase] ?? null };
  const stage = state.group?.adventure.round.stage;
  if (!stage) return { canMove: false, canExplore: false, reason: "Todavía se está cargando la aventura." };
  const reason = STAGE_REASON[stage];
  if (reason) return { canMove: false, canExplore: false, reason };
  return { canMove: true, canExplore: stage === "exploration", reason: stage === "preparation" ? "Vanessa abrirá la mesa en un momento." : null };
}

/** ¿Está esta persona en la lista de la ronda actual? Quien llegó después acompaña sin contar. */
export function isInRound(adv: AdventureState, principalId: string): boolean {
  const r = adv.round;
  return r.roster.includes(principalId) || r.included.includes(principalId);
}

/** Texto que explica en el celular qué toca ahora, según la fase de la ronda (contenido editable en `ui.labels`). */
export function phoneCaption(state: RoomClientState, config: LaboratorioConfig): string | null {
  const labels = config.ui.labels;
  const phase = state.summary?.phase;
  if (!phase) return null;
  if (phase === "paused") return "La aventura está en pausa.";
  if (phase === "welcome") return labels.welcomePhone ?? null;
  // Quien acompaña no tiene cuaderno propio: no se le dice que revise «sus» resultados.
  if (phase === "finished") return state.summary?.self.observer ? "Terminamos la aventura." : (labels.finishedPhone ?? null);
  const stage = state.group?.adventure.round.stage;
  switch (stage) {
    case "preparation":
      return labels.roundPreparationPhone ?? null;
    case "exploration":
      return labels.roundExplorationPhone ?? null;
    case "conversation":
      return labels.roundConversationPhone ?? null;
    case "closing":
      return labels.closingPhone ?? null;
    default:
      return null;
  }
}
