import type { AdminCommand, AdventureCommand, CommandResult } from "./actions";
import type { Direction, Point } from "./geometry";
import type { AdventureView, ControlOwner, ResumePhase, RoomPhase, RoomState } from "./state";

/** Eventos del transporte Socket.IO (SPECS 5.3). Los nombres son decisiones de esta especificación, no APIs nativas. */

export type Role = "admin" | "participant";

/** Lo mínimo que se publica de quien controla: lo ve el público en la proyección. */
export interface PublicController {
  principalId: string;
  role: Role;
  displayName: string;
  /** Color de paleta; la administradora no tiene. */
  color: string | null;
}

export interface SelfInfo {
  principalId: string;
  role: Role;
  displayName: string;
  color: string | null;
  connectionEpoch: number;
  isController: boolean;
}

/** `room.summary`: a todos; fase, versiones, propietario y estado propio. Sin cuaderno ni credenciales. */
export interface RoomSummary {
  code: string;
  roomGeneration: number;
  stateVersion: number;
  turnVersion: number;
  phase: RoomPhase;
  resumePhase: ResumePhase | null;
  controller: PublicController | null;
  adminConnected: boolean;
  /** La sala se creó con otra revisión de configuración o de mapa: se conserva el progreso pero se bloquea el control (CT-13). */
  configMismatch: boolean;
  self: SelfInfo;
}

export interface ParticipantInfo {
  principalId: string;
  role: Role;
  /** Nombre con su distinción estable (`Laura · 2`). */
  displayName: string;
  name: string;
  color: string | null;
  distinction: number;
  connected: boolean;
  isController: boolean;
}

/** `presence.updated`: solo a la administradora. */
export interface PresenceUpdate {
  participants: ParticipantInfo[];
  connectedCount: number;
}

export interface EffectEvent {
  /** Único por transición: nunca se repite una campana o pieza tras un snapshot o una reconexión. */
  effectId: string;
  kind: "piece.earned" | "pieces.placed" | "adventure.finished";
  pieceId?: string;
  activityId?: string;
}

/** `room.snapshot`: estado completo autorizado de aventura, a la administradora y al controlador. */
export interface RoomSnapshot {
  state: RoomState;
  controller: PublicController | null;
  /** Efectos de la transición que originó este snapshot. Vacío en una sincronización o reconexión. */
  effects: EffectEvent[];
}

/** `simulation.frame`: muestra visual efímera. Se ordena por generación, versiones y `frameSeq`. */
export interface SimulationFrame {
  roomGeneration: number;
  turnVersion: number;
  stateVersion: number;
  frameSeq: number;
  activeMs: number;
  player: { feet: Point; facing: Direction; moving: boolean; planId: string | null };
  trial: { trialId: string; elapsedMs: number; durationMs: number } | null;
}

/** `control.changed`: a los afectados (anterior, nuevo y administradora). */
export interface ControlChanged {
  controlOwner: ControlOwner;
  controller: PublicController | null;
  turnVersion: number;
  phase: RoomPhase;
  resumePhase: ResumePhase | null;
  view: AdventureView;
}

export type SyncResult =
  | { ok: true; stateVersion: number }
  | { ok: false; code: "ROOM_UNAVAILABLE" | "RATE_LIMITED" | "STALE_CONNECTION"; message: string };

export interface ServerToClientEvents {
  "room.summary": (summary: RoomSummary) => void;
  "presence.updated": (presence: PresenceUpdate) => void;
  "room.snapshot": (snapshot: RoomSnapshot) => void;
  "simulation.frame": (frame: SimulationFrame) => void;
  "control.changed": (change: ControlChanged) => void;
  "session.replaced": () => void;
}

export interface ClientToServerEvents {
  "admin.command": (command: AdminCommand, ack: (result: CommandResult) => void) => void;
  "adventure.action": (command: AdventureCommand, ack: (result: CommandResult) => void) => void;
  "room.sync": (ack: (result: SyncResult) => void) => void;
  /** Señal de actividad autenticada de la administradora: mantiene viva la sala (SPECS 6.3). */
  "admin.activity": () => void;
}

// ---- API HTTP -----------------------------------------------------------------

export interface CreateRoomRequest {
  contentSetId: string;
}

export interface CreateRoomResponse {
  code: string;
  /** Enlace público de entrada: contiene solo el código, nunca una credencial. */
  joinUrl: string;
  adminId: string;
  /** Credencial privada de la administradora: se devuelve una sola vez. */
  adminToken: string;
}

export interface JoinRoomRequest {
  name: string;
  color: string;
}

export interface JoinRoomResponse {
  principalId: string;
  name: string;
  displayName: string;
  color: string;
  distinction: number;
  /** Credencial propia: se devuelve una sola vez. */
  token: string;
}

export interface RoomPublicInfo {
  code: string;
  phase: RoomPhase;
  title: string;
}

export interface ApiError {
  error: { code: string; message: string };
}
