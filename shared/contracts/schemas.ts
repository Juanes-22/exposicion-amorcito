import { ajvIssues, compileSchema } from "../config/ajv";
import type { AdminCommand, ParticipantCommand } from "./actions";
import type { ConfigIssue } from "./assets";
import type { CreateRoomRequest, JoinRoomRequest } from "./events";
import { MAX_REQUEST_ID_LENGTH, NAME_MAX_CHARS, TEXT_MAX_UTF16_FACTOR } from "./limits";

/**
 * Esquemas de los mensajes públicos. Comprueban forma y tipos; los límites de dominio (rangos, pasos, referencias,
 * conteo de caracteres Unicode) se vuelven a comprobar en el servidor (SPECS 9.5). Los tipos de `actions.ts` y estos
 * esquemas se contrastan en `schemas.test.ts`.
 */

const requestId = { type: "string", minLength: 1, maxLength: MAX_REQUEST_ID_LENGTH, pattern: "^[A-Za-z0-9_-]+$" };
const id = { type: "string", minLength: 1, maxLength: 64 };
const finite = { type: "number" };
const int = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const text = { type: "string", maxLength: 280 * TEXT_MAX_UTF16_FACTOR };
const point = { type: "object", required: ["x", "y"], additionalProperties: false, properties: { x: finite, y: finite } };

const bare = (type: string) => ({ type: "object", required: ["type"], additionalProperties: false, properties: { type: { const: type } } });

const participantAction = {
  type: "object",
  oneOf: [
    { type: "object", required: ["type", "target"], additionalProperties: false, properties: { type: { const: "player.moveTo" }, target: point } },
    {
      type: "object",
      required: ["type", "stationId", "origin"],
      additionalProperties: false,
      properties: { type: { const: "station.open" }, stationId: id, origin: { enum: ["map", "quickNav"] } },
    },
    bare("adventure.returnToMap"),
    { type: "object", required: ["type", "distanceCm"], additionalProperties: false, properties: { type: { const: "shadows.sample" }, distanceCm: finite } },
    { type: "object", required: ["type", "angleDeg"], additionalProperties: false, properties: { type: { const: "ramps.trial.start" }, angleDeg: finite } },
    { type: "object", required: ["type", "objectId"], additionalProperties: false, properties: { type: { const: "boxes.object.inspect" }, objectId: id } },
    bare("boxes.permission.ask"),
  ],
  discriminator: { propertyName: "type" },
};

const finalQuestionValue = {
  type: "object",
  oneOf: [
    { type: "object", required: ["kind", "text"], additionalProperties: false, properties: { kind: { const: "written" }, text } },
    { type: "object", required: ["kind", "noteId"], additionalProperties: false, properties: { kind: { const: "saved" }, noteId: id } },
  ],
  discriminator: { propertyName: "kind" },
};

const adminAction = {
  type: "object",
  oneOf: [
    bare("room.start"),
    bare("room.pause"),
    bare("room.resume"),
    { type: "object", required: ["type", "confirm"], additionalProperties: false, properties: { type: { const: "room.reset" }, confirm: { const: true } } },
    { type: "object", required: ["type", "confirm"], additionalProperties: false, properties: { type: { const: "room.close" }, confirm: { const: true } } },
    bare("round.open"),
    { type: "object", required: ["type"], additionalProperties: false, properties: { type: { const: "round.converse" }, withPending: { type: "boolean" } } },
    bare("round.showFreire"),
    bare("round.next"),
    { type: "object", required: ["type", "principalId"], additionalProperties: false, properties: { type: { const: "round.include" }, principalId: id } },
    { type: "object", required: ["type", "principalId"], additionalProperties: false, properties: { type: { const: "present.select" }, principalId: id } },
    bare("present.clear"),
    {
      type: "object",
      required: ["type", "activityId", "kind", "text"],
      additionalProperties: false,
      properties: { type: { const: "note.save" }, activityId: id, kind: { enum: ["initialIdea", "synthesis", "question"] }, text },
    },
    {
      type: "object",
      required: ["type", "noteId", "expectedRevision", "text"],
      additionalProperties: false,
      properties: { type: { const: "note.edit" }, noteId: id, expectedRevision: int, text },
    },
    { type: "object", required: ["type", "value"], additionalProperties: false, properties: { type: { const: "final.confirm" }, value: finalQuestionValue } },
    {
      type: "object",
      required: ["type", "expectedRevision", "text"],
      additionalProperties: false,
      properties: { type: { const: "final.correct" }, expectedRevision: int, text },
    },
  ],
  discriminator: { propertyName: "type" },
};

const participantCommandSchema = {
  type: "object",
  required: ["requestId", "roomGeneration", "roundVersion", "connectionEpoch", "action"],
  additionalProperties: false,
  properties: { requestId, roomGeneration: int, roundVersion: int, connectionEpoch: int, action: participantAction },
};

const adminCommandSchema = {
  type: "object",
  required: ["requestId", "roomGeneration", "connectionEpoch", "commandSeq", "action"],
  additionalProperties: false,
  properties: { requestId, roomGeneration: int, connectionEpoch: int, commandSeq: int, action: adminAction },
};

const createRoomSchema = {
  type: "object",
  required: ["contentSetId"],
  additionalProperties: false,
  properties: { contentSetId: { type: "string", minLength: 1, maxLength: 80 } },
};

const joinRoomSchema = {
  type: "object",
  required: ["name", "color"],
  additionalProperties: false,
  // El conteo de caracteres Unicode lo hace el servidor; aquí solo se acota el tamaño bruto (SPECS 5.1).
  properties: { name: { type: "string", minLength: 1, maxLength: NAME_MAX_CHARS * TEXT_MAX_UTF16_FACTOR }, color: { type: "string", minLength: 1, maxLength: 32 }, observer: { type: "boolean" } },
};

const vParticipant = compileSchema<ParticipantCommand>(participantCommandSchema);
const vAdmin = compileSchema<AdminCommand>(adminCommandSchema);
const vCreate = compileSchema<CreateRoomRequest>(createRoomSchema);
const vJoin = compileSchema<JoinRoomRequest>(joinRoomSchema);

type Parsed<T> = { ok: true; value: T } | { ok: false; issues: ConfigIssue[] };

function run<T>(validate: ReturnType<typeof compileSchema<T>>, data: unknown): Parsed<T> {
  if (validate(data)) return { ok: true, value: data };
  return { ok: false, issues: ajvIssues("mensaje", validate.errors) };
}

export const parseParticipantCommand = (data: unknown) => run(vParticipant, data);
export const parseAdminCommand = (data: unknown) => run(vAdmin, data);
export const parseCreateRoomRequest = (data: unknown) => run(vCreate, data);
export const parseJoinRoomRequest = (data: unknown) => run(vJoin, data);
