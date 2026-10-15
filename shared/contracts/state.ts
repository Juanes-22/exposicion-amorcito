import type { Direction, Point } from "./geometry";

/**
 * Estado de sala, ronda y participantes. Es lo que se guarda en SQLite. Se separan tres capas (propuesta de rondas, sección 9):
 * - La sala y la ronda (`AdventureState`): mesa actual, fase, piezas, cuaderno común y pregunta final. Solo las modifica Vanessa.
 * - Cada participante (`ParticipantState`): su personaje, su vista y sus pruebas. Solo las modifica esa persona.
 * - La presentación: la comparación que Vanessa selecciona para proyectar (`presentedNoteId`).
 * Nada de la capa personal se envía a las demás personas: cada una recibe solo la suya.
 */

export type RoomPhase = "welcome" | "running" | "paused" | "finished" | "closed" | "expired";
export type ResumePhase = "running" | "finished";

// ---- Movimiento --------------------------------------------------------------

export interface MovementPlan {
  planId: string;
  /** Puntos en coordenadas de pies; el primero es el origen del plan. */
  points: Point[];
  speed: number;
  /** Reloj activo (ms) en el que empezó el plan. */
  startActiveMs: number;
  lengthTotal: number;
}

export interface PlayerState {
  /** Pies al empezar el plan vigente o donde está parado si no hay plan. */
  feet: Point;
  facing: Direction;
  plan: MovementPlan | null;
}

// ---- Pruebas personales --------------------------------------------------------

/** Una posición de la linterna registrada al terminar un ajuste, con la sombra que produjo. */
export interface ShadowSample {
  distanceCm: number;
  /** Altura de la sombra calculada por el modelo compartido en el momento de registrar la posición. */
  shadowCm: number;
  /** `true` si esta muestra cuenta como comparación: se separa lo suficiente de las ya contadas. */
  counts: boolean;
  atActiveMs: number;
}

export interface ShadowsState {
  type: "shadows";
  samples: ShadowSample[];
}

export type RampTrialState = "running" | "finished" | "cancelled";

export interface RampTrial {
  trialId: string;
  angleDeg: number;
  /** Condiciones congeladas al crear la prueba. */
  model: string;
  lengthMeters: number;
  visualTimeScale: number;
  /** Duración de la simulación visual, en ms de reloj activo. */
  durationMs: number;
  startActiveMs: number;
  state: RampTrialState;
  /** Instante de reloj activo en que terminó (una sola vez, decidido por el servidor). */
  endedActiveMs?: number;
}

export interface RampsState {
  type: "ramps";
  trials: RampTrial[];
}

/** Lo que se puede observar en el cielo con el telescopio; las dos observaciones dejan lista a la persona. */
export type TelescopeTarget = "moon" | "stars";

export interface TelescopeState {
  type: "telescope";
  /** Hacia dónde mira el visor (centro, en unidades del panorama): reabrir la mesa vuelve a ese lugar. */
  x: number;
  y: number;
  /** Índice en `zoomLevels`: 0 general, 1 cercano. */
  zoom: number;
  /** Observaciones del cielo ya registradas, sin repetir. */
  observed: TelescopeTarget[];
  /** La cortina de la casa: se cierra una sola vez, al enfocar la ventana de cerca, y no se vuelve a abrir en esta partida. */
  curtain: "open" | "closed";
}

export type ActivityState = ShadowsState | RampsState | TelescopeState;

export type PersonalView = { kind: "map" } | { kind: "activity"; activityId: string };

export interface ParticipantState {
  character: PlayerState;
  view: PersonalView;
  /** Por ID de mesa del recorrido: las pruebas de esta persona. */
  activities: Record<string, ActivityState>;
}

// ---- Ronda ---------------------------------------------------------------------

/**
 * Fases comunes de cada mesa (propuesta, sección 4): preparación, exploración, conversación. Tras la última mesa llega el cierre:
 * el inventor con sus piezas y la pregunta final.
 */
export type RoundStage = "preparation" | "exploration" | "conversation" | "closing";

export interface RoundState {
  /** Posición en `route`; `route.length` es el cierre (inventor). */
  index: number;
  stage: RoundStage;
  /** Quiénes cuentan en esta ronda: se fija al abrir la exploración (no cambia si alguien se desconecta). Vacío antes. */
  roster: string[];
  /** Quiénes entraron después de abrir y Vanessa incluyó en esta ronda. */
  included: string[];
  /** Quiénes no habían terminado al pasar a la conversación con pendientes. Se conserva su trabajo; no se les concede finalización. */
  pendingAtConversation: string[];
  /** Vanessa ya mostró la frase de Freire de esta mesa en la proyección. */
  freireShown: boolean;
}

// ---- Cuaderno común ---------------------------------------------------------------

export type NoteKind = "initialIdea" | "synthesis" | "question" | "comparison" | "finalQuestion";

export interface NoteVersion {
  revision: number;
  text: string | null;
  at: string;
}

/** Resultados de una persona seleccionados para proyectar. Es una copia: seleccionar no altera el original (sección 9). */
export type ComparisonData =
  | { type: "shadows"; samples: Array<{ distanceCm: number; shadowCm: number }> }
  | { type: "ramps"; trials: Array<{ angleDeg: number; durationMs: number }> };

export interface Comparison {
  activityId: string;
  authorId: string;
  /** Nombre visible, con su distinción, en el momento de seleccionar. */
  authorName: string;
  data: ComparisonData;
}

export interface GroupNote {
  id: string;
  /** Mesa de la nota; en la pregunta final, el inventor. */
  activityId: string;
  kind: NoteKind;
  /** Texto escrito por Vanessa. `null` en una comparación (sus datos están en `comparison`). */
  text: string | null;
  comparison?: Comparison;
  /** Pregunta guardada de la que procede la pregunta final. */
  sourceNoteId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Versiones anteriores, de la más antigua a la más reciente. La idea inicial permanece identificable por su `kind`. */
  history: NoteVersion[];
}

// ---- Aventura (grupo) y sala ----------------------------------------------------------

export interface InventorState {
  finalQuestionId?: string;
}

export interface Timeline {
  /** Tiempo activo acumulado (ms): solo avanza con la sala en curso (invariante 6). */
  activeMs: number;
}

export interface AdventureState {
  mapId: string;
  round: RoundState;
  /** Mesas cuya ronda terminó con «Abrir siguiente mesa»: sus piezas ya están en el inventor. */
  completed: string[];
  /** Derivado de `completed` por el dominio; el cliente no lo escribe (invariante 4). */
  pieces: string[];
  notebook: GroupNote[];
  /** La nota de comparación que se proyecta ahora, o ninguna. */
  presentedNoteId: string | null;
  inventor: InventorState;
  timeline: Timeline;
  /** Contadores para IDs deterministas y estables. */
  counters: { note: number; trial: number; plan: number };
}

export interface RoomState {
  roomId: string;
  code: string;
  contentSetId: string;
  configRevision: string;
  configHash: string;
  mapHash: string;
  roomGeneration: number;
  stateVersion: number;
  /** Sube con cada cambio de ronda (abrir, conversar, avanzar, reiniciar): las acciones de una ronda cerrada llegan con la anterior y se rechazan. */
  roundVersion: number;
  phase: RoomPhase;
  /** Solo en pausa: a qué fase se regresa. */
  resumePhase: ResumePhase | null;
  adventure: AdventureState;
  /** Una entrada por participante que juega. Los observadores no tienen. */
  participants: Record<string, ParticipantState>;
  createdAt: string;
}
