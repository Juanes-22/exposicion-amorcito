import { io, type Socket } from "socket.io-client";
import type { AdminAction, AdminCommand, AdventureAction, AdventureCommand, CommandResult } from "../../shared/contracts/actions";
import type { ClientToServerEvents, PresenceUpdate, RoomSnapshot, RoomSummary, ServerToClientEvents, SimulationFrame } from "../../shared/contracts/events";
import { isTerminal } from "../../shared/domain/room";
import { newRequestId } from "./ids";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "replaced" | "unauthorized" | "terminal";

export interface Notice {
  /** Cambia con cada aviso: permite anunciar dos veces el mismo texto. */
  id: number;
  kind: "info" | "error";
  text: string;
}

export interface RoomClientState {
  status: ConnectionStatus;
  summary: RoomSummary | null;
  presence: PresenceUpdate | null;
  snapshot: RoomSnapshot | null;
  /** Comandos en vuelo: con alguno pendiente la interfaz bloquea el botón correspondiente. */
  pending: number;
  notice: Notice | null;
}

type Listener = () => void;
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * ¿Un frame sigue siendo válido? Se ordena por generación, versiones y `frameSeq`, y se descartan las muestras de planes o pruebas
 * anteriores (SPECS 5.6): del recorrido previo a un reinicio, de un turno ya superado, de un estado más viejo que el snapshot que
 * ya se tiene, o repetidas / fuera de orden.
 */
export function shouldAcceptFrame(f: Pick<SimulationFrame, "roomGeneration" | "turnVersion" | "stateVersion" | "frameSeq">, known: { generation: number; turnVersion: number; stateVersion: number; lastSeq: number }): boolean {
  return f.roomGeneration === known.generation && f.turnVersion >= known.turnVersion && f.stateVersion >= known.stateVersion && f.frameSeq > known.lastSeq;
}

const DEFAULT_ACK_TIMEOUT_MS = 4000;
const ADMIN_ACTIVITY_MS = 30_000;
const MAX_RETRIES = 2;

export interface RoomControllerOptions {
  /** Ruta de Socket.IO; cambia solo si el despliegue vive bajo un prefijo. */
  path?: string;
  /** Espera por un acknowledgment antes de reintentar el mismo comando. */
  ackTimeoutMs?: number;
}

/**
 * Cliente de la sala autenticada. Reglas (SPECS 5.4, 6.2):
 * · No depende de la recuperación automática de Socket.IO: al volver siempre llega un resumen y, según el papel, un snapshot.
 * · Al perder la conexión se cancelan los gestos y los comandos pendientes; no se reproduce nada al volver.
 * · Solo reintenta el MISMO comando discreto con el MISMO ID, mientras siga conectado con la misma conexión vigente.
 * · Se detiene (sin reconexión operativa) cuando la sala terminó, la pestaña fue sustituida o la credencial ya no vale.
 */
export class RoomController {
  private socket: AppSocket | null = null;
  private listeners = new Set<Listener>();
  private state: RoomClientState = { status: "connecting", summary: null, presence: null, snapshot: null, pending: 0, notice: null };
  private commandSeq = 0;
  private turnVersion = 0;
  private noticeId = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private inflight = new Set<(r: CommandResult) => void>();
  // Los frames NO pasan por el estado de React: se entregan a quien se suscribe (el puente de Phaser) para no renderizar por cada posición.
  private frameListeners = new Set<(f: SimulationFrame) => void>();
  private lastFrameSeq = -1;
  private stopped = false;
  /** Se invoca al detectar que la credencial dejó de valer, para que la aplicación la borre. */
  onUnauthorized: (() => void) | null = null;

  private readonly path: string;
  private readonly ackTimeoutMs: number;

  constructor(
    private readonly url: string,
    private readonly token: string,
    options: RoomControllerOptions = {},
  ) {
    this.path = options.path ?? "/socket.io";
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  }

  // ---- estado observable ----

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getState = (): RoomClientState => this.state;

  private set(patch: Partial<RoomClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  notify(kind: Notice["kind"], text: string): void {
    this.set({ notice: { id: ++this.noticeId, kind, text } });
  }

  /** Retira el aviso solo si sigue siendo el mismo (otro más reciente no se borra). */
  clearNotice(id: number): void {
    if (this.state.notice?.id === id) this.set({ notice: null });
  }

  // ---- conexión ----

  connect(): void {
    if (this.socket || this.stopped) return;
    const socket: AppSocket = io(this.url, { path: this.path, auth: { token: this.token }, transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 6000 });
    this.socket = socket;

    socket.on("connect", () => {
      // Conexión nueva (o recuperada): contador administrativo propio y nada pendiente del intento anterior.
      this.commandSeq = 0;
      this.lastFrameSeq = -1; // la secuencia de frames empieza de nuevo con cada conexión (y con cada reinicio del servidor)
      this.failInflight("STALE_CONNECTION", "Se perdió la conexión; vuelve a intentarlo.");
      // El estado de antes de la caída ya no es fiable: se descarta y NO se pasa a «conectada» hasta que llegue el resumen de
      // esta conexión (SPECS 5.4: al volver se pide el estado; los controles se habilitan desde el estado actual).
      this.set({ status: this.state.summary ? "reconnecting" : "connecting", presence: null, snapshot: null });
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (this.state.summary?.self.role === "admin" && socket.connected) socket.emit("admin.activity");
      }, ADMIN_ACTIVITY_MS);
    });
    socket.on("disconnect", (reason) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.failInflight("STALE_CONNECTION", "Se perdió la conexión; vuelve a intentarlo.");
      if (this.stopped || this.state.status === "replaced" || this.state.status === "terminal" || this.state.status === "unauthorized") return;
      // «io server disconnect» = el servidor nos cerró y Socket.IO no reintenta solo: se decide aquí.
      this.set({ status: "reconnecting" });
      if (reason === "io server disconnect") socket.connect();
    });
    socket.on("connect_error", (err) => {
      if (err.message === "UNAUTHORIZED") {
        this.stop("unauthorized");
        this.onUnauthorized?.();
      } else if (this.state.status === "connected") this.set({ status: "reconnecting" });
    });

    socket.on("room.summary", (summary) => {
      this.turnVersion = Math.max(this.turnVersion, summary.turnVersion);
      const prev = this.state.summary;
      const live = this.state.status === "connecting" || this.state.status === "reconnecting";
      this.set({ summary, ...(live ? { status: "connected" as const } : {}) });
      this.announceTurn(prev, summary);
      if (isTerminal(summary.phase)) this.stop("terminal");
    });
    socket.on("presence.updated", (presence) => this.set({ presence }));
    socket.on("room.snapshot", (snapshot) => {
      this.turnVersion = Math.max(this.turnVersion, snapshot.state.turnVersion);
      this.set({ snapshot });
    });
    socket.on("control.changed", (change) => {
      this.turnVersion = Math.max(this.turnVersion, change.turnVersion);
    });
    socket.on("simulation.frame", (f) => {
      if (!this.acceptFrame(f)) return;
      this.lastFrameSeq = f.frameSeq;
      for (const listener of [...this.frameListeners]) listener(f);
    });
    socket.on("session.replaced", () => {
      this.stop("replaced");
      this.notify("info", "Abriste la sala en otra pestaña. Esta quedó desactivada.");
    });
  }

  /**
   * Ordena las muestras por generación, versiones y secuencia, y descarta las de planes o pruebas anteriores (SPECS 5.6). Un frame
   * solo tiene sentido sobre un snapshot ya recibido: sin él no hay plan que interpolar.
   */
  private acceptFrame(f: SimulationFrame): boolean {
    const { summary, snapshot } = this.state;
    if (!summary || !snapshot || this.state.status !== "connected") return false;
    return shouldAcceptFrame(f, { generation: summary.roomGeneration, turnVersion: this.turnVersion, stateVersion: snapshot.state.stateVersion, lastSeq: this.lastFrameSeq });
  }

  /** Suscripción a las muestras de simulación válidas. Devuelve la función que la retira. */
  subscribeFrames = (listener: (f: SimulationFrame) => void): (() => void) => {
    this.frameListeners.add(listener);
    return () => void this.frameListeners.delete(listener);
  };

  private announceTurn(prev: RoomSummary | null, next: RoomSummary): void {
    if (!prev || next.self.role !== "participant") return;
    if (!prev.self.isController && next.self.isController) this.notify("info", "Es tu turno.");
    else if (prev.self.isController && !next.self.isController) this.notify("info", next.controller ? `Ahora explora ${next.controller.displayName}.` : "Ya no tienes el turno.");
  }

  /** Detiene la conexión operativa: sin reconexión ni comandos. Los datos ya recibidos se conservan para mostrar el estado final. */
  private stop(status: ConnectionStatus): void {
    this.set({ status });
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    // Sin reconexión operativa: ni la automática de Socket.IO ni la de «io server disconnect».
    this.socket?.io.reconnection(false);
    this.socket?.disconnect();
  }

  dispose(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.failInflight("STALE_CONNECTION", "Conexión cerrada.");
    this.frameListeners.clear();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.listeners.clear();
  }

  // ---- comandos ----

  private failInflight(code: "STALE_CONNECTION", message: string): void {
    for (const settle of [...this.inflight]) settle({ ok: false, requestId: "", code, message });
    this.inflight.clear();
    if (this.state.pending !== 0) this.set({ pending: 0 });
  }

  /**
   * Envía un comando y espera su acknowledgment. Si se pierde, reintenta el mismo comando con el mismo ID únicamente mientras la
   * conexión vigente siga siendo la misma. Una denegación se devuelve y se avisa, sin bloquear nada de forma permanente.
   */
  private send(event: "admin.command" | "adventure.action", envelope: AdminCommand | AdventureCommand): Promise<CommandResult> {
    const socket = this.socket;
    if (!socket || !socket.connected || this.state.status !== "connected") {
      return Promise.resolve({ ok: false, requestId: envelope.requestId, code: "STALE_CONNECTION", message: "Sin conexión con la sala. Espera a que vuelva." });
    }
    const epoch = envelope.connectionEpoch;
    this.set({ pending: this.state.pending + 1 });
    return new Promise<CommandResult>((resolve) => {
      let done = false;
      const settle = (r: CommandResult) => {
        if (done) return;
        done = true;
        this.inflight.delete(settle);
        this.set({ pending: Math.max(0, this.state.pending - 1) });
        if (!r.ok && r.code !== "STALE_CONNECTION") this.notify("error", r.message);
        resolve(r);
      };
      this.inflight.add(settle);
      const attempt = (n: number) => {
        // Antes de cada intento: sigue conectado y es la misma conexión vigente (mismo epoch).
        if (done) return;
        if (!socket.connected || this.state.summary?.self.connectionEpoch !== epoch) return settle({ ok: false, requestId: envelope.requestId, code: "STALE_CONNECTION", message: "Se perdió la conexión; vuelve a intentarlo." });
        (socket as unknown as { timeout: (ms: number) => { emit: (e: string, p: unknown, cb: (err: Error | null, r: CommandResult) => void) => void } })
          .timeout(this.ackTimeoutMs)
          .emit(event, envelope, (err, result) => {
            if (!err) return settle(result);
            if (n < MAX_RETRIES) attempt(n + 1);
            else settle({ ok: false, requestId: envelope.requestId, code: "STALE_CONNECTION", message: "El servidor no respondió. Revisa tu conexión." });
          });
      };
      attempt(0);
    });
  }

  admin(action: AdminAction): Promise<CommandResult> {
    const s = this.state.summary;
    if (!s) return Promise.resolve({ ok: false, requestId: "", code: "STALE_CONNECTION", message: "Todavía no hay conexión con la sala." });
    return this.send("admin.command", { requestId: newRequestId(), roomGeneration: s.roomGeneration, connectionEpoch: s.self.connectionEpoch, commandSeq: ++this.commandSeq, action });
  }

  adventure(action: AdventureAction): Promise<CommandResult> {
    const s = this.state.summary;
    if (!s) return Promise.resolve({ ok: false, requestId: "", code: "STALE_CONNECTION", message: "Todavía no hay conexión con la sala." });
    return this.send("adventure.action", { requestId: newRequestId(), roomGeneration: s.roomGeneration, turnVersion: this.turnVersion, connectionEpoch: s.self.connectionEpoch, action });
  }

  /** Pide el estado permitido para el papel (reconexión, recarga o duda). */
  sync(): void {
    if (this.socket?.connected) this.socket.emit("room.sync", () => undefined);
  }
}
