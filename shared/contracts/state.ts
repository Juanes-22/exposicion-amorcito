import type { Direction, Point } from "./geometry";

/** Estado de sala, aventura y registros. Es lo que se guarda en SQLite y lo que se envía en los snapshots autorizados (SPECS 4). */

export type RoomPhase = "welcome" | "running" | "paused" | "finished" | "closed" | "expired";
export type ResumePhase = "running" | "finished";

export type ControlOwner = { role: "admin"; principalId: string } | { role: "participant"; principalId: string } | null;

// ---- Registros del cuaderno --------------------------------------------------

export type Modality = "written" | "suggested" | "oral" | "uncertain";

export type RecordField =
  | "firstIdea"
  | "observation"
  | "nextQuestion" // Sombras
  | "question"
  | "prediction" // Rampas (observation también) y Cajas (question)
  | "finalQuestion"; // Inventor

export interface RecordVersion {
  revision: number;
  modality: Modality;
  text: string | null;
  optionId?: string;
  authorId: string;
  authorName: string;
  /** Marca temporal del servidor. */
  at: string;
}

export interface NotebookRecord {
  id: string;
  activityId: string;
  field: RecordField;
  modality: Modality;
  /** Texto confirmado; `null` en oral e incertidumbre (la interfaz usa el texto de `ui.labels`). Las sugerencias llevan el texto resuelto por el servidor. */
  text: string | null;
  optionId?: string;
  /** Objeto compartido al que se vincula una pregunta de Cajas. */
  objectId?: string;
  /** Pregunta guardada de la que procede la pregunta final del inventor. */
  sourceRecordId?: string;
  authorId: string;
  /** Nombre visible (con su distinción) en el momento de confirmar. */
  authorName: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Quién hizo la última edición, si hubo alguna; el autor original no cambia. */
  lastEditor?: { principalId: string; name: string };
  /** Versiones anteriores, de la más antigua a la más reciente. La primera idea de Sombras permanece identificable aquí y por su campo. */
  history: RecordVersion[];
}

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

// ---- Actividades -------------------------------------------------------------

export type ShadowsStep = "surprise" | "firstIdea" | "explore" | "observation" | "nextQuestion" | "completed";
export type RampsStep = "closedAnswer" | "question" | "prediction" | "trials" | "observation" | "completed";
export type BoxesStep = "exploreShared" | "askPermission" | "refusal" | "respect" | "nextQuestion" | "completed";

export interface ShadowSample {
  distanceCm: number;
  /** `true` si esta muestra cuenta para completar: se separa lo suficiente de las ya contadas. */
  counts: boolean;
  atActiveMs: number;
  authorId: string;
}

export interface ShadowsState {
  type: "shadows";
  step: ShadowsStep;
  distanceCm: number;
  samples: ShadowSample[];
  firstIdeaId?: string;
  observationId?: string;
  questionId?: string;
  /** Condiciones registradas al completar. */
  conditions?: { screenDistanceCm: number; objectHeightCm: number; sampleDistancesCm: number[] };
  completedAt?: string;
}

export type RampTrialState = "running" | "finished" | "cancelled";

export interface RampTrial {
  trialId: string;
  angleDeg: number;
  /** Condiciones congeladas al crear la prueba (SPECS 3.3). */
  model: string;
  lengthMeters: number;
  visualTimeScale: number;
  /** Duración de la simulación visual, en ms de reloj activo. */
  durationMs: number;
  startActiveMs: number;
  state: RampTrialState;
  /** Instante de reloj activo en que terminó (una sola vez, decidido por el servidor). */
  endedActiveMs?: number;
  startedBy: string;
}

export interface RampsState {
  type: "ramps";
  step: RampsStep;
  angleDeg: number;
  trials: RampTrial[];
  questionId?: string;
  predictionId?: string;
  observationId?: string;
  completedAt?: string;
}

export interface BoxesState {
  type: "boxes";
  step: BoxesStep;
  sharedOpen: boolean;
  inspected: string[];
  selectedObjectId?: string;
  questionId?: string;
  completedAt?: string;
}

export type ActivityState = ShadowsState | RampsState | BoxesState;

// ---- Aventura ----------------------------------------------------------------

export type AdventureView = { kind: "map" } | { kind: "activity"; activityId: string } | { kind: "final" };

export interface InventorState {
  piecesPlaced: boolean;
  finalQuestionId?: string;
}

export interface Timeline {
  /** Tiempo activo acumulado (ms): solo avanza mientras la sala puede jugar (invariante 6). */
  activeMs: number;
}

export interface AdventureState {
  mapId: string;
  player: PlayerState;
  view: AdventureView;
  /** Por ID de actividad del recorrido. */
  activities: Record<string, ActivityState>;
  notebook: NotebookRecord[];
  /** Derivado de las mesas completadas por el dominio; el cliente no lo escribe (invariante 4). */
  pieces: string[];
  inventor: InventorState;
  timeline: Timeline;
  /** Contadores para IDs deterministas y estables. */
  counters: { record: number; trial: number; plan: number };
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
  turnVersion: number;
  phase: RoomPhase;
  /** Solo en pausa: a qué fase se regresa. */
  resumePhase: ResumePhase | null;
  controlOwner: ControlOwner;
  adventure: AdventureState;
  createdAt: string;
}
