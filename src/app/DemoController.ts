import type { ProjectBundle } from "../../shared/config/validateProject";
import type { AdminAction, AdventureAction, CommandResult } from "../../shared/contracts/actions";
import type { PublicController, RoomSnapshot, RoomSummary, SimulationFrame } from "../../shared/contracts/events";
import type { RoomPhase, RoomState } from "../../shared/contracts/state";
import { buildSimulationFrame, isSimulating } from "../../shared/domain/frames";
import { applyAdminAction, applyAdventureAction, createRoomState, isPlayable, onAdminLost, tickRoom, type PresenceView } from "../../shared/domain/room";
import type { Notice, RoomClientState, RoomPort } from "./RoomController";

/** Espacio de almacenamiento PROPIO de la demostración: nunca comparte clave con una sala (`…:sala:CÓDIGO`) ni con sus borradores. */
export const DEMO_STORAGE_KEY = "laboratorio-cosas-cotidianas:v1:demo:estado";
export const DEMO_CODE = "DEMO";
const DEMO_ROOM_ID = "demo";
const DEMO_ADMIN_ID = "demo-vanessa";
const DEMO_ADMIN_NAME = "Vanessa";

export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DemoOptions {
  /** `null` desactiva la persistencia (pruebas); por defecto, el almacenamiento local del navegador. */
  storage?: DemoStorage | null;
  mono?: () => number;
  now?: () => Date;
  /** Cada cuánto corre el bucle de simulación local (ms); `0` lo desactiva (pruebas llaman a `tick()`). */
  tickMs?: number;
  checkpointMs?: number;
}

type Listener = () => void;
const PHASES: readonly RoomPhase[] = ["welcome", "running", "paused", "finished"];

/** ¿Lo guardado tiene la forma de un estado de la demostración de ESTE paquete? Si no, se empieza de cero en vez de arriesgar. */
function isPlausible(room: unknown, bundle: ProjectBundle): room is RoomState {
  if (typeof room !== "object" || room === null) return false;
  const r = room as Partial<RoomState>;
  const a = r.adventure;
  return (
    r.roomId === DEMO_ROOM_ID &&
    r.code === DEMO_CODE &&
    r.contentSetId === bundle.config.contentSetId &&
    typeof r.roomGeneration === "number" &&
    typeof r.stateVersion === "number" &&
    typeof r.turnVersion === "number" &&
    PHASES.includes(r.phase as RoomPhase) &&
    typeof a === "object" &&
    a !== null &&
    a.mapId === bundle.map.mapId &&
    Array.isArray(a.notebook) &&
    typeof a.activities === "object" &&
    typeof a.player === "object" &&
    typeof a.timeline?.activeMs === "number"
  );
}

/**
 * Demostración local (SPECS 6.4, PLAN P6-05). Usa EL MISMO dominio que el servidor (las mismas funciones puras de `shared/domain`):
 * solo sustituye el transporte (no hay sockets ni `fetch`) y la persistencia (un espacio de almacenamiento propio). Vanessa es a la vez
 * administradora y quien explora. El estado es independiente de cualquier sala: no hay credenciales, ni IDs de sala compartida, y al
 * volver a la conexión no se mezcla ni se sincroniza nada.
 */
export class DemoController implements RoomPort {
  private listeners = new Set<Listener>();
  private frameListeners = new Set<(f: SimulationFrame) => void>();
  private room: RoomState;
  private state: RoomClientState;
  private noticeId = 0;
  private requestSeq = 0;
  private frameSeq = 0;
  private anchor: number;
  private lastCheckpoint: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly storage: DemoStorage | null;
  private readonly mono: () => number;
  private readonly now: () => Date;
  private readonly tickMs: number;
  private readonly checkpointMs: number;
  private readonly presence: PresenceView = { isConnected: (id) => id === DEMO_ADMIN_ID, isParticipant: () => false };

  constructor(
    private readonly bundle: ProjectBundle,
    options: DemoOptions = {},
  ) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.mono = options.mono ?? (() => performance.now());
    this.now = options.now ?? (() => new Date());
    this.tickMs = options.tickMs ?? 100;
    this.checkpointMs = options.checkpointMs ?? 500;
    this.anchor = this.mono();
    this.lastCheckpoint = this.anchor;
    this.room = this.load() ?? this.fresh();
    this.state = this.buildState(null);
  }

  // ---- estado observable (mismo contrato que RoomController) ----

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getState = (): RoomClientState => this.state;
  subscribeFrames = (listener: (f: SimulationFrame) => void): (() => void) => {
    this.frameListeners.add(listener);
    return () => void this.frameListeners.delete(listener);
  };

  notify(kind: Notice["kind"], text: string): void {
    this.set({ notice: { id: ++this.noticeId, kind, text } });
  }
  clearNotice(id: number): void {
    if (this.state.notice?.id === id) this.set({ notice: null });
  }

  /** Arranca el bucle local. Idempotente; con `tickMs <= 0` no hay temporizador (las pruebas llaman a `tick()`). */
  connect(): void {
    if (this.timer || this.disposed || this.tickMs <= 0) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Lo último que se vio queda guardado: recargar la demostración no pierde nada confirmado.
    this.save(this.settled(this.mono()));
    this.listeners.clear();
    this.frameListeners.clear();
  }

  // ---- comandos: el mismo dominio, sin servidor ----

  adventure(action: AdventureAction): Promise<CommandResult> {
    const at = this.mono();
    const change = applyAdventureAction(this.room, action, {
      config: this.bundle.config,
      map: this.bundle.map,
      nav: this.bundle.nav,
      actor: { principalId: DEMO_ADMIN_ID, role: "admin", name: DEMO_ADMIN_NAME },
      roomGeneration: this.room.roomGeneration,
      nowIso: this.now().toISOString(),
      activeMs: this.liveActiveMs(at),
    });
    if (!change.ok) return Promise.resolve(this.denied(change.code, change.message));
    if (change.changed) this.commit(change.room, at);
    return Promise.resolve(this.accepted());
  }

  admin(action: AdminAction): Promise<CommandResult> {
    const at = this.mono();
    const change = applyAdminAction(this.settled(at), action, { adminId: DEMO_ADMIN_ID, presence: this.presence, config: this.bundle.config, map: this.bundle.map, fingerprint: { configHash: this.bundle.configHash, mapHash: this.bundle.mapHash } });
    if (!change.ok) return Promise.resolve(this.denied(change.code, change.message));
    let next = change.room;
    // «Reiniciar la demostración» vuelve directamente al mapa: Vanessa no tiene a quién dar el turno ni «comenzar» que pulsar.
    if (action.type === "room.reset") next = this.begin(next);
    if (change.changed) this.commit(next, at);
    return Promise.resolve(this.accepted());
  }

  /** Empezar de cero a petición (equivale a reiniciar). */
  restart(): Promise<CommandResult> {
    return this.admin({ type: "room.reset", confirm: true });
  }

  // ---- bucle de simulación local ----

  /** Un paso del bucle: termina movimientos y pruebas por reloj, guarda checkpoints y emite la muestra visual. */
  tick(): void {
    if (this.disposed || !isSimulating(this.room)) return;
    const at = this.mono();
    const t = tickRoom(this.room, this.liveActiveMs(at), this.bundle.config);
    if (t.changed) {
      this.commit(t.room, at);
    } else if (at - this.lastCheckpoint >= this.checkpointMs) {
      this.room = t.room;
      this.anchor = at;
      this.lastCheckpoint = at;
      this.save(this.room);
    }
    if (isSimulating(this.room)) {
      const frame = buildSimulationFrame(this.room, this.liveActiveMs(at), ++this.frameSeq);
      if (frame) for (const l of [...this.frameListeners]) l(frame);
    }
  }

  // ---- internos ----

  private fresh(): RoomState {
    const { config, map } = this.bundle;
    const created = createRoomState({ roomId: DEMO_ROOM_ID, code: DEMO_CODE, config, map, configHash: this.bundle.configHash, mapHash: this.bundle.mapHash, nowIso: this.now().toISOString() });
    return this.begin(created);
  }

  /** Vanessa toma el control y comienza: el recorrido arranca en el mapa. */
  private begin(room: RoomState): RoomState {
    const ctx = { adminId: DEMO_ADMIN_ID, presence: this.presence, config: this.bundle.config, map: this.bundle.map, fingerprint: { configHash: this.bundle.configHash, mapHash: this.bundle.mapHash } };
    let next = room;
    for (const action of [{ type: "control.take" }, { type: "room.start" }] as AdminAction[]) {
      const r = applyAdminAction(next, action, ctx);
      if (r.ok) next = r.room;
    }
    return next;
  }

  /** Recupera lo guardado. Como con una recarga de Vanessa en una sala, vuelve PAUSADO y sin sumar el tiempo transcurrido. */
  private load(): RoomState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(DEMO_STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as { v?: unknown; configHash?: unknown; mapHash?: unknown; room?: unknown };
      if (saved.v !== 1 || saved.configHash !== this.bundle.configHash || saved.mapHash !== this.bundle.mapHash || !isPlausible(saved.room, this.bundle)) return null;
      const paused = onAdminLost(saved.room);
      return paused.ok ? paused.room : saved.room;
    } catch {
      return null; // almacenamiento no disponible o contenido dañado: se empieza de cero
    }
  }

  private save(room: RoomState): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ v: 1, configHash: this.bundle.configHash, mapHash: this.bundle.mapHash, room }));
    } catch {
      /* sin almacenamiento la demostración sigue en memoria mientras no se recargue la página */
    }
  }

  private liveActiveMs(at: number): number {
    const base = this.room.adventure.timeline.activeMs;
    return isPlayable(this.room) ? base + Math.max(0, at - this.anchor) : base;
  }

  private settled(at: number): RoomState {
    return tickRoom(this.room, this.liveActiveMs(at), this.bundle.config).room;
  }

  /** Una transición confirmada: se guarda y se anuncia con su ancla de reloj. */
  private commit(next: RoomState, at: number): void {
    this.room = next;
    this.anchor = at;
    this.lastCheckpoint = at;
    this.save(next);
    this.set(this.buildState(this.state.notice));
  }

  private accepted(): CommandResult {
    return { ok: true, requestId: `demo-${++this.requestSeq}`, stateVersion: this.room.stateVersion, turnVersion: this.room.turnVersion };
  }

  private denied(code: Extract<CommandResult, { ok: false }>["code"], message: string): CommandResult {
    this.notify("error", message);
    return { ok: false, requestId: `demo-${++this.requestSeq}`, code, message };
  }

  private set(patch: Partial<RoomClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private controller(): PublicController | null {
    return this.room.controlOwner ? { principalId: DEMO_ADMIN_ID, role: "admin", displayName: DEMO_ADMIN_NAME, color: null } : null;
  }

  private buildState(notice: Notice | null): RoomClientState {
    const s = this.room;
    const summary: RoomSummary = {
      code: DEMO_CODE,
      roomGeneration: s.roomGeneration,
      stateVersion: s.stateVersion,
      turnVersion: s.turnVersion,
      phase: s.phase,
      resumePhase: s.resumePhase,
      controller: this.controller(),
      adminConnected: true,
      configMismatch: false,
      self: { principalId: DEMO_ADMIN_ID, role: "admin", displayName: DEMO_ADMIN_NAME, color: null, connectionEpoch: 1, isController: s.controlOwner?.principalId === DEMO_ADMIN_ID },
    };
    const snapshot: RoomSnapshot = { state: s, controller: this.controller(), effects: [] };
    return { status: "connected", summary, presence: null, snapshot, pending: 0, notice };
  }
}

function browserStorage(): DemoStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
