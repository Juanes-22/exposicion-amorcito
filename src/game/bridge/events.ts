import type { AdventureAction } from "../../../shared/contracts/actions";
import type { EffectEvent, PublicController, RoomSnapshot, SimulationFrame } from "../../../shared/contracts/events";
import type { ConfigIssue } from "../../../shared/contracts/assets";

/** Un asset gráfico que no cargó: el ID del catálogo y la URL resuelta. */
export interface AssetFailure {
  assetId: string;
  url: string;
}

/** Qué puede hacer quien tiene delante la escena y por qué no (SPECS 10.2). */
export interface BridgePermissions {
  canAct: boolean;
  /** Motivo legible cuando `canAct` es falso: pausa, sin turno, conexión perdida… */
  reason: string | null;
}

/** Estado visual que la aplicación entrega a Phaser: pinta, nunca decide (SPECS 7.2). */
export interface VisualSnapshot {
  state: RoomSnapshot["state"];
  controller: PublicController | null;
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
  "game:action-request": { action: AdventureAction; requestId: string; token: number };
  "game:asset-failures": { failures: AssetFailure[]; token: number };
  "game:invalid-project": { issues: ConfigIssue[] };

  "app:snapshot": VisualSnapshot;
  /** Muestra visual y reloj; no debe renderizar el árbol de React por cada posición. */
  "app:frame": SimulationFrame;
  "app:permissions": BridgePermissions;
  /** Una solicitud se resuelve una sola vez; una denegación también libera el bloqueo temporal. */
  "app:request-result": { requestId: string; accepted: boolean; reason?: string };
  /** Animación o sonido tras una transición confirmada, con ID único. */
  "app:effect": EffectEvent;
}

export type BridgeEventName = keyof BridgeEvents;
