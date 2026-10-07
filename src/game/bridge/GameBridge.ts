import type { BridgeEventName, BridgeEvents, BridgePermissions, LocalExperiment, VisualState } from "./events";
import { ClientClock } from "./ClientClock";

type Handler<K extends BridgeEventName> = (payload: BridgeEvents[K]) => void;

/**
 * Puente tipado, acotado al ciclo de vida del host (una instancia por Phaser.Game). Los eventos son avisos, no la fuente de
 * verdad: por eso conserva el último estado visual y los permisos para quien arranque después del emisor (SPECS 10.2).
 */
export class GameBridge {
  private handlers = new Map<BridgeEventName, Set<(payload: never) => void>>();
  private tokenCounter = 0;
  private activeToken = 0;
  private lastVisual: VisualState | null = null;
  private lastPermissions: BridgePermissions | null = null;
  private lastLocal: LocalExperiment = { lanternCm: null, angleDeg: null };
  /** Reloj de simulación del cliente: lo ajustan el estado y las muestras del servidor; la escena dibuja desde él. */
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
    // El reloj lo ajustan SOLO las muestras del servidor (`app:clock`): el estado de grupo lleva el tiempo del último guardado y, si
    // se usara aquí, el reloj retrocedería cada vez que llega un cambio personal. Con la sala fuera de curso la muestra llega con
    // `running: false` y el reloj queda quieto: reanudar no suma la conversación.
    if (event === "app:visual") this.lastVisual = payload as VisualState;
    if (event === "app:permissions") this.lastPermissions = payload as BridgePermissions;
    if (event === "app:local") this.lastLocal = payload as LocalExperiment;
    if (event === "app:clock") {
      const c = payload as BridgeEvents["app:clock"];
      if (c.running) this.clock.setFrame(c.activeMs);
      else this.clock.setSnapshot(c.activeMs, false);
    }
    // Copia: un manejador puede darse de baja mientras se emite.
    for (const handler of [...(this.handlers.get(event) ?? [])]) (handler as Handler<K>)(payload);
  }

  /** Ajusta lo local de un experimento (linterna, inclinación): lo leen las escenas en cada fotograma. */
  setLocal(patch: Partial<LocalExperiment>): void {
    this.emit("app:local", { ...this.lastLocal, ...patch });
  }

  /** Nueva instancia de escena: invalida los mensajes de la anterior. */
  beginScene(): number {
    this.activeToken = ++this.tokenCounter;
    return this.activeToken;
  }

  isActive(token: number): boolean {
    return token === this.activeToken;
  }

  get visual(): VisualState | null {
    return this.lastVisual;
  }
  get permissions(): BridgePermissions | null {
    return this.lastPermissions;
  }
  get local(): LocalExperiment {
    return this.lastLocal;
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
    this.lastVisual = null;
    this.lastPermissions = null;
    this.lastLocal = { lanternCm: null, angleDeg: null };
    this.activeToken = 0;
    this.clock.freeze();
  }
}
