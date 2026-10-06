import type { Footprint, Point } from "./geometry";

export type ConfigMode = "prototype" | "presentation";

export interface SuggestedOption {
  id: string;
  text: string;
  /** Solo en La caja de las sorpresas: el objeto compartido al que remite la pregunta. */
  objectId?: string;
}

export interface ShadowsExperiment {
  sourceDistanceMinCm: number;
  sourceDistanceMaxCm: number;
  screenDistanceCm: number;
  objectHeightCm: number;
  /** Separación mínima entre dos muestras que cuentan para completar (SPECS 3.2). */
  minDistinctDistanceCm: number;
  requiredSamples: number;
}

export interface RampsExperiment {
  model: "solid-sphere-ideal-v1";
  minAngleDeg: number;
  maxAngleDeg: number;
  angleStepDeg: number;
  minDistinctAngleDeg: number;
  lengthMeters: number;
  visualTimeScale: number;
  requiredTrials: number;
}

interface ActivityBase {
  title: string;
  /** Pieza colectiva que concede completar la mesa. */
  pieceId: string;
  suggestions: SuggestedOption[];
  /** Indicación de cada paso, por nombre de paso. Es contenido editable: no vive en el código (SPECS 9.1). */
  prompts: Record<string, string>;
}

/** Pasos que necesitan indicación propia en cada tipo de mesa (los demás usan `firstPrompt` o un diálogo). */
export const REQUIRED_PROMPTS: Record<"shadows" | "ramps" | "boxes", readonly string[]> = {
  shadows: ["firstIdea", "explore", "observation", "nextQuestion"],
  ramps: ["question", "prediction", "trials", "observation"],
  boxes: ["exploreShared", "askPermission", "respect", "nextQuestion"],
};

export interface ShadowsActivityConfig extends ActivityBase {
  type: "shadows";
  /** Texto de la sorpresa inicial. */
  firstPrompt: string;
  experiment: ShadowsExperiment;
  /** Ideas sugeridas para el paso «primera idea». */
  ideaSuggestions: SuggestedOption[];
}

export interface RampsActivityConfig extends ActivityBase {
  type: "ramps";
  /** Línea del docente ficticio en la escena de respuesta cerrada. */
  firstPrompt: string;
  /** Línea de la guía que el docente ficticio pide copiar. */
  guideLine: string;
  experiment: RampsExperiment;
  inviteDialogueId: string;
}

export interface BoxesSharedObject {
  id: string;
  label: string;
  /** Texto equivalente de lo que se ve, se oye o se observa del objeto. */
  description: string;
}

export interface BoxesActivityConfig extends ActivityBase {
  type: "boxes";
  sharedObjects: BoxesSharedObject[];
  refusalDialogueId: string;
  /** Texto cuando se toca de nuevo la caja personal después de la negativa. */
  personalTouchDialogueId: string;
  /** Solo etiquetas: la caja personal no tiene contenido, ni asset, ni dato oculto (SPECS 3.4). */
  personalBox: { label: string; ownerLabel: string };
}

export type ActivityConfig = ShadowsActivityConfig | RampsActivityConfig | BoxesActivityConfig;
export type ActivityType = ActivityConfig["type"];

export interface PieceConfig {
  id: string;
  label: string;
  /** Mensaje de la animación de colocar piezas. */
  message: string;
}

export interface InventorConfig {
  /** Gráfico de la máquina encendida, una vez colocadas las piezas. El apagado es el `assetId` del objeto Inventor en el TMJ. */
  activeAssetId: string;
  requiredPieceIds: string[];
  pieces: PieceConfig[];
  /** Indicación antes de colocar las piezas (contenido editable). */
  placePrompt: string;
  /** Indicación de la pregunta final, una vez colocadas las piezas. */
  prompt: string;
  placeButtonLabel: string;
  oralQuestionText: string;
  finalMessage: string;
  reflection: string[];
}

export interface WorldConfig {
  mapPath: string;
  initialSpawnId: string;
  /** Unidades de mundo por segundo. */
  playerSpeed: number;
  player: {
    assetId: string;
    origin: Point;
    scale: number;
    footprint: Footprint;
  };
}

export interface ProjectConfig {
  title: string;
  subtitle: string;
  studentName: string;
  university: string;
  program: string;
  courseName: string;
  durationMinutes: number;
}

export interface UiConfig {
  assets: {
    button: string;
    buttonHover: string;
    panel: string;
    notebookIcon: string;
  };
  maxRecordCharacters: number;
  labels: Record<string, string>;
}

export interface AudioConfig {
  phoneInitiallyMuted: boolean;
  /** evento → assetId. Vacío mientras no existan sonidos finales (SPECS 13.2). */
  events: Record<string, string>;
}

export interface SessionConfig {
  maxParticipants: number;
  adminIdleTtlMs: number;
}

export interface LaboratorioConfig {
  $schema?: string;
  schemaVersion: 1;
  contentSetId: string;
  configRevision: string;
  mode: ConfigMode;
  project: ProjectConfig;
  world: WorldConfig;
  /** IDs de actividades, únicos y ordenados. Siempre seguidas del inventor. */
  route: string[];
  activities: Record<string, ActivityConfig>;
  inventor: InventorConfig;
  dialogues: Record<string, string>;
  facilitatorNotes: Record<string, string[]>;
  ui: UiConfig;
  audio: AudioConfig;
  session: SessionConfig;
}

/** Identificador reservado de la última estación del recorrido (`Inventor` en Tiled). */
export const INVENTOR_ID = "inventor";
