import type { EffectEvent } from "../contracts/events";
import type { CommandErrorCode } from "../contracts/limits";
import type { RoomPhase, RoomState } from "../contracts/state";

/** Tipos y utilidades comunes de las transiciones puras de sala y de ronda. */

export type RoomError = { ok: false; code: CommandErrorCode; message: string };
export type RoomChange = { ok: true; room: RoomState; changed: boolean; effects: EffectEvent[] } | RoomError;

export const fail = (code: CommandErrorCode, message: string): RoomError => ({ ok: false, code, message });

export const isTerminal = (phase: RoomPhase): boolean => phase === "closed" || phase === "expired";

/** El reloj de simulación solo corre con la sala en curso (invariante 6): en pausa, al terminar o sin empezar queda quieto. */
export const isClockRunning = (room: RoomState): boolean => room.phase === "running";

/** Sube la versión de estado; `round` también la de la ronda (invalida las acciones de la ronda anterior). */
export const bump = (room: RoomState, round = false): RoomState => ({ ...room, stateVersion: room.stateVersion + 1, roundVersion: round ? room.roundVersion + 1 : room.roundVersion });
