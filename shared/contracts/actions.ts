import type { Point } from "./geometry";
import type { CommandErrorCode } from "./limits";
import type { RecordField } from "./state";

/** Acciones y sobres de comando (SPECS 5.2). No existen acciones libres como setState, grantPiece, setResult u openPersonalBox. */

export type RecordValueInput =
  | { modality: "written"; text: string }
  | { modality: "suggested"; optionId: string }
  | { modality: "oral" }
  | { modality: "uncertain" };

/** Pregunta final del inventor: escrita, sugerida, oral o una pregunta ya guardada en el cuaderno. */
export type FinalQuestionInput =
  | { modality: "written"; text: string }
  | { modality: "suggested"; optionId: string }
  | { modality: "oral" }
  | { modality: "saved"; recordId: string };

export type AdventureAction =
  | { type: "player.moveTo"; target: Point }
  | { type: "station.open"; stationId: string; origin: "map" | "quickNav" }
  | { type: "adventure.returnToMap" }
  | { type: "shadows.surprise.ack" }
  | { type: "shadows.light.set"; distanceCm: number; commitSample: boolean }
  | { type: "record.confirm"; activityId: string; field: RecordField; value: RecordValueInput; objectId?: string }
  | { type: "record.edit"; recordId: string; expectedRevision: number; value: RecordValueInput }
  | { type: "ramps.question.open" }
  | { type: "ramps.angle.set"; angleDeg: number }
  | { type: "ramps.trial.start" }
  | { type: "boxes.shared.open" }
  | { type: "boxes.object.inspect"; objectId: string }
  | { type: "boxes.permission.ask" }
  | { type: "boxes.refusal.ack" }
  | { type: "boxes.refusal.respect" }
  | { type: "experiment.reset" }
  | { type: "inventor.placePieces" }
  | { type: "inventor.question.confirm"; value: FinalQuestionInput };

export type AdminAction =
  | { type: "room.start" }
  | { type: "control.assign"; principalId: string }
  | { type: "control.revoke" }
  | { type: "control.take" }
  | { type: "room.pause" }
  | { type: "room.resume" }
  /** `confirm` refleja el diálogo que explica el efecto (SPECS 2.3). */
  | { type: "room.reset"; confirm: true }
  | { type: "room.close"; confirm: true };

export interface AdventureCommand {
  requestId: string;
  roomGeneration: number;
  turnVersion: number;
  connectionEpoch: number;
  action: AdventureAction;
}

export interface AdminCommand {
  requestId: string;
  roomGeneration: number;
  connectionEpoch: number;
  commandSeq: number;
  action: AdminAction;
}

export type CommandResult =
  | { ok: true; requestId: string; stateVersion: number; turnVersion: number }
  | { ok: false; requestId: string; code: CommandErrorCode; message: string };

export const ADVENTURE_ACTION_TYPES = [
  "player.moveTo",
  "station.open",
  "adventure.returnToMap",
  "shadows.surprise.ack",
  "shadows.light.set",
  "record.confirm",
  "record.edit",
  "ramps.question.open",
  "ramps.angle.set",
  "ramps.trial.start",
  "boxes.shared.open",
  "boxes.object.inspect",
  "boxes.permission.ask",
  "boxes.refusal.ack",
  "boxes.refusal.respect",
  "experiment.reset",
  "inventor.placePieces",
  "inventor.question.confirm",
] as const satisfies readonly AdventureAction["type"][];

export const ADMIN_ACTION_TYPES = [
  "room.start",
  "control.assign",
  "control.revoke",
  "control.take",
  "room.pause",
  "room.resume",
  "room.reset",
  "room.close",
] as const satisfies readonly AdminAction["type"][];
