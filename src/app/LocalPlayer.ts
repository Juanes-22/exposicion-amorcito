import type { ProjectBundle } from "../../shared/config/validateProject";
import type { CommandResult, ParticipantAction } from "../../shared/contracts/actions";
import type { ClockSample } from "../../shared/contracts/events";
import type { AdventureState, ParticipantState, RoomState } from "../../shared/contracts/state";
import { createParticipantState, hasDueTrial, reduceParticipant, settleTrials } from "../../shared/domain/participant";
import { createRoomState } from "../../shared/domain/room";

const LOCAL_ID = "demostracion-local";

export interface LocalPlayerOptions {
  mono?: () => number;
  /** Cada cuánto termina pruebas y emite el reloj (ms); `0` lo desactiva (las pruebas llaman a `tick()`). */
  tickMs?: number;
}

type Listener = () => void;

/**
 * Una persona de demostración para Vanessa en la proyección de una sala real (propuesta de rondas, sección 11): explora la mesa de la
 * ronda con las MISMAS reglas que cualquier participante (`reduceParticipant`), pero todo ocurre en este dispositivo. Nada se envía a la
 * sala: no cuenta en el contador, no entra al cuaderno ni cambia lo que ven las personas. Tiene su propio reloj de simulación.
 */
export class LocalPlayer {
  private participant: ParticipantState;
  private counters = { note: 0, trial: 0, plan: 0 };
  private version = 1;
  private requestSeq = 0;
  private clockSeq = 0;
  private readonly base: number;
  private readonly skeleton: RoomState;
  private listeners = new Set<Listener>();
  private clockListeners = new Set<(s: ClockSample) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly mono: () => number;

  constructor(
    private readonly bundle: ProjectBundle,
    private readonly adv: AdventureState,
    readonly activityId: string,
    options: LocalPlayerOptions = {},
  ) {
    this.mono = options.mono ?? (() => performance.now());
    this.base = this.mono();
    const { config, map } = bundle;
    this.skeleton = createRoomState({ roomId: "demostracion", code: "LOCAL", config, map, configHash: "", mapHash: "", nowIso: new Date().toISOString() });
    this.participant = createParticipantState(config, map, 0);
    // Empieza dentro de la mesa que Vanessa va a mostrar.
    this.apply({ type: "station.open", stationId: activityId, origin: "quickNav" });
    const tickMs = options.tickMs ?? 100;
    if (tickMs > 0) this.timer = setInterval(() => this.tick(), tickMs);
  }

  /** Reloj de simulación de la demostración (ms). Corre desde que se abre. */
  activeMs(): number {
    return this.mono() - this.base;
  }

  getParticipant = (): ParticipantState => this.participant;
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  subscribeClock = (listener: (s: ClockSample) => void): (() => void) => {
    this.clockListeners.add(listener);
    return () => void this.clockListeners.delete(listener);
  };

  /** Con la mesa en exploración, aunque la sala siga en preparación: es lo que se demuestra. */
  private room(): RoomState {
    const index = this.bundle.config.route.indexOf(this.activityId);
    return {
      ...this.skeleton,
      phase: "running",
      adventure: { ...this.adv, counters: this.counters, round: { index, stage: "exploration", roster: [LOCAL_ID], included: [], pendingAtConversation: [], freireShown: false } },
      participants: { [LOCAL_ID]: this.participant },
    };
  }

  private apply(action: ParticipantAction): CommandResult {
    const requestId = `local-${++this.requestSeq}`;
    const r = reduceParticipant(this.room(), LOCAL_ID, action, { config: this.bundle.config, map: this.bundle.map, nav: this.bundle.nav, activeMs: this.activeMs() });
    if (!r.ok) return { ok: false, requestId, code: r.code as Extract<CommandResult, { ok: false }>["code"], message: r.message };
    this.counters = r.counters;
    if (r.changed) {
      this.participant = r.participant;
      this.version++;
      this.emit();
    }
    return { ok: true, requestId, stateVersion: this.version, roundVersion: 1 };
  }

  /** Mismo contrato asíncrono que `RoomPort.act`. */
  perform = (action: ParticipantAction): Promise<CommandResult> => Promise.resolve(this.apply(action));

  /** Termina las pruebas cuya hora llegó y entrega una muestra del reloj. */
  tick(): void {
    if (this.disposed) return;
    const at = this.activeMs();
    if (hasDueTrial(this.participant, at)) {
      const copy = structuredClone(this.participant);
      settleTrials(copy, at);
      this.participant = copy;
      this.version++;
      this.emit();
    }
    const sample: ClockSample = { roomGeneration: 1, stateVersion: this.version, activeMs: at, running: true, seq: ++this.clockSeq };
    for (const l of [...this.clockListeners]) l(sample);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.clockListeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
