import type { AdminCommand, CommandResult, ParticipantCommand } from "./actions";
import type { AdventureState, ParticipantState, PlayerState, ResumePhase, RoomPhase } from "./state";

/**
 * Eventos del transporte Socket.IO. Los nombres son decisiones de esta especificación, no APIs nativas.
 * Quién recibe qué (participación simultánea):
 * - Todas las personas: el resumen, el estado de grupo (ronda, piezas, cuaderno común), las posiciones de los personajes y el reloj.
 * - Cada participante, además: SU estado personal (sus pruebas), nunca el de otra persona.
 * - Solo Vanessa: quién está conectado y cuántas personas están listas en la ronda.
 */

export type Role = "admin" | "participant";

export interface SelfInfo {
  principalId: string;
  role: Role;
  displayName: string;
  color: string | null;
  connectionEpoch: number;
  /** Acompaña sin jugar: no tiene personaje ni cuenta en la ronda. */
  observer: boolean;
}

/** `room.summary`: a todos; fase, versiones y estado propio. Sin cuaderno ni credenciales. */
export interface RoomSummary {
  code: string;
  roomGeneration: number;
  stateVersion: number;
  roundVersion: number;
  phase: RoomPhase;
  resumePhase: ResumePhase | null;
  adminConnected: boolean;
  /** La sala se creó con otra revisión de configuración o de mapa: se conserva el progreso pero se bloquea el juego (CT-13). */
  configMismatch: boolean;
  self: SelfInfo;
}

export interface EffectEvent {
  /** Único por transición: nunca se repite una pieza o un cierre tras un snapshot o una reconexión. */
  effectId: string;
  kind: "piece.earned" | "inventor.activated" | "adventure.finished";
  pieceId?: string;
  activityId?: string;
}

/** `group.state`: el estado de grupo, a todas las personas. Los resultados de cada persona no viajan aquí. */
export interface GroupSnapshot {
  roomGeneration: number;
  stateVersion: number;
  roundVersion: number;
  phase: RoomPhase;
  adventure: AdventureState;
  /** Efectos de la transición que originó este mensaje. Vacío en una sincronización o reconexión. */
  effects: EffectEvent[];
}

/** `me.state`: solo a su dueña. */
export interface MeSnapshot {
  roomGeneration: number;
  stateVersion: number;
  participant: ParticipantState;
}

/** Lo mínimo público de un personaje del laboratorio compartido. */
export interface PublicCharacter {
  principalId: string;
  displayName: string;
  color: string | null;
  connected: boolean;
  character: PlayerState;
}

/** `characters.state`: todos los personajes, al conectarse o sincronizar. `character.updated` envía solo el que cambió. */
export interface CharactersSnapshot {
  roomGeneration: number;
  characters: PublicCharacter[];
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
  observer: boolean;
  /** Cuenta en la ronda actual (lista fijada al abrirla, o incluida después). */
  inRound: boolean;
  /** Ya cumplió la exploración de la mesa actual. */
  ready: boolean;
  /** Avance en la mesa actual, por ejemplo 1 de 2 posiciones; `null` fuera de la exploración. */
  progress: { done: number; needed: number } | null;
  /** La pregunta que registró en el inventor (`presetId` si eligió una sugerida por las mesas), o `null` si aún no registra ninguna. */
  question: { presetId: string | null; text: string } | null;
}

/** `presence.updated`: solo a Vanessa. */
export interface PresenceUpdate {
  participants: ParticipantInfo[];
  connectedCount: number;
  /** El contador de la ronda: «18 de 24 listos». La lista se fija al abrir la ronda y una desconexión no reduce el total. */
  round: { ready: number; total: number };
}

/** `clock.sample`: el reloj de simulación, a todas las personas. Cada cliente interpola entre muestras; el servidor decide. */
export interface ClockSample {
  roomGeneration: number;
  stateVersion: number;
  activeMs: number;
  running: boolean;
  seq: number;
}

export type SyncResult =
  | { ok: true; stateVersion: number }
  | { ok: false; code: "ROOM_UNAVAILABLE" | "RATE_LIMITED" | "STALE_CONNECTION"; message: string };

export interface ServerToClientEvents {
  "room.summary": (summary: RoomSummary) => void;
  "group.state": (group: GroupSnapshot) => void;
  "me.state": (me: MeSnapshot) => void;
  "characters.state": (characters: CharactersSnapshot) => void;
  "character.updated": (character: PublicCharacter) => void;
  "presence.updated": (presence: PresenceUpdate) => void;
  "clock.sample": (sample: ClockSample) => void;
  "session.replaced": () => void;
}

export interface ClientToServerEvents {
  "admin.command": (command: AdminCommand, ack: (result: CommandResult) => void) => void;
  "participant.action": (command: ParticipantCommand, ack: (result: CommandResult) => void) => void;
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
  /** Acompaña la exposición sin jugar: queda fuera del contador de la ronda. */
  observer?: boolean;
}

export interface JoinRoomResponse {
  principalId: string;
  name: string;
  displayName: string;
  color: string;
  distinction: number;
  observer: boolean;
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
