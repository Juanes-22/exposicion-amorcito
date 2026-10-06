import type { AdminAction, AdventureAction } from "../contracts/actions";
import type { EffectEvent } from "../contracts/events";
import type { CommandErrorCode } from "../contracts/limits";
import type { ControlOwner, ResumePhase, RoomPhase, RoomState } from "../contracts/state";
import { advanceTime, createInitialAdventure, reduceAdventure, type DomainContext } from "./adventure";
import type { LaboratorioConfig } from "../contracts/config";
import type { MapIndex } from "../config/tmj";

/**
 * Transiciones de sala puras: fases, propietario del control, pausa, reanudación, reinicio y cierre (SPECS 2.3, 4.2).
 * Ninguna función muta su entrada. El servidor serializa las llamadas por sala y persiste el resultado antes de anunciarlo.
 */

export type RoomError = { ok: false; code: CommandErrorCode; message: string };
export type RoomChange =
  | { ok: true; room: RoomState; changed: boolean; effects: EffectEvent[] }
  | RoomError;

/** Qué sabe el dominio de la presencia, que vive en el servidor y no se persiste. */
export interface PresenceView {
  isConnected(principalId: string): boolean;
  /** `true` solo para participantes de esta sala (no para la administradora ni para identidades ajenas). */
  isParticipant(principalId: string): boolean;
}

const fail = (code: CommandErrorCode, message: string): RoomError => ({ ok: false, code, message });

export const isTerminal = (phase: RoomPhase): boolean => phase === "closed" || phase === "expired";

/** El reloj de simulación y las acciones de aventura solo existen con la sala jugable y un propietario (invariante 6). */
export const isPlayable = (room: RoomState): boolean => (room.phase === "running" || room.phase === "finished") && room.controlOwner !== null;

export const sameOwner = (a: ControlOwner, b: ControlOwner): boolean => (a === null || b === null ? a === b : a.principalId === b.principalId && a.role === b.role);

export interface NewRoomParams {
  roomId: string;
  code: string;
  config: LaboratorioConfig;
  map: MapIndex;
  configHash: string;
  mapHash: string;
  nowIso: string;
}

export function createRoomState(p: NewRoomParams): RoomState {
  return {
    roomId: p.roomId,
    code: p.code,
    contentSetId: p.config.contentSetId,
    configRevision: p.config.configRevision,
    configHash: p.configHash,
    mapHash: p.mapHash,
    roomGeneration: 1,
    stateVersion: 1,
    turnVersion: 1,
    phase: "welcome",
    resumePhase: null,
    controlOwner: null,
    adventure: createInitialAdventure(p.config, p.map),
    createdAt: p.nowIso,
  };
}

/** Comprobaciones de sobre previas a cualquier mutación (SPECS 5.4, paso 4). `turnVersion` solo aplica a acciones de aventura. */
export function checkGeneration(room: RoomState, roomGeneration: number): RoomError | null {
  if (isTerminal(room.phase)) return fail("ROOM_UNAVAILABLE", room.phase === "closed" ? "La aventura ya terminó." : "La sala venció por inactividad.");
  if (roomGeneration !== room.roomGeneration) return fail("STALE_GENERATION", "La aventura se reinició; esta acción es del recorrido anterior.");
  return null;
}

export function checkTurn(room: RoomState, principalId: string, turnVersion: number): RoomError | null {
  if (turnVersion !== room.turnVersion) return fail("STALE_TURN", "El turno cambió; esta acción llegó tarde.");
  if (room.controlOwner?.principalId !== principalId) return fail("NOT_AUTHORIZED", "No tienes el control en este momento.");
  return null;
}

// ---- moderación ---------------------------------------------------------------------------------------

const bump = (room: RoomState, turn: boolean): RoomState => ({ ...room, stateVersion: room.stateVersion + 1, turnVersion: turn ? room.turnVersion + 1 : room.turnVersion });

export interface AdminContext {
  /** Identidad de la administradora que emite el comando (ya autenticada y con papel admin). */
  adminId: string;
  presence: PresenceView;
  config: LaboratorioConfig;
  map: MapIndex;
  /** Huellas del paquete vigente: un reinicio explícito de la sala adopta la revisión actual (SPECS 6.1). */
  fingerprint: { configHash: string; mapHash: string };
}

export function applyAdminAction(room: RoomState, action: AdminAction, ctx: AdminContext): RoomChange {
  if (isTerminal(room.phase)) return fail("ROOM_UNAVAILABLE", room.phase === "closed" ? "La aventura ya terminó." : "La sala venció por inactividad.");
  const done = (next: RoomState): RoomChange => ({ ok: true, room: next, changed: true, effects: [] });

  switch (action.type) {
    case "room.start": {
      if (room.phase !== "welcome") return fail("INVALID_STEP", "La aventura ya comenzó.");
      if (!room.controlOwner) return fail("INVALID_STEP", "Elige quién tendrá el primer turno.");
      if (!ctx.presence.isConnected(room.controlOwner.principalId)) return fail("INVALID_STEP", "Quien tiene el turno no está conectado.");
      return done({ ...bump(room, true), phase: "running", resumePhase: null });
    }
    case "control.assign": {
      if (!ctx.presence.isParticipant(action.principalId)) return fail("INVALID_PAYLOAD", "Esa persona no está en la sala.");
      if (!ctx.presence.isConnected(action.principalId)) return fail("INVALID_PAYLOAD", "Esa persona no está conectada.");
      if (room.controlOwner?.role === "participant" && room.controlOwner.principalId === action.principalId) return { ok: true, room, changed: false, effects: [] };
      // Reemplazo atómico del propietario. Dar control durante una pausa no reanuda.
      return done({ ...bump(room, true), controlOwner: { role: "participant", principalId: action.principalId } });
    }
    case "control.take": {
      if (room.controlOwner?.role === "admin") return { ok: true, room, changed: false, effects: [] };
      return done({ ...bump(room, true), controlOwner: { role: "admin", principalId: ctx.adminId } });
    }
    case "control.revoke":
      return done(revoked(room));
    case "room.pause": {
      if (room.phase !== "running" && room.phase !== "finished") return fail("INVALID_STEP", room.phase === "paused" ? "La aventura ya está en pausa." : "La aventura aún no comienza.");
      return done({ ...bump(room, true), phase: "paused", resumePhase: room.phase });
    }
    case "room.resume": {
      if (room.phase !== "paused" || !room.resumePhase) return fail("INVALID_STEP", "La aventura no está en pausa.");
      if (!room.controlOwner) return fail("INVALID_STEP", "Elige quién tendrá el turno para reanudar.");
      if (!ctx.presence.isConnected(room.controlOwner.principalId)) return fail("INVALID_STEP", "Quien tiene el turno no está conectado.");
      return done({ ...bump(room, true), phase: room.resumePhase, resumePhase: null });
    }
    case "room.reset": {
      // Borra aventura, registros y piezas; conserva participantes y credenciales (viven fuera de RoomState).
      return done({
        ...bump(room, true),
        roomGeneration: room.roomGeneration + 1,
        phase: "welcome",
        resumePhase: null,
        controlOwner: null,
        adventure: createInitialAdventure(ctx.config, ctx.map),
        configRevision: ctx.config.configRevision,
        configHash: ctx.fingerprint.configHash,
        mapHash: ctx.fingerprint.mapHash,
      });
    }
    case "room.close":
      return done({ ...bump(room, true), phase: "closed", resumePhase: null, controlOwner: null });
  }
}

/**
 * Vencimiento por inactividad de la administradora (SPECS 6.3). Es una transición automática del servidor, no un comando: deja la sala
 * terminal, sin propietario, y sube las versiones para que cualquier acción posterior sea rechazada. Una sala ya terminal no cambia.
 */
export function expireRoom(room: RoomState): RoomChange {
  if (isTerminal(room.phase)) return { ok: true, room, changed: false, effects: [] };
  return { ok: true, room: { ...bump(room, true), phase: "expired", resumePhase: null, controlOwner: null }, changed: true, effects: [] };
}

/** Retirar control: propietario vacío y, si la aventura estaba en curso, pausa. */
function revoked(room: RoomState): RoomState {
  const next = { ...bump(room, true), controlOwner: null as ControlOwner };
  return room.phase === "running" ? { ...next, phase: "paused" as RoomPhase, resumePhase: "running" as ResumePhase } : next;
}

// ---- eventos de conexión --------------------------------------------------------------------------------

/** El controlador perdió su conexión vigente: se pausa, se congela el tiempo y se retira el control (SPECS 6.2). */
export function onControllerLost(room: RoomState): RoomChange {
  if (isTerminal(room.phase) || room.controlOwner === null) return { ok: true, room, changed: false, effects: [] };
  return { ok: true, room: revoked(room), changed: true, effects: [] };
}

/** La administradora perdió su conexión vigente: se pausa y no se entrega administración a nadie. */
export function onAdminLost(room: RoomState): RoomChange {
  if (room.phase !== "running" && room.phase !== "finished") return { ok: true, room, changed: false, effects: [] };
  return { ok: true, room: { ...bump(room, true), phase: "paused", resumePhase: room.phase }, changed: true, effects: [] };
}

/** Tras reiniciar el servicio: salas en curso pausadas, sin propietario y con `turnVersion` nuevo (SPECS 6.1). */
export function recoverAfterRestart(room: RoomState): RoomState {
  if (isTerminal(room.phase)) return room;
  const next = { ...bump(room, true), controlOwner: null as ControlOwner };
  return room.phase === "running" ? { ...next, phase: "paused", resumePhase: "running" } : next;
}

// ---- aventura dentro de la sala ----------------------------------------------------------------------------

/**
 * Aplica una acción de aventura del propietario. Comprueba fase y reloj; el progreso lo calcula el reductor puro.
 * Completar la aventura (pregunta final) cambia la fase a `finished` en la misma transición.
 */
export function applyAdventureAction(room: RoomState, action: AdventureAction, ctx: DomainContext): RoomChange {
  if (isTerminal(room.phase)) return fail("ROOM_UNAVAILABLE", "La aventura ya terminó.");
  if (room.phase === "paused") return fail("ROOM_PAUSED", "La aventura está en pausa.");
  if (room.phase === "welcome") return fail("INVALID_STEP", "La aventura aún no comienza.");
  if (room.controlOwner === null) return fail("NOT_AUTHORIZED", "Nadie tiene el control.");

  const result = reduceAdventure(room.adventure, action, ctx);
  if (!result.ok) return fail(result.code, result.message);
  const next: RoomState = { ...room, adventure: result.adventure };
  if (result.finishRoom) next.phase = "finished";
  const changed = result.changed || result.finishRoom;
  return { ok: true, room: changed ? { ...next, stateVersion: room.stateVersion + 1 } : room, changed, effects: result.effects };
}

/**
 * Lleva el reloj de simulación de la sala hasta `activeMs` (termina movimientos y pruebas). Solo si la sala es jugable.
 * `room` siempre trae el reloj al día, para poder guardar el checkpoint; `changed` indica progreso real (algo terminó) y es lo
 * único que sube `stateVersion` y se anuncia a los clientes.
 */
export function tickRoom(room: RoomState, activeMs: number, config: LaboratorioConfig): { room: RoomState; changed: boolean } {
  if (!isPlayable(room)) return { room, changed: false };
  const adventure = advanceTime(room.adventure, activeMs, config);
  const sameButClock = (a: typeof adventure) => JSON.stringify({ ...a, timeline: null });
  const changed = sameButClock(adventure) !== sameButClock(room.adventure);
  return { room: { ...room, adventure, stateVersion: changed ? room.stateVersion + 1 : room.stateVersion }, changed };
}
