// Cliente ligero para el ensayo de capacidad: un socket real por persona, con el sobre de comandos de SPECS 5.2 y contabilidad de lo que
// recibe (cuántos mensajes y bytes de cada evento, y cuándo). No renderiza nada.
import { io, type Socket } from "socket.io-client";
import type { AdminAction, CommandResult, ParticipantAction } from "../../shared/contracts/actions";
import type { ClockSample, GroupSnapshot, MeSnapshot, PresenceUpdate, RoomSummary } from "../../shared/contracts/events";

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
  group: GroupSnapshot | null = null;
  me: MeSnapshot | null = null;
  presence: PresenceUpdate | null = null;
  roundVersion = 0;
  readonly received: Received[] = [];
  private commandSeq = 0;
  private groupListeners = new Set<(g: GroupSnapshot, t: number) => void>();
  private meListeners = new Set<(m: MeSnapshot, t: number) => void>();
  private presenceListeners = new Set<(p: PresenceUpdate, t: number) => void>();
  private clockListeners = new Set<(c: ClockSample, t: number) => void>();

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
      this.roundVersion = Math.max(this.roundVersion, s.roundVersion);
    });
    this.socket.on("group.state", (g: GroupSnapshot) => {
      this.group = g;
      this.roundVersion = Math.max(this.roundVersion, g.roundVersion);
      const t = now();
      for (const l of [...this.groupListeners]) l(g, t);
    });
    this.socket.on("me.state", (m: MeSnapshot) => {
      this.me = m;
      const t = now();
      for (const l of [...this.meListeners]) l(m, t);
    });
    this.socket.on("presence.updated", (p: PresenceUpdate) => {
      this.presence = p;
      const t = now();
      for (const l of [...this.presenceListeners]) l(p, t);
    });
    this.socket.on("clock.sample", (c: ClockSample) => {
      const t = now();
      for (const l of [...this.clockListeners]) l(c, t);
    });
  }

  count(event: string, since = 0): number {
    return this.received.filter((r) => r.event === event && r.t >= since).length;
  }
  bytes(event?: string): number {
    return this.received.filter((r) => !event || r.event === event).reduce((a, r) => a + r.bytes, 0);
  }

  onGroup(cb: (g: GroupSnapshot, t: number) => void): () => void {
    this.groupListeners.add(cb);
    return () => void this.groupListeners.delete(cb);
  }
  onMe(cb: (m: MeSnapshot, t: number) => void): () => void {
    this.meListeners.add(cb);
    return () => void this.meListeners.delete(cb);
  }
  onPresence(cb: (p: PresenceUpdate, t: number) => void): () => void {
    this.presenceListeners.add(cb);
    return () => void this.presenceListeners.delete(cb);
  }
  onClock(cb: (c: ClockSample, t: number) => void): () => void {
    this.clockListeners.add(cb);
    return () => void this.clockListeners.delete(cb);
  }

  async ready(timeoutMs = 10_000): Promise<number> {
    const start = now();
    while (!this.summary) {
      if (now() - start > timeoutMs) throw new Error(`${this.label}: sin resumen de la sala tras ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 5));
    }
    return now() - start;
  }

  private emit(event: "admin.command" | "participant.action", payload: unknown): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, a: (r: CommandResult) => void) => void }).emit(event, payload, resolve));
  }
  act(action: ParticipantAction): Promise<CommandResult> {
    const s = this.summary!;
    return this.emit("participant.action", { requestId: newId("v"), roomGeneration: s.roomGeneration, roundVersion: this.roundVersion, connectionEpoch: s.self.connectionEpoch, action });
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
