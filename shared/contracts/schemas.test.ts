import { describe, expect, it } from "vitest";
import { ADMIN_ACTION_TYPES, PARTICIPANT_ACTION_TYPES, type AdminAction, type ParticipantAction } from "./actions";
import { parseAdminCommand, parseCreateRoomRequest, parseJoinRoomRequest, parseParticipantCommand } from "./schemas";

const participant = (action: unknown, over: object = {}) => ({ requestId: "req-1", roomGeneration: 1, roundVersion: 2, connectionEpoch: 3, action, ...over });
const admin = (action: unknown, over: object = {}) => ({ requestId: "req-1", roomGeneration: 1, connectionEpoch: 3, commandSeq: 1, action, ...over });

// Un ejemplo válido por cada acción del catálogo: el test falla si se añade una acción sin esquema (contraste tipos ↔ esquemas).
const participantSamples: Record<ParticipantAction["type"], ParticipantAction> = {
  "player.moveTo": { type: "player.moveTo", target: { x: 10, y: 20 } },
  "station.open": { type: "station.open", stationId: "sombras", origin: "map" },
  "adventure.returnToMap": { type: "adventure.returnToMap" },
  "shadows.sample": { type: "shadows.sample", distanceCm: 30 },
  "ramps.trial.start": { type: "ramps.trial.start", angleDeg: 30 },
  "boxes.object.inspect": { type: "boxes.object.inspect", objectId: "lupa" },
  "boxes.permission.ask": { type: "boxes.permission.ask" },
};
const adminSamples: Record<AdminAction["type"], AdminAction> = {
  "room.start": { type: "room.start" },
  "room.pause": { type: "room.pause" },
  "room.resume": { type: "room.resume" },
  "room.reset": { type: "room.reset", confirm: true },
  "room.close": { type: "room.close", confirm: true },
  "round.open": { type: "round.open" },
  "round.converse": { type: "round.converse", withPending: true },
  "round.showFreire": { type: "round.showFreire" },
  "round.next": { type: "round.next" },
  "round.include": { type: "round.include", principalId: "p1" },
  "present.select": { type: "present.select", principalId: "p1" },
  "present.clear": { type: "present.clear" },
  "note.save": { type: "note.save", activityId: "sombras", kind: "synthesis", text: "Cerca, la sombra es mayor" },
  "note.edit": { type: "note.edit", noteId: "n1", expectedRevision: 1, text: "Corregida" },
  "final.confirm": { type: "final.confirm", value: { kind: "saved", noteId: "n2" } },
  "final.correct": { type: "final.correct", expectedRevision: 1, text: "¿Qué sigue?" },
};

describe("esquemas de comandos", () => {
  it("aceptan cada acción del catálogo y el catálogo está completo", () => {
    expect(Object.keys(participantSamples).sort()).toEqual([...PARTICIPANT_ACTION_TYPES].sort());
    expect(Object.keys(adminSamples).sort()).toEqual([...ADMIN_ACTION_TYPES].sort());
    for (const a of Object.values(participantSamples)) expect(parseParticipantCommand(participant(a)), a.type).toMatchObject({ ok: true });
    for (const a of Object.values(adminSamples)) expect(parseAdminCommand(admin(a)), a.type).toMatchObject({ ok: true });
  });

  it("rechazan acciones libres que el cliente no puede enviar", () => {
    for (const type of ["setState", "grantPiece", "setResult", "openPersonalBox", "boxes.personal.open", "round.open", "round.next"]) {
      expect(parseParticipantCommand(participant({ type, piece: "lupa" })).ok, type).toBe(false); // avanzar la ronda es de Vanessa
    }
    expect(parseAdminCommand(admin({ type: "role.set", role: "admin" })).ok).toBe(false);
    expect(parseAdminCommand(admin({ type: "control.assign", principalId: "p1" })).ok).toBe(false); // ya no hay un único controlador
  });

  it("rechazan propiedades de más, tipos erróneos, enteros inválidos y campos ausentes", () => {
    expect(parseParticipantCommand(participant({ type: "ramps.trial.start", angleDeg: 30, resultSeconds: 1.2 })).ok).toBe(false); // el cliente no envía resultados
    expect(parseParticipantCommand(participant({ type: "ramps.trial.start" })).ok).toBe(false); // falta la inclinación
    expect(parseParticipantCommand(participant({ type: "ramps.trial.start", angleDeg: "30" })).ok).toBe(false);
    expect(parseParticipantCommand(participant({ type: "shadows.sample", distanceCm: 30, shadowCm: 5 })).ok).toBe(false); // la sombra la calcula el servidor
    expect(parseParticipantCommand(participant({ type: "player.moveTo", target: { x: 1 } })).ok).toBe(false);
    expect(parseParticipantCommand(participant(participantSamples["shadows.sample"], { roundVersion: -1 })).ok).toBe(false);
    expect(parseParticipantCommand(participant(participantSamples["shadows.sample"], { roundVersion: 1.5 })).ok).toBe(false);
    expect(parseParticipantCommand({ ...participant(participantSamples["shadows.sample"]), requestId: undefined }).ok).toBe(false);
    expect(parseParticipantCommand(participant(participantSamples["shadows.sample"], { role: "admin" })).ok).toBe(false); // el rol no viaja en el comando
    expect(parseParticipantCommand(participant(participantSamples["shadows.sample"], { turnVersion: 1 })).ok).toBe(false); // ya no hay turnos
  });

  it("validan las notas y la pregunta final por unión discriminada", () => {
    const final = (value: unknown) => admin({ type: "final.confirm", value });
    expect(parseAdminCommand(final({ kind: "written", text: "¿Qué sigue?" })).ok).toBe(true);
    expect(parseAdminCommand(final({ kind: "saved", noteId: "n3" })).ok).toBe(true);
    expect(parseAdminCommand(final({ kind: "written" })).ok).toBe(false);
    expect(parseAdminCommand(final({ kind: "oral" })).ok).toBe(false);
    expect(parseAdminCommand(final({ kind: "saved", noteId: "n3", text: "oculto" })).ok).toBe(false);
    expect(parseAdminCommand(admin({ type: "note.save", activityId: "sombras", kind: "comparison", text: "x" })).ok).toBe(false); // las comparaciones se guardan al proyectarlas
    expect(parseAdminCommand(admin({ type: "note.save", activityId: "sombras", kind: "finalQuestion", text: "x" })).ok).toBe(false);
  });

  it("exigen confirmación explícita para reiniciar y cerrar", () => {
    expect(parseAdminCommand(admin({ type: "room.reset" })).ok).toBe(false);
    expect(parseAdminCommand(admin({ type: "room.close", confirm: false })).ok).toBe(false);
  });

  it("acotan el tamaño bruto del requestId y del texto", () => {
    expect(parseParticipantCommand(participant(participantSamples["shadows.sample"], { requestId: "x".repeat(65) })).ok).toBe(false);
    expect(parseParticipantCommand(participant(participantSamples["shadows.sample"], { requestId: "con espacios" })).ok).toBe(false);
    const huge = admin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "a".repeat(280 * 8 + 1) });
    expect(parseAdminCommand(huge).ok).toBe(false);
  });
});

describe("esquemas de la API HTTP", () => {
  it("alta de sala y entrada", () => {
    expect(parseCreateRoomRequest({ contentSetId: "laboratorio-cosas-cotidianas" }).ok).toBe(true);
    expect(parseCreateRoomRequest({}).ok).toBe(false);
    expect(parseCreateRoomRequest({ contentSetId: "x", role: "admin" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "Laura", color: "azul" }).ok).toBe(true);
    expect(parseJoinRoomRequest({ name: "Laura", color: "azul", observer: true }).ok).toBe(true); // acompaña sin jugar
    expect(parseJoinRoomRequest({ name: "Laura", color: "azul", observer: "si" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "", color: "azul" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "Laura", color: "azul", role: "admin" }).ok).toBe(false);
    expect(parseJoinRoomRequest({ name: "a".repeat(20 * 8 + 1), color: "azul" }).ok).toBe(false);
  });
});
