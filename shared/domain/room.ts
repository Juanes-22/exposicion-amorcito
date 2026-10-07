import type { AdminAction, ParticipantAction } from "../contracts/actions";
import type { LaboratorioConfig } from "../contracts/config";
import type { CommandErrorCode } from "../contracts/limits";
import type { ResumePhase, RoomPhase, RoomState } from "../contracts/state";
import type { MapIndex } from "../config/tmj";
import { bump, fail, isClockRunning, isTerminal, type RoomChange, type RoomError } from "./change";
import { samplePlan } from "./movement";
import { createParticipantState, hasDueTrial, reduceParticipant, type ParticipantContext } from "./participant";
import { clearPresentation, confirmFinal, converse, correctFinal, createInitialAdventure, editNote, includeLate, nextRound, openRound, resetAdventure, saveNote, selectPresentation, settleAll, showFreire, startRoom, type RoundContext } from "./round";

/**
 * Transiciones de sala puras: fases, pausa, reanudación, reinicio y cierre, y el despacho de las acciones de Vanessa (`round.ts`) y de
 * cada participante (`participant.ts`). Ninguna función muta su entrada. El servidor serializa las llamadas por sala y persiste el
 * resultado antes de anunciarlo. Ya no existe un «propietario del control»: todas las personas juegan a la vez.
 */

export type { RoomChange, RoomError } from "./change";
export { isClockRunning, isTerminal } from "./change";

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
    roundVersion: 1,
    phase: "welcome",
    resumePhase: null,
    adventure: createInitialAdventure(p.map),
    participants: {},
    createdAt: p.nowIso,
  };
}

/** Comprobaciones de sobre previas a cualquier mutación. */
export function checkGeneration(room: RoomState, roomGeneration: number): RoomError | null {
  if (isTerminal(room.phase)) return fail("ROOM_UNAVAILABLE", room.phase === "closed" ? "La aventura ya terminó." : "La sala venció por inactividad.");
  if (roomGeneration !== room.roomGeneration) return fail("STALE_GENERATION", "La aventura se reinició; esta acción es del recorrido anterior.");
  return null;
}

/** Una acción de una ronda ya cerrada llega con una versión vieja: se rechaza para no contar dos veces ni mezclar rondas. */
export function checkRound(room: RoomState, roundVersion: number): RoomError | null {
  return roundVersion !== room.roundVersion ? fail("STALE_ROUND", "La ronda cambió; esta acción llegó tarde.") : null;
}

// ---- moderación de Vanessa -------------------------------------------------------------------------------------

export interface AdminContext extends RoundContext {
  /** Huellas del paquete vigente: un reinicio explícito de la sala adopta la revisión actual (SPECS 6.1). */
  fingerprint: { configHash: string; mapHash: string };
}

export function applyAdminAction(room: RoomState, action: AdminAction, ctx: AdminContext): RoomChange {
  if (isTerminal(room.phase)) return fail("ROOM_UNAVAILABLE", room.phase === "closed" ? "La aventura ya terminó." : "La sala venció por inactividad.");
  const done = (next: RoomState): RoomChange => ({ ok: true, room: next, changed: true, effects: [] });
  const playing = room.phase === "running";
  /** Las acciones de conducción necesitan la aventura en curso: pausada o terminada no se conduce. */
  const needRunning = (): RoomError | null => (room.phase === "paused" ? fail("ROOM_PAUSED", "La aventura está en pausa. Reanúdala para seguir.") : room.phase === "welcome" ? fail("INVALID_STEP", "La aventura aún no comienza.") : !playing ? fail("INVALID_STEP", "La aventura ya terminó.") : null);

  switch (action.type) {
    case "room.start":
      return startRoom(room);
    case "room.pause": {
      if (room.phase !== "running" && room.phase !== "finished") return fail("INVALID_STEP", room.phase === "paused" ? "La aventura ya está en pausa." : "La aventura aún no comienza.");
      return done({ ...bump(room, true), phase: "paused", resumePhase: room.phase });
    }
    case "room.resume": {
      if (room.phase !== "paused" || !room.resumePhase) return fail("INVALID_STEP", "La aventura no está en pausa.");
      return done({ ...bump(room, true), phase: room.resumePhase, resumePhase: null });
    }
    case "room.reset": {
      // Borra aventura, pruebas y piezas; conserva a las personas y sus credenciales (viven fuera de RoomState).
      return done({
        ...bump(room, true),
        roomGeneration: room.roomGeneration + 1,
        phase: "welcome",
        resumePhase: null,
        ...resetAdventure(room, ctx.config, ctx.map),
        configRevision: ctx.config.configRevision,
        configHash: ctx.fingerprint.configHash,
        mapHash: ctx.fingerprint.mapHash,
      });
    }
    case "room.close":
      return done({ ...bump(room, true), phase: "closed", resumePhase: null });

    case "round.open":
    case "round.converse":
    case "round.showFreire":
    case "round.next":
    case "round.include":
    case "present.select":
    case "present.clear":
    case "note.save":
    case "note.edit": {
      const blocked = needRunning();
      if (blocked) return blocked;
      return conduct(room, action, ctx);
    }
    case "final.confirm": {
      const blocked = needRunning();
      return blocked ?? confirmFinal(room, action.value, ctx);
    }
    case "final.correct":
      if (room.phase === "paused") return fail("ROOM_PAUSED", "La aventura está en pausa. Reanúdala para seguir.");
      return correctFinal(room, action, ctx);
    default:
      // Una acción que el tipado no permite (p. ej. un mensaje malformado que llegó sin validar): se rechaza en vez de lanzar.
      return fail("INVALID_PAYLOAD", "Esa acción no existe.");
  }
}

function conduct(room: RoomState, action: Extract<AdminAction, { type: "round.open" | "round.converse" | "round.showFreire" | "round.next" | "round.include" | "present.select" | "present.clear" | "note.save" | "note.edit" }>, ctx: AdminContext): RoomChange {
  switch (action.type) {
    case "round.open":
      return openRound(room);
    case "round.converse":
      return converse(room, action.withPending === true, ctx);
    case "round.showFreire":
      return showFreire(room);
    case "round.next":
      return nextRound(settledRoom(room, ctx.activeMs), ctx);
    case "round.include":
      return includeLate(room, action.principalId);
    case "present.select":
      return selectPresentation(room, action.principalId, ctx);
    case "present.clear":
      return clearPresentation(room);
    case "note.save":
      return saveNote(room, action, ctx);
    case "note.edit":
      return editNote(room, action, ctx);
  }
}

const settledRoom = (room: RoomState, activeMs: number): RoomState => settleAll(room, activeMs);

/**
 * Vencimiento por inactividad de la administradora (SPECS 6.3). Es una transición automática del servidor, no un comando: deja la sala
 * terminal y sube las versiones para que cualquier acción posterior sea rechazada. Una sala ya terminal no cambia.
 */
export function expireRoom(room: RoomState): RoomChange {
  if (isTerminal(room.phase)) return { ok: true, room, changed: false, effects: [] };
  return { ok: true, room: { ...bump(room, true), phase: "expired", resumePhase: null }, changed: true, effects: [] };
}

// ---- eventos de conexión ----------------------------------------------------------------------------------------

/** La administradora perdió su conexión vigente: se pausa para todas las personas y no se entrega la conducción a nadie. */
export function onAdminLost(room: RoomState): RoomChange {
  if (room.phase !== "running" && room.phase !== "finished") return { ok: true, room, changed: false, effects: [] };
  return { ok: true, room: { ...bump(room, true), phase: "paused" as RoomPhase, resumePhase: room.phase as ResumePhase }, changed: true, effects: [] };
}

/** Tras reiniciar el servicio: salas en curso pausadas y con `roundVersion` nuevo (SPECS 6.1). */
export function recoverAfterRestart(room: RoomState): RoomState {
  if (isTerminal(room.phase)) return room;
  const next = bump(room, true);
  return room.phase === "running" ? { ...next, phase: "paused", resumePhase: "running" } : next;
}

// ---- participantes --------------------------------------------------------------------------------------------------

/** Da de alta a quien juega, con su personaje en la entrada. Idempotente: quien ya existe no cambia. Los observadores no se dan de alta. */
export function ensureParticipant(room: RoomState, principalId: string, config: LaboratorioConfig, map: MapIndex): RoomState {
  if (room.participants[principalId]) return room;
  const index = Object.keys(room.participants).length;
  return { ...bump(room), participants: { ...room.participants, [principalId]: createParticipantState(config, map, index) } };
}

/** Aplica una acción personal. Comprueba la fase de la sala; la de la ronda y lo que corresponde a la mesa, el reductor personal. */
export function applyParticipantAction(room: RoomState, principalId: string, action: ParticipantAction, ctx: ParticipantContext): RoomChange {
  if (isTerminal(room.phase)) return fail("ROOM_UNAVAILABLE", "La aventura ya terminó.");
  if (room.phase === "paused") return fail("ROOM_PAUSED", "La aventura está en pausa.");
  if (room.phase === "welcome") return fail("INVALID_STEP", "La aventura aún no comienza.");
  if (room.phase === "finished") return fail("INVALID_STEP", "La aventura terminó.");
  const result = reduceParticipant(room, principalId, action, ctx);
  if (!result.ok) return fail(result.code as CommandErrorCode, result.message);
  if (!result.changed) return { ok: true, room, changed: false, effects: [] };
  const next: RoomState = { ...room, participants: { ...room.participants, [principalId]: result.participant }, adventure: { ...room.adventure, counters: result.counters } };
  return { ok: true, room: { ...next, stateVersion: room.stateVersion + 1 }, changed: true, effects: [] };
}

/**
 * Lleva el reloj de simulación hasta `activeMs` y termina las pruebas de rampa cuya hora llegó. Solo con la sala en curso.
 * `room` siempre trae el reloj al día (para guardar el checkpoint); `changed` indica progreso real y es lo único que sube
 * `stateVersion`; `changedIds` son las personas cuyo resultado cambió.
 */
export function tickRoom(room: RoomState, activeMs: number): { room: RoomState; changed: boolean; changedIds: string[] } {
  if (!isClockRunning(room)) return { room, changed: false, changedIds: [] };
  const settled = settleAll(room, activeMs);
  const changedIds = settled === room ? [] : Object.keys(settled.participants).filter((id) => settled.participants[id] !== room.participants[id]);
  const adventure = { ...settled.adventure, timeline: { activeMs: Math.max(settled.adventure.timeline.activeMs, activeMs) } };
  const changed = changedIds.length > 0;
  return { room: { ...settled, adventure, stateVersion: changed ? settled.stateVersion + 1 : settled.stateVersion }, changed, changedIds };
}

/**
 * ¿Hay algo que simular en `activeMs`? Solo con la sala en curso y una prueba de rampa en marcha o un personaje que todavía camina.
 * Un plan que ya llegó a su destino no cuenta: así el bucle no escribe ni emite nada cuando todo está quieto.
 */
export function isSimulating(room: RoomState, activeMs: number): boolean {
  if (!isClockRunning(room)) return false;
  for (const p of Object.values(room.participants)) {
    if (p.character.plan !== null && samplePlan(p.character.plan, activeMs, p.character.facing).done === false) return true;
    for (const st of Object.values(p.activities)) if (st.type === "ramps" && st.trials.some((t) => t.state === "running")) return true;
  }
  return false;
}

export { hasDueTrial };
