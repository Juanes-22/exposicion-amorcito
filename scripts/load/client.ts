// Cliente ligero para el ensayo de capacidad: un socket real por persona, con el sobre de comandos de SPECS 5.2 y contabilidad de lo que
// recibe (cuántos mensajes y bytes de cada evento, y cuándo). No renderiza nada.
import { io, type Socket } from "socket.io-client";
import type { AdminAction, AdventureAction, CommandResult } from "../../shared/contracts/actions";
import type { PresenceUpdate, RoomSnapshot, RoomSummary, SimulationFrame } from "../../shared/contracts/events";

export interface Received {
  event: string;
  /** `performance.now()` al recibirlo. */
  t: number;
  bytes: number;
}

let requestSeq = 0;
const newId = (prefix: string) => `${prefix}${++requestSeq}-${Math.random().toString(36).slice(2, 8)}`;
export const now = () => performance.now();

export class LoadClient {
  readonly socket: Socket;
  summary: RoomSummary | null = null;
  snapshot: RoomSnapshot | null = null;
  presence: PresenceUpdate | null = null;
  turnVersion = 0;
  readonly received: Received[] = [];
  /** Momento (performance.now) en que vio por última vez que ya NO tenía el turno, tras haberlo tenido. */
  lostControlAt: number | null = null;
  hadControl = false;
  private commandSeq = 0;
  private snapshotWaiters = new Set<(s: RoomSnapshot) => void>();
  private frameListeners = new Set<(f: SimulationFrame, t: number) => void>();
  private summaryListeners = new Set<(s: RoomSummary, t: number) => void>();

  constructor(
    readonly url: string,
    readonly token: string,
    readonly label: string,
  ) {
    this.socket = io(url, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.onAny((event: string, payload: unknown) => {
      this.received.push({ event, t: now(), bytes: Buffer.byteLength(JSON.stringify(payload ?? null)) });
    });
    this.socket.on("room.summary", (s: RoomSummary) => {
      this.summary = s;
      this.turnVersion = Math.max(this.turnVersion, s.turnVersion);
      if (s.self.isController) this.hadControl = true;
      else if (this.hadControl) this.lostControlAt ??= now();
      if (s.self.isController) this.lostControlAt = null;
      for (const l of [...this.summaryListeners]) l(s, now());
    });
    this.socket.on("room.snapshot", (s: RoomSnapshot) => {
      this.snapshot = s;
      this.turnVersion = Math.max(this.turnVersion, s.state.turnVersion);
      for (const w of [...this.snapshotWaiters]) w(s);
    });
    this.socket.on("presence.updated", (p: PresenceUpdate) => void (this.presence = p));
    this.socket.on("control.changed", (c: { turnVersion: number }) => void (this.turnVersion = Math.max(this.turnVersion, c.turnVersion)));
    this.socket.on("simulation.frame", (f: SimulationFrame) => {
      const t = now();
      for (const l of [...this.frameListeners]) l(f, t);
    });
  }

  count(event: string, since = 0): number {
    return this.received.filter((r) => r.event === event && r.t >= since).length;
  }
  bytes(event?: string): number {
    return this.received.filter((r) => !event || r.event === event).reduce((a, r) => a + r.bytes, 0);
  }

  onSnapshot(cb: (s: RoomSnapshot) => void): () => void {
    this.snapshotWaiters.add(cb);
    return () => void this.snapshotWaiters.delete(cb);
  }
  onFrame(cb: (f: SimulationFrame, t: number) => void): () => void {
    this.frameListeners.add(cb);
    return () => void this.frameListeners.delete(cb);
  }
  onSummary(cb: (s: RoomSummary, t: number) => void): () => void {
    this.summaryListeners.add(cb);
    return () => void this.summaryListeners.delete(cb);
  }

  async ready(timeoutMs = 10_000): Promise<number> {
    const start = now();
    while (!this.summary) {
      if (now() - start > timeoutMs) throw new Error(`${this.label}: sin resumen de la sala tras ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 5));
    }
    return now() - start;
  }

  private emit(event: "admin.command" | "adventure.action", payload: unknown): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, a: (r: CommandResult) => void) => void }).emit(event, payload, resolve));
  }
  adventure(action: AdventureAction): Promise<CommandResult> {
    const s = this.summary!;
    return this.emit("adventure.action", { requestId: newId("v"), roomGeneration: s.roomGeneration, turnVersion: this.turnVersion, connectionEpoch: s.self.connectionEpoch, action });
  }
  admin(action: AdminAction): Promise<CommandResult> {
    const s = this.summary!;
    return this.emit("admin.command", { requestId: newId("a"), roomGeneration: s.roomGeneration, connectionEpoch: s.self.connectionEpoch, commandSeq: ++this.commandSeq, action });
  }
  close(): void {
    this.socket.disconnect();
  }
}

/** Percentil por rango más cercano. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
export interface Stats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
export const stats = (values: number[]): Stats => ({ n: values.length, min: Math.min(...values), p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), max: Math.max(...values) });
