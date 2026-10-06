import { ajvIssues, compileSchema } from "../config/ajv";
import type { AdminCommand, AdventureCommand } from "./actions";
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

const field = { enum: ["firstIdea", "observation", "nextQuestion", "question", "prediction", "finalQuestion"] };

const recordValue = {
  type: "object",
  oneOf: [
    { type: "object", required: ["modality", "text"], additionalProperties: false, properties: { modality: { const: "written" }, text } },
    { type: "object", required: ["modality", "optionId"], additionalProperties: false, properties: { modality: { const: "suggested" }, optionId: id } },
    { type: "object", required: ["modality"], additionalProperties: false, properties: { modality: { const: "oral" } } },
    { type: "object", required: ["modality"], additionalProperties: false, properties: { modality: { const: "uncertain" } } },
  ],
  discriminator: { propertyName: "modality" },
};

const finalQuestionValue = {
  type: "object",
  oneOf: [
    { type: "object", required: ["modality", "text"], additionalProperties: false, properties: { modality: { const: "written" }, text } },
    { type: "object", required: ["modality", "optionId"], additionalProperties: false, properties: { modality: { const: "suggested" }, optionId: id } },
    { type: "object", required: ["modality"], additionalProperties: false, properties: { modality: { const: "oral" } } },
    { type: "object", required: ["modality", "recordId"], additionalProperties: false, properties: { modality: { const: "saved" }, recordId: id } },
  ],
  discriminator: { propertyName: "modality" },
};

const bare = (type: string) => ({ type: "object", required: ["type"], additionalProperties: false, properties: { type: { const: type } } });

const adventureAction = {
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
    bare("shadows.surprise.ack"),
    {
      type: "object",
      required: ["type", "distanceCm", "commitSample"],
      additionalProperties: false,
      properties: { type: { const: "shadows.light.set" }, distanceCm: finite, commitSample: { type: "boolean" } },
    },
    {
      type: "object",
      required: ["type", "activityId", "field", "value"],
      additionalProperties: false,
      properties: { type: { const: "record.confirm" }, activityId: id, field, value: recordValue, objectId: id },
    },
    {
      type: "object",
      required: ["type", "recordId", "expectedRevision", "value"],
      additionalProperties: false,
      properties: { type: { const: "record.edit" }, recordId: id, expectedRevision: int, value: recordValue },
    },
    bare("ramps.question.open"),
    { type: "object", required: ["type", "angleDeg"], additionalProperties: false, properties: { type: { const: "ramps.angle.set" }, angleDeg: finite } },
    bare("ramps.trial.start"),
    bare("boxes.shared.open"),
    { type: "object", required: ["type", "objectId"], additionalProperties: false, properties: { type: { const: "boxes.object.inspect" }, objectId: id } },
    bare("boxes.permission.ask"),
    bare("boxes.refusal.ack"),
    bare("boxes.refusal.respect"),
    bare("experiment.reset"),
    bare("inventor.placePieces"),
    { type: "object", required: ["type", "value"], additionalProperties: false, properties: { type: { const: "inventor.question.confirm" }, value: finalQuestionValue } },
  ],
  discriminator: { propertyName: "type" },
};

const adminAction = {
  type: "object",
  oneOf: [
    bare("room.start"),
    { type: "object", required: ["type", "principalId"], additionalProperties: false, properties: { type: { const: "control.assign" }, principalId: id } },
    bare("control.revoke"),
    bare("control.take"),
    bare("room.pause"),
    bare("room.resume"),
    { type: "object", required: ["type", "confirm"], additionalProperties: false, properties: { type: { const: "room.reset" }, confirm: { const: true } } },
    { type: "object", required: ["type", "confirm"], additionalProperties: false, properties: { type: { const: "room.close" }, confirm: { const: true } } },
  ],
  discriminator: { propertyName: "type" },
};

const adventureCommandSchema = {
  type: "object",
  required: ["requestId", "roomGeneration", "turnVersion", "connectionEpoch", "action"],
  additionalProperties: false,
  properties: { requestId, roomGeneration: int, turnVersion: int, connectionEpoch: int, action: adventureAction },
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
  properties: { name: { type: "string", minLength: 1, maxLength: NAME_MAX_CHARS * TEXT_MAX_UTF16_FACTOR }, color: { type: "string", minLength: 1, maxLength: 32 } },
};

const vAdventure = compileSchema<AdventureCommand>(adventureCommandSchema);
const vAdmin = compileSchema<AdminCommand>(adminCommandSchema);
const vCreate = compileSchema<CreateRoomRequest>(createRoomSchema);
const vJoin = compileSchema<JoinRoomRequest>(joinRoomSchema);

type Parsed<T> = { ok: true; value: T } | { ok: false; issues: ConfigIssue[] };

function run<T>(validate: ReturnType<typeof compileSchema<T>>, data: unknown): Parsed<T> {
  if (validate(data)) return { ok: true, value: data };
  return { ok: false, issues: ajvIssues("mensaje", validate.errors) };
}

export const parseAdventureCommand = (data: unknown) => run(vAdventure, data);
export const parseAdminCommand = (data: unknown) => run(vAdmin, data);
export const parseCreateRoomRequest = (data: unknown) => run(vCreate, data);
export const parseJoinRoomRequest = (data: unknown) => run(vJoin, data);
