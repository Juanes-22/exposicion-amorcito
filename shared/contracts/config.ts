import type { Footprint, Point } from "./geometry";

export type ConfigMode = "prototype" | "presentation";

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
  /** Pieza colectiva que se incorpora al inventor cuando termina la ronda de esta mesa (al abrir la siguiente). */
  pieceId: string;
  /** Objetivo corto que ve cada persona sobre el experimento (contenido editable, SPECS 9.1). */
  goal: string;
  /** Pregunta con la que Vanessa abre la mesa: se proyecta durante la preparación. */
  openingQuestion: string;
  /** Pregunta que conduce la conversación: se proyecta junto a la comparación seleccionada. */
  conversationQuestion: string;
  /** Paráfrasis breve de la idea de Freire que se trabaja en la mesa. Es una adaptación para la exposición, no una cita. */
  freirePhrase: string;
}

export interface ShadowsActivityConfig extends ActivityBase {
  type: "shadows";
  experiment: ShadowsExperiment;
}

export interface RampsActivityConfig extends ActivityBase {
  type: "ramps";
  experiment: RampsExperiment;
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
  /** Cuántos objetos compartidos hay que explorar para quedar lista. Pedir permiso es posible, nunca obligatorio. */
  requiredObjects: number;
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
  /** Mensaje de la pieza al incorporarse al inventor. */
  message: string;
}

export interface InventorConfig {
  /** Gráfico de la máquina con las piezas incorporadas. El apagado es el `assetId` del objeto Inventor en el TMJ. */
  activeAssetId: string;
  requiredPieceIds: string[];
  pieces: PieceConfig[];
  /** Pregunta con la que Vanessa abre el cierre: se proyecta junto a la máquina. */
  prompt: string;
  /** Mensaje de cierre una vez confirmada la pregunta final. */
  finalMessage: string;
  reflection: string[];
  /** Pregunta de reflexión con la que Vanessa puede cerrar de forma oral. */
  closingQuestion: string;
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
  /** Máximo de caracteres de una nota o síntesis de Vanessa. */
  maxRecordCharacters: number;
  labels: Record<string, string>;
}

/**
 * Textos de las fases comunes de cada ronda, de la espera y del cierre. Son contenido editable y obligatorio: el validador rechaza
 * los que falten. Las señales de audio (`signal*`) siguen siendo opcionales y tienen un texto de respaldo en el código.
 */
export const REQUIRED_LABELS = [
  "waiting",
  "loadingMap",
  "roundPreparationPhone",
  "roundExplorationPhone",
  "roundConversationPhone",
  "readyYou",
  "notReadyYou",
  "closingPhone",
  "finishedPhone",
  "observerPhone",
  "welcomePhone",
] as const;

/** Momentos con guion de Vanessa además de una entrada por mesa del recorrido. */
export const FACILITATOR_MOMENTS = ["bienvenida", "cierre"] as const;

/** Frases de apoyo de Vanessa (SPECS 12): una por momento de la conducción. */
export const SUPPORT_PHRASE_KEYS = ["inicio", "antesDeReunir", "alExplicar", "cierre"] as const;

/** Eventos sonoros que la aplicación sabe emitir (SPECS 10.4). `laboratorio.json → audio.events` asigna un recurso a cada uno. */
export const AUDIO_EVENT_IDS = ["shadows.click", "boxes.bell", "piece.earned", "inventor.activated", "adventure.finished"] as const;
export type AudioEventId = (typeof AUDIO_EVENT_IDS)[number];

export interface AudioConfig {
  phoneInitiallyMuted: boolean;
  /** evento → assetId (solo eventos de `AUDIO_EVENT_IDS`). Sin entrada, ese evento no suena (pero sigue teniendo su texto). */
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
  /** Frases de apoyo para conducir la exposición: claves de `SUPPORT_PHRASE_KEYS`. */
  supportPhrases: Record<string, string>;
  ui: UiConfig;
  audio: AudioConfig;
  session: SessionConfig;
}

/** Identificador reservado de la última estación del recorrido (`Inventor` en Tiled). */
export const INVENTOR_ID = "inventor";
