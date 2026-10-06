import { describe, expect, it } from "vitest";
import { ADMIN_ACTION_TYPES, ADVENTURE_ACTION_TYPES, type AdminAction, type AdventureAction } from "./actions";
import { parseAdminCommand, parseAdventureCommand, parseCreateRoomRequest, parseJoinRoomRequest } from "./schemas";

const adventure = (action: unknown, over: object = {}) => ({ requestId: "req-1", roomGeneration: 1, turnVersion: 2, connectionEpoch: 3, action, ...over });
const admin = (action: unknown, over: object = {}) => ({ requestId: "req-1", roomGeneration: 1, connectionEpoch: 3, commandSeq: 1, action, ...over });

// Un ejemplo válido por cada acción del catálogo: el test falla si se añade una acción sin esquema (contraste tipos ↔ esquemas).
const adventureSamples: Record<AdventureAction["type"], AdventureAction> = {
  "player.moveTo": { type: "player.moveTo", target: { x: 10, y: 20 } },
  "station.open": { type: "station.open", stationId: "sombras", origin: "map" },
  "adventure.returnToMap": { type: "adventure.returnToMap" },
  "shadows.surprise.ack": { type: "shadows.surprise.ack" },
  "shadows.light.set": { type: "shadows.light.set", distanceCm: 30, commitSample: false },
  "record.confirm": { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Porque…" } },
  "record.edit": { type: "record.edit", recordId: "r1", expectedRevision: 1, value: { modality: "suggested", optionId: "la-luz" } },
  "ramps.question.open": { type: "ramps.question.open" },
  "ramps.angle.set": { type: "ramps.angle.set", angleDeg: 30 },
  "ramps.trial.start": { type: "ramps.trial.start" },
  "boxes.shared.open": { type: "boxes.shared.open" },
  "boxes.object.inspect": { type: "boxes.object.inspect", objectId: "lupa" },
  "boxes.permission.ask": { type: "boxes.permission.ask" },
  "boxes.refusal.ack": { type: "boxes.refusal.ack" },
  "boxes.refusal.respect": { type: "boxes.refusal.respect" },
  "experiment.reset": { type: "experiment.reset" },
  "inventor.placePieces": { type: "inventor.placePieces" },
  "inventor.question.confirm": { type: "inventor.question.confirm", value: { modality: "saved", recordId: "r2" } },
};
const adminSamples: Record<AdminAction["type"], AdminAction> = {
  "room.start": { type: "room.start" },
  "control.assign": { type: "control.assign", principalId: "p1" },
  "control.revoke": { type: "control.revoke" },
  "control.take": { type: "control.take" },
  "room.pause": { type: "room.pause" },
  "room.resume": { type: "room.resume" },
  "room.reset": { type: "room.reset", confirm: true },
  "room.close": { type: "room.close", confirm: true },
};

describe("esquemas de comandos", () => {
  it("aceptan cada acción del catálogo y el catálogo está completo", () => {
    expect(Object.keys(adventureSamples).sort()).toEqual([...ADVENTURE_ACTION_TYPES].sort());
    expect(Object.keys(adminSamples).sort()).toEqual([...ADMIN_ACTION_TYPES].sort());
    for (const a of Object.values(adventureSamples)) expect(parseAdventureCommand(adventure(a)), a.type).toMatchObject({ ok: true });
    for (const a of Object.values(adminSamples)) expect(parseAdminCommand(admin(a)), a.type).toMatchObject({ ok: true });
  });

  it("rechazan acciones libres que el cliente no puede enviar", () => {
    for (const type of ["setState", "grantPiece", "setResult", "openPersonalBox"]) {
      expect(parseAdventureCommand(adventure({ type, piece: "lupa" })).ok, type).toBe(false);
    }
    expect(parseAdminCommand(admin({ type: "role.set", role: "admin" })).ok).toBe(false);
  });

  it("rechazan propiedades de más, tipos erróneos, enteros inválidos y campos ausentes", () => {
    expect(parseAdventureCommand(adventure({ type: "ramps.trial.start", resultSeconds: 1.2 })).ok).toBe(false); // el cliente no envía resultados
    expect(parseAdventureCommand(adventure({ type: "ramps.angle.set", angleDeg: "30" })).ok).toBe(false);
    expect(parseAdventureCommand(adventure({ type: "player.moveTo", target: { x: 1 } })).ok).toBe(false);
    expect(parseAdventureCommand(adventure(adventureSamples["shadows.light.set"], { turnVersion: -1 })).ok).toBe(false);
    expect(parseAdventureCommand(adventure(adventureSamples["shadows.light.set"], { turnVersion: 1.5 })).ok).toBe(false);
    expect(parseAdventureCommand({ ...adventure(adventureSamples["ramps.trial.start"]), requestId: undefined }).ok).toBe(false);
    expect(parseAdventureCommand(adventure(adventureSamples["ramps.trial.start"], { role: "admin" })).ok).toBe(false); // el rol no viaja en el comando
  });

  it("validan las modalidades por unión discriminada", () => {
    const confirm = (value: unknown) => adventure({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value });
    expect(parseAdventureCommand(confirm({ modality: "oral" })).ok).toBe(true);
    expect(parseAdventureCommand(confirm({ modality: "uncertain" })).ok).toBe(true);
    expect(parseAdventureCommand(confirm({ modality: "oral", text: "oculto" })).ok).toBe(false);
    expect(parseAdventureCommand(confirm({ modality: "written" })).ok).toBe(false);
    expect(parseAdventureCommand(confirm({ modality: "dibujo" })).ok).toBe(false);
    expect(parseAdventureCommand(confirm({ modality: "saved", recordId: "r1" })).ok).toBe(false); // «saved» solo existe para la pregunta final
  });

  it("exigen confirmación explícita para reiniciar y cerrar", () => {
    expect(parseAdminCommand(admin({ type: "room.reset" })).ok).toBe(false);
    expect(parseAdminCommand(admin({ type: "room.close", confirm: false })).ok).toBe(false);
  });

  it("acotan el tamaño bruto del requestId y del texto", () => {
    expect(parseAdventureCommand(adventure(adventureSamples["ramps.trial.start"], { requestId: "x".repeat(65) })).ok).toBe(false);
    expect(parseAdventureCommand(adventure(adventureSamples["ramps.trial.start"], { requestId: "con espacios" })).ok).toBe(false);
    const huge = adventure({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "a".repeat(280 * 8 + 1) } });
    expect(parseAdventureCommand(huge).ok).toBe(false);
  });
});

describe("esquemas de la API HTTP", () => {
  it("alta de sala y entrada", () => {
    expect(parseCreateRoomRequest({ contentSetId: "laboratorio-cosas-cotidianas" }).ok).toBe(true);
    expect(parseCreateRoomRequest({}).ok).toBe(false);
    expect(parseCreateRoomRequest({ contentSetId: "x", role: "admin" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "Laura", color: "azul" }).ok).toBe(true);
    expect(parseJoinRoomRequest({ name: "", color: "azul" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "Laura", color: "azul", role: "admin" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "a".repeat(20 * 8 + 1), color: "azul" }).ok).toBe(false);
  });
});
