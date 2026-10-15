import type { ClockSample, EffectEvent, PublicCharacter } from "../../../shared/contracts/events";
import type { Point } from "../../../shared/contracts/geometry";
import type { ConfigIssue } from "../../../shared/contracts/assets";
import type { AdventureState, ParticipantState, RoomPhase } from "../../../shared/contracts/state";
import type { TelescopeView } from "../../../shared/domain/telescope";

/**
 * Intención del jugador sobre el mapa, ya en coordenadas de MUNDO (la conversión pantalla→mundo la hace la escena con su cámara).
 * La aplicación decide si la envía como comando; Phaser nunca habla con el servidor.
 */
export type MapIntent = { type: "move"; target: Point } | { type: "openStation"; stationId: string };

/** Un asset gráfico que no cargó: el ID del catálogo y la URL resuelta. */
export interface AssetFailure {
  assetId: string;
  url: string;
}

/** Qué puede hacer quien tiene delante la escena y por qué no (SPECS 10.2). */
export interface BridgePermissions {
  /** Puede caminar por el laboratorio: preparación, exploración o cierre (hasta el inventor), con la sala en curso. */
  canMove: boolean;
  /** Puede abrir la mesa habilitada y explorarla (solo durante la exploración) o entrar al inventor abierto. */
  canExplore: boolean;
  /** Motivo legible cuando no puede: pausa, conversación, conexión perdida… */
  reason: string | null;
}

/**
 * Quién mira la escena. Una persona ve SU estado personal (sus pruebas); la proyección ve el estado de grupo y, durante una
 * demostración de Vanessa, su estado de demostración (que nunca toca el de las personas); un observador solo ve el grupo.
 */
export type Viewer =
  | { kind: "participant"; principalId: string; me: ParticipantState }
  | { kind: "projection"; demo: ParticipantState | null }
  | { kind: "observer" };

/** Estado visual que la aplicación entrega a Phaser: pinta, nunca decide (SPECS 7.2). */
export interface VisualState {
  phase: RoomPhase;
  group: AdventureState;
  viewer: Viewer;
  /** Los personajes de todas las personas del laboratorio compartido. */
  characters: PublicCharacter[];
}

/**
 * Lo que solo existe en el dispositivo mientras alguien ajusta un experimento y todavía no se registra: la posición de la linterna, la
 * inclinación elegida y hacia dónde mira el telescopio. No viaja al servidor mientras se mueve: solo lo ya terminado (o la vista quieta)
 * se registra.
 */
export interface LocalExperiment {
  lanternCm: number | null;
  angleDeg: number | null;
  telescope: TelescopeView | null;
}

/**
 * Contrato del puente entre Phaser y la aplicación (SPECS 10.2). Los nombres son de esta aplicación, no de Phaser.
 * `token` identifica la instancia de escena: se descartan los mensajes de una escena ya sustituida.
 */
export interface BridgeEvents {
  "game:ready": { sceneKey: string; token: number };
  /** Avance (0..1) de la carga esencial: la aplicación lo muestra hasta que llega `game:ready`. */
  "game:load-progress": { value: number };
  /** Intención tipada desde el mapa o la escena; la aplicación decide si la envía y resuelve `requestId`. */
  "game:action-request": { intent: MapIntent; requestId: string; token: number };
  "game:asset-failures": { failures: AssetFailure[]; token: number };
  /** Se tocó una decoración con `tapEvent` (la flor de la esquina): la aplicación suena ese evento. Es local: no viaja al servidor. */
  "game:decoration-tap": { event: string; token: number };
  "game:invalid-project": { issues: ConfigIssue[] };

  "app:visual": VisualState;
  /** Muestra del reloj de simulación; no debe renderizar el árbol de React por cada una. */
  "app:clock": ClockSample;
  /** Cambio de lo que solo existe en el dispositivo (linterna, inclinación elegida). */
  "app:local": LocalExperiment;
  "app:permissions": BridgePermissions;
  /** Una solicitud se resuelve una sola vez; una denegación también libera el bloqueo temporal. */
  "app:request-result": { requestId: string; accepted: boolean; reason?: string };
  /** Animación o sonido tras una transición confirmada, con ID único. */
  "app:effect": EffectEvent;
}

export type BridgeEventName = keyof BridgeEvents;
