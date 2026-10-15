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
  /**
   * Nombre de cada inclinación, de la menos a la más empinada (una por paso entre `minAngleDeg` y `maxAngleDeg`). Es lo único que ven las
   * personas: la mesa no muestra grados ni tiempos (que se pregunten cuánto demoró la pelota).
   */
  angleLabels: string[];
}

interface ActivityBase {
  title: string;
  /** Pieza colectiva que se incorpora al inventor cuando termina la ronda de esta mesa (al abrir la siguiente). */
  pieceId: string;
  /** Objetivo corto que ve cada persona sobre el experimento (contenido editable, SPECS 9.1). */
  goal: string;
  /** Pregunta de la mesa: se proyecta junto al laboratorio al abrirla, mientras las personas exploran. */
  openingQuestion: string;
  /** Pregunta que conduce la conversación: se proyecta al reunir al grupo con «Conversemos». */
  conversationQuestion: string;
  /** Paráfrasis breve de la idea de Freire que se trabaja en la mesa. Es una adaptación para la exposición, no una cita. */
  freirePhrase: string;
  /**
   * Pregunta que se proyecta con la frase de Freire, en lugar de la de conversación. En El observatorio, la frase llega con la casa: la
   * pregunta sobre la cortina no se adelanta a la demostración.
   */
  freireQuestion?: string;
  /** Texto para quien ya quedó lista en esta mesa. Si falta, se usa `ui.labels.readyYou`. */
  readyText?: string;
}

export interface ShadowsActivityConfig extends ActivityBase {
  type: "shadows";
  experiment: ShadowsExperiment;
}

export interface RampsActivityConfig extends ActivityBase {
  type: "ramps";
  experiment: RampsExperiment;
}

/**
 * El observatorio (SPECS 3.4): un telescopio que mira un panorama nocturno. La disposición del panorama (Luna, estrellas, tejados y la
 * casa) vive en `shared/domain/telescope.ts`, porque el servidor la usa para validar las observaciones; aquí van los valores que se
 * ajustan en un ensayo.
 */
export interface TelescopeExperiment {
  /** Los dos aumentos, de menor a mayor: el general, con el que se entra, y el cercano. */
  zoomLevels: [number, number];
  /** Radio de lo que se ve por el visor, en unidades del panorama, con el aumento 1. */
  fieldRadius: number;
  /** Zona central del visor donde un objetivo cuenta como «centrado», en fracción del radio visible. */
  centerTolerance: number;
  /** Cuánto tiene que quedar centrado un objetivo del cielo para registrar la observación (ms). */
  dwellMs: number;
  /** Enfoque cercano de la ventana antes de que la persona de la casa reaccione (ms). */
  curtainDelayMs: number;
  /** Duración del gesto de girarse y cerrar la cortina (ms). */
  curtainCloseMs: number;
}

export interface TelescopeActivityConfig extends ActivityBase {
  type: "telescope";
  experiment: TelescopeExperiment;
}

export type ActivityConfig = ShadowsActivityConfig | RampsActivityConfig | TelescopeActivityConfig;
export type ActivityType = ActivityConfig["type"];

export interface PieceConfig {
  id: string;
  label: string;
  /** Mensaje de la pieza al incorporarse al inventor. */
  message: string;
}

/** Pregunta sugerida para el inventor, nacida de una mesa del recorrido: cada persona puede elegirla como su pregunta. */
export interface InventorQuestionConfig {
  id: string;
  /** Mesa de la que nace la pregunta (se agrupan por mesa, en el orden del recorrido). */
  activityId: string;
  text: string;
}

export interface InventorConfig {
  /** Gráfico de la máquina con las piezas incorporadas. El apagado es el `assetId` del objeto Inventor en el TMJ. */
  activeAssetId: string;
  requiredPieceIds: string[];
  pieces: PieceConfig[];
  /** Pregunta con la que Vanessa abre el cierre: se proyecta junto a la máquina y encabeza las preguntas en cada celular. */
  prompt: string;
  /** Preguntas sugeridas por mesa: cada persona elige una o escribe la suya, y Vanessa las ve todas para elegir la final. */
  questions: InventorQuestionConfig[];
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
  /** Pregunta de entrada de la guía de Vanessa: es lo único que se proyecta al comenzar, mientras las personas van a la primera mesa. */
  entryQuestion: string;
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
  "inventorOpenPhone",
  "finishedPhone",
  "observerPhone",
  "welcomePhone",
] as const;

/** Eventos sonoros que la aplicación sabe emitir (SPECS 10.4). `laboratorio.json → audio.events` asigna un recurso a cada uno. */
export const AUDIO_EVENT_IDS = ["shadows.click", "piece.earned", "inventor.activated", "adventure.finished"] as const;
export type AudioEventId = (typeof AUDIO_EVENT_IDS)[number];

export interface AudioConfig {
  /** `true`: el teléfono empieza en silencio aunque el sonido esté activado por defecto (hay que pulsar «Activar sonido»). */
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
  ui: UiConfig;
  audio: AudioConfig;
  session: SessionConfig;
}

/** Identificador reservado de la última estación del recorrido (`Inventor` en Tiled). */
export const INVENTOR_ID = "inventor";
