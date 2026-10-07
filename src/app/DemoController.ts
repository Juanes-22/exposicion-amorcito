import type { ProjectBundle } from "../../shared/config/validateProject";
import type { AdminAction, CommandResult, ParticipantAction } from "../../shared/contracts/actions";
import type { ClockSample, EffectEvent, GroupSnapshot, ParticipantInfo, PresenceUpdate, RoomSummary } from "../../shared/contracts/events";
import { PARTICIPANT_COLORS } from "../../shared/contracts/limits";
import type { RoomPhase, RoomState } from "../../shared/contracts/state";
import { isClockRunning } from "../../shared/domain/change";
import { applyAdminAction, applyParticipantAction, createRoomState, ensureParticipant, isSimulating, onAdminLost, tickRoom } from "../../shared/domain/room";
import { currentActivityId, roundCounter, roundMembers } from "../../shared/domain/round";
import { personReadiness } from "../../shared/domain/results";
import type { Notice, RoomClientState, RoomPort } from "./RoomController";

/** Espacio de almacenamiento PROPIO de la demostración: nunca comparte clave con una sala (`…:sala:CÓDIGO`). */
export const DEMO_STORAGE_KEY = "laboratorio-cosas-cotidianas:v1:demo:estado";
export const DEMO_CODE = "DEMO";
const DEMO_ROOM_ID = "demo";
const DEMO_ID = "demo-vanessa";
const DEMO_NAME = "Vanessa";
const DEMO_COLOR = PARTICIPANT_COLORS[0].id;
/** Versión del formato guardado: la 1 era el modelo de un solo turno y ya no se puede reanudar. */
const SAVED_VERSION = 2;

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
    typeof r.roundVersion === "number" &&
    PHASES.includes(r.phase as RoomPhase) &&
    typeof r.participants === "object" &&
    r.participants !== null &&
    r.participants[DEMO_ID] !== undefined &&
    typeof a === "object" &&
    a !== null &&
    a.mapId === bundle.map.mapId &&
    Array.isArray(a.notebook) &&
    typeof a.round === "object" &&
    typeof a.timeline?.activeMs === "number"
  );
}

/**
 * Demostración local (SPECS 6.4, PLAN P6-05). Usa EL MISMO dominio que el servidor (las mismas funciones puras de `shared/domain`):
 * solo sustituye el transporte (no hay sockets ni `fetch`) y la persistencia (un espacio de almacenamiento propio). Vanessa es a la vez
 * quien conduce la ronda y la única persona que explora, con su personaje en el laboratorio. El estado es independiente de cualquier
 * sala: no hay credenciales, ni IDs de sala compartida, y al volver a la conexión no se mezcla ni se sincroniza nada.
 */
export class DemoController implements RoomPort {
  private listeners = new Set<Listener>();
  private clockListeners = new Set<(s: ClockSample) => void>();
  private room: RoomState;
  private state: RoomClientState;
  private noticeId = 0;
  private requestSeq = 0;
  private clockSeq = 0;
  private anchor: number;
  private lastCheckpoint: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly storage: DemoStorage | null;
  private readonly mono: () => number;
  private readonly now: () => Date;
  private readonly tickMs: number;
  private readonly checkpointMs: number;

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
    this.state = this.buildState(null, []);
  }

  // ---- estado observable (mismo contrato que RoomController) ----

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getState = (): RoomClientState => this.state;
  subscribeClock = (listener: (s: ClockSample) => void): (() => void) => {
    this.clockListeners.add(listener);
    return () => void this.clockListeners.delete(listener);
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
    this.emitClock(this.mono());
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Lo último que se vio queda guardado: recargar la demostración no pierde nada confirmado.
    this.save(this.settled(this.mono()));
    this.listeners.clear();
    this.clockListeners.clear();
  }

  // ---- comandos: el mismo dominio, sin servidor ----

  act(action: ParticipantAction): Promise<CommandResult> {
    const at = this.mono();
    const live = this.liveActiveMs(at);
    const change = applyParticipantAction(this.settled(at), DEMO_ID, action, { config: this.bundle.config, map: this.bundle.map, nav: this.bundle.nav, activeMs: live });
    if (!change.ok) return Promise.resolve(this.denied(change.code, change.message));
    if (change.changed) this.commit(change.room, at, change.effects);
    return Promise.resolve(this.accepted());
  }

  admin(action: AdminAction): Promise<CommandResult> {
    const at = this.mono();
    const live = this.liveActiveMs(at);
    const change = applyAdminAction(this.settled(at), action, {
      config: this.bundle.config,
      map: this.bundle.map,
      nowIso: this.now().toISOString(),
      activeMs: live,
      nameOf: () => DEMO_NAME,
      fingerprint: { configHash: this.bundle.configHash, mapHash: this.bundle.mapHash },
    });
    if (!change.ok) return Promise.resolve(this.denied(change.code, change.message));
    let next = change.room;
    // «Reiniciar la demostración» vuelve directamente a la primera mesa: Vanessa no tiene a quién esperar ni «comenzar» que pulsar.
    if (action.type === "room.reset") next = this.begin(next);
    if (change.changed) this.commit(next, at, change.effects);
    return Promise.resolve(this.accepted());
  }

  /** Empezar de cero a petición (equivale a reiniciar). */
  restart(): Promise<CommandResult> {
    return this.admin({ type: "room.reset", confirm: true });
  }

  // ---- bucle de simulación local ----

  /** Un paso del bucle: termina movimientos y pruebas por reloj, guarda checkpoints y emite la muestra del reloj. */
  tick(): void {
    if (this.disposed) return;
    const at = this.mono();
    const live = this.liveActiveMs(at);
    if (!isSimulating(this.room, live)) return;
    const t = tickRoom(this.room, live);
    if (t.changed) {
      this.commit(t.room, at, []);
    } else if (at - this.lastCheckpoint >= this.checkpointMs) {
      this.room = t.room;
      this.anchor = at;
      this.lastCheckpoint = at;
      this.save(this.room);
    }
    if (isSimulating(this.room, this.liveActiveMs(at))) this.emitClock(at);
  }

  // ---- internos ----

  private fresh(): RoomState {
    const { config, map } = this.bundle;
    const created = createRoomState({ roomId: DEMO_ROOM_ID, code: DEMO_CODE, config, map, configHash: this.bundle.configHash, mapHash: this.bundle.mapHash, nowIso: this.now().toISOString() });
    return this.begin(ensureParticipant(created, DEMO_ID, config, map));
  }

  /** Vanessa comienza: la primera mesa queda en preparación. */
  private begin(room: RoomState): RoomState {
    const r = applyAdminAction(room, { type: "room.start" }, this.adminContext(0));
    return r.ok ? r.room : room;
  }

  private adminContext(activeMs: number) {
    return { config: this.bundle.config, map: this.bundle.map, nowIso: this.now().toISOString(), activeMs, nameOf: () => DEMO_NAME, fingerprint: { configHash: this.bundle.configHash, mapHash: this.bundle.mapHash } };
  }

  /** Recupera lo guardado. Como con una recarga de Vanessa en una sala, vuelve PAUSADO y sin sumar el tiempo transcurrido. */
  private load(): RoomState | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(DEMO_STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as { v?: unknown; configHash?: unknown; mapHash?: unknown; room?: unknown };
      if (saved.v !== SAVED_VERSION || saved.configHash !== this.bundle.configHash || saved.mapHash !== this.bundle.mapHash || !isPlausible(saved.room, this.bundle)) return null;
      const paused = onAdminLost(saved.room);
      return paused.ok ? paused.room : saved.room;
    } catch {
      return null; // almacenamiento no disponible o contenido dañado: se empieza de cero
    }
  }

  private save(room: RoomState): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ v: SAVED_VERSION, configHash: this.bundle.configHash, mapHash: this.bundle.mapHash, room }));
    } catch {
      /* sin almacenamiento la demostración sigue en memoria mientras no se recargue la página */
    }
  }

  private liveActiveMs(at: number): number {
    const base = this.room.adventure.timeline.activeMs;
    return isClockRunning(this.room) ? base + Math.max(0, at - this.anchor) : base;
  }

  private settled(at: number): RoomState {
    return tickRoom(this.room, this.liveActiveMs(at)).room;
  }

  private emitClock(at: number): void {
    const sample: ClockSample = { roomGeneration: this.room.roomGeneration, stateVersion: this.room.stateVersion, activeMs: this.liveActiveMs(at), running: isClockRunning(this.room), seq: ++this.clockSeq };
    for (const l of [...this.clockListeners]) l(sample);
  }

  /** Una transición confirmada: se guarda y se anuncia con su ancla de reloj. */
  private commit(next: RoomState, at: number, effects: EffectEvent[]): void {
    this.room = next;
    this.anchor = at;
    this.lastCheckpoint = at;
    this.save(next);
    this.set(this.buildState(this.state.notice, effects));
    this.emitClock(at);
  }

  private accepted(): CommandResult {
    return { ok: true, requestId: `demo-${++this.requestSeq}`, stateVersion: this.room.stateVersion, roundVersion: this.room.roundVersion };
  }

  private denied(code: Extract<CommandResult, { ok: false }>["code"], message: string): CommandResult {
    this.notify("error", message);
    return { ok: false, requestId: `demo-${++this.requestSeq}`, code, message };
  }

  private set(patch: Partial<RoomClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private presence(): PresenceUpdate {
    const s = this.room;
    const { config } = this.bundle;
    const exploring = s.adventure.round.stage === "exploration" || s.adventure.round.stage === "conversation";
    const activityId = currentActivityId(s.adventure, config);
    const r = exploring && activityId ? personReadiness(s.participants[DEMO_ID], activityId, config) : null;
    const me: ParticipantInfo = {
      principalId: DEMO_ID,
      role: "participant",
      displayName: DEMO_NAME,
      name: DEMO_NAME,
      color: DEMO_COLOR,
      distinction: 1,
      connected: true,
      observer: false,
      inRound: exploring && roundMembers(s).includes(DEMO_ID),
      ready: r?.ready ?? false,
      progress: r ? { done: r.done, needed: r.needed } : null,
    };
    const counter = roundCounter(s, config);
    return { participants: [me], connectedCount: 1, round: { ready: counter.ready, total: counter.total } };
  }

  private buildState(notice: Notice | null, effects: EffectEvent[]): RoomClientState {
    const s = this.room;
    const summary: RoomSummary = {
      code: DEMO_CODE,
      roomGeneration: s.roomGeneration,
      stateVersion: s.stateVersion,
      roundVersion: s.roundVersion,
      phase: s.phase,
      resumePhase: s.resumePhase,
      adminConnected: true,
      configMismatch: false,
      self: { principalId: DEMO_ID, role: "admin", displayName: DEMO_NAME, color: DEMO_COLOR, connectionEpoch: 1, observer: false },
    };
    const group: GroupSnapshot = { roomGeneration: s.roomGeneration, stateVersion: s.stateVersion, roundVersion: s.roundVersion, phase: s.phase, adventure: s.adventure, effects };
    const mine = s.participants[DEMO_ID]!;
    return {
      status: "connected",
      summary,
      group,
      me: { roomGeneration: s.roomGeneration, stateVersion: s.stateVersion, participant: mine },
      characters: { [DEMO_ID]: { principalId: DEMO_ID, displayName: DEMO_NAME, color: DEMO_COLOR, connected: true, character: mine.character } },
      presence: this.presence(),
      pending: 0,
      notice,
    };
  }
}

function browserStorage(): DemoStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
