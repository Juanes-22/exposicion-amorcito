import type { Point } from "./geometry";
import type { CommandErrorCode } from "./limits";

/**
 * Acciones y sobres de comando. Hay dos tipos: las de cada participante sobre su propio personaje y sus propias pruebas, y las de
 * Vanessa sobre la sala y la ronda. No existen acciones libres como setState, grantPiece, setResult u openPersonalBox: el servidor
 * deriva la finalización, las piezas y los resultados.
 */

/** Acciones personales: cada persona actúa solo sobre su estado. Durante la exploración de la mesa habilitada, todas a la vez. */
export type ParticipantAction =
  | { type: "player.moveTo"; target: Point }
  | { type: "station.open"; stationId: string; origin: "map" | "quickNav" }
  | { type: "adventure.returnToMap" }
  /** Termina un ajuste de la linterna: el juego registra la posición y su sombra. */
  | { type: "shadows.sample"; distanceCm: number }
  /** Suelta la pelota con la inclinación elegida; el resultado (ángulo y tiempo) se registra solo al terminar. */
  | { type: "ramps.trial.start"; angleDeg: number }
  | { type: "boxes.object.inspect"; objectId: string }
  | { type: "boxes.permission.ask" };

/** Pregunta final del inventor: la escribe Vanessa o elige una pregunta que el grupo ya guardó. */
export type FinalQuestionInput = { kind: "written"; text: string } | { kind: "saved"; noteId: string };

/** Notas que Vanessa decide guardar en el cuaderno común (las comparaciones se guardan al seleccionarlas). */
export type SavableNoteKind = "initialIdea" | "synthesis" | "question";

export type AdminAction =
  | { type: "room.start" }
  | { type: "room.pause" }
  | { type: "room.resume" }
  /** `confirm` refleja el diálogo que explica el efecto. */
  | { type: "room.reset"; confirm: true }
  | { type: "room.close"; confirm: true }
  /** Preparación → exploración: se fija la lista de participantes de la ronda. */
  | { type: "round.open" }
  /** Exploración → conversación. Con pendientes hace falta `withPending`: se conserva su trabajo parcial y no se les concede finalización. */
  | { type: "round.converse"; withPending?: boolean }
  | { type: "round.showFreire" }
  /** Conversación → siguiente mesa (o cierre). Incorpora la pieza de la mesa que termina. */
  | { type: "round.next" }
  /** Incluye en la ronda actual a una persona que llegó después de abrirla. */
  | { type: "round.include"; principalId: string }
  /** Proyecta los resultados de una persona en la mesa actual y los conserva en el cuaderno común. */
  | { type: "present.select"; principalId: string }
  | { type: "present.clear" }
  | { type: "note.save"; activityId: string; kind: SavableNoteKind; text: string }
  | { type: "note.edit"; noteId: string; expectedRevision: number; text: string }
  | { type: "final.confirm"; value: FinalQuestionInput }
  /** Corrige un error de escritura de la pregunta final ya confirmada. */
  | { type: "final.correct"; expectedRevision: number; text: string };

export interface ParticipantCommand {
  requestId: string;
  roomGeneration: number;
  /** Ronda que la persona ve: una acción de una ronda ya cerrada se rechaza (STALE_ROUND). */
  roundVersion: number;
  connectionEpoch: number;
  action: ParticipantAction;
}

export interface AdminCommand {
  requestId: string;
  roomGeneration: number;
  connectionEpoch: number;
  commandSeq: number;
  action: AdminAction;
}

export type CommandResult =
  | { ok: true; requestId: string; stateVersion: number; roundVersion: number }
  | { ok: false; requestId: string; code: CommandErrorCode; message: string };

export const PARTICIPANT_ACTION_TYPES = [
  "player.moveTo",
  "station.open",
  "adventure.returnToMap",
  "shadows.sample",
  "ramps.trial.start",
  "boxes.object.inspect",
  "boxes.permission.ask",
] as const satisfies readonly ParticipantAction["type"][];

export const ADMIN_ACTION_TYPES = [
  "room.start",
  "room.pause",
  "room.resume",
  "room.reset",
  "room.close",
  "round.open",
  "round.converse",
  "round.showFreire",
  "round.next",
  "round.include",
  "present.select",
  "present.clear",
  "note.save",
  "note.edit",
  "final.confirm",
  "final.correct",
] as const satisfies readonly AdminAction["type"][];
