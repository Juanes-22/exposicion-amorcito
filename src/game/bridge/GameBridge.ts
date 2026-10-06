import type { BridgeEventName, BridgeEvents, BridgePermissions, VisualSnapshot } from "./events";
import type { SimulationFrame } from "../../../shared/contracts/events";
import { isPlayable } from "../../../shared/domain/room";
import { ClientClock } from "./ClientClock";

type Handler<K extends BridgeEventName> = (payload: BridgeEvents[K]) => void;

/**
 * Puente tipado, acotado al ciclo de vida del host (una instancia por Phaser.Game). Los eventos son avisos, no la fuente de
 * verdad: por eso conserva el último snapshot, permisos y frame para quien arranque después del emisor (SPECS 10.2).
 */
export class GameBridge {
  private handlers = new Map<BridgeEventName, Set<(payload: never) => void>>();
  private tokenCounter = 0;
  private activeToken = 0;
  private lastSnapshot: VisualSnapshot | null = null;
  private lastPermissions: BridgePermissions | null = null;
  private lastFrame: SimulationFrame | null = null;
  /** Reloj de simulación del cliente: lo ajustan snapshots y frames; la escena dibuja desde él. */
  readonly clock: ClientClock;

  constructor(clock: ClientClock = new ClientClock()) {
    this.clock = clock;
  }

  /** Suscribe y devuelve la función que retira exactamente esa suscripción. */
  on<K extends BridgeEventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as (payload: never) => void);
    return () => void set.delete(handler as (payload: never) => void);
  }

  emit<K extends BridgeEventName>(event: K, payload: BridgeEvents[K]): void {
    if (event === "app:snapshot") {
      const snap = payload as VisualSnapshot;
      this.lastSnapshot = snap;
      this.lastFrame = null; // un snapshot nuevo invalida muestras de planes o pruebas anteriores
      // En pausa o sin propietario el reloj queda quieto exactamente en el valor del servidor: reanudar no suma la conversación.
      this.clock.setSnapshot(snap.state.adventure.timeline.activeMs, isPlayable(snap.state));
    }
    if (event === "app:permissions") this.lastPermissions = payload as BridgePermissions;
    if (event === "app:frame") {
      this.lastFrame = payload as SimulationFrame;
      this.clock.setFrame((payload as SimulationFrame).activeMs);
    }
    // Copia: un manejador puede darse de baja mientras se emite.
    for (const handler of [...(this.handlers.get(event) ?? [])]) (handler as Handler<K>)(payload);
  }

  /** Nueva instancia de escena: invalida los mensajes de la anterior. */
  beginScene(): number {
    this.activeToken = ++this.tokenCounter;
    return this.activeToken;
  }

  isActive(token: number): boolean {
    return token === this.activeToken;
  }

  get snapshot(): VisualSnapshot | null {
    return this.lastSnapshot;
  }
  get permissions(): BridgePermissions | null {
    return this.lastPermissions;
  }
  get frame(): SimulationFrame | null {
    return this.lastFrame;
  }

  listenerCount(event?: BridgeEventName): number {
    if (event) return this.handlers.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  /** Al destruir el host: libera las suscripciones de este puente, no las de otros componentes. */
  dispose(): void {
    this.handlers.clear();
    this.lastSnapshot = null;
    this.lastPermissions = null;
    this.lastFrame = null;
    this.activeToken = 0;
    this.clock.freeze();
  }
}
