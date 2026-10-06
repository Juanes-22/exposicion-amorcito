import { contentHash } from "../../shared/config/hash";
import type { ProjectBundle } from "../../shared/config/validateProject";
import type { AdminCommand, AdventureCommand, CommandResult } from "../../shared/contracts/actions";
import type { ClientToServerEvents, CreateRoomResponse, EffectEvent, JoinRoomRequest, JoinRoomResponse, ParticipantInfo, PresenceUpdate, PublicController, RoomPublicInfo, RoomSnapshot, RoomSummary, ServerToClientEvents, SyncResult } from "../../shared/contracts/events";
import { PARTICIPANT_COLOR_IDS, type CommandErrorCode, type HttpErrorCode } from "../../shared/contracts/limits";
import type { RoomPhase, RoomState } from "../../shared/contracts/state";
import { displayNameFor, nameKey, normalizeName } from "../../shared/domain/text";
import {
  applyAdminAction,
  applyAdventureAction,
  checkGeneration,
  checkTurn,
  createRoomState,
  isPlayable,
  isTerminal,
  onAdminLost,
  onControllerLost,
  recoverAfterRestart,
  sameOwner,
  tickRoom,
  type PresenceView,
  type RoomChange,
} from "../../shared/domain/room";
import { buildSimulationFrame, isSimulating } from "../../shared/domain/frames";
import { hashToken, newId, newRoomCode, newToken } from "./auth";
import type { ServerSettings } from "./config";
import type { PrincipalRecord, RoomRepository, StoredCommand } from "./db";
import { KeyedLimiter } from "./rateLimit";

/** Error de la API HTTP con su código estable y estado. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: HttpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

type EventName = keyof ServerToClientEvents;
type EventArgs<E extends EventName> = Parameters<ServerToClientEvents[E]>;

/** Lo que el servicio necesita del transporte: entrega a conexiones concretas y al canal de vista (SPECS 5.5). */
export interface Outbox {
  send<E extends EventName>(principalId: string, event: E, ...args: EventArgs<E>): void;
  /** Canal de vista: administradora y controlador actual, nadie más. */
  sendToView<E extends EventName>(roomId: string, event: E, ...args: EventArgs<E>): void;
  joinView(principalId: string, roomId: string): void;
  leaveView(principalId: string, roomId: string): void;
  /** Cierra la conexión vigente de una identidad (salas terminales). */
  close(principalId: string): void;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export interface ServiceDeps {
  repo: RoomRepository;
  project: ProjectBundle;
  settings: ServerSettings;
  outbox: Outbox;
  /** Reloj monotónico en ms: mide el tiempo activo de simulación. No suma el tiempo con el servidor apagado (SPECS 6.1). */
  mono?: () => number;
  /** Hora de pared, para marcas temporales del servidor. */
  now?: () => Date;
  logger?: Logger;
}

interface Presence {
  connected: boolean;
  epoch: number;
  socketId: string | null;
}

interface Runtime {
  state: RoomState;
  principals: Map<string, PrincipalRecord>;
  presence: Map<string, Presence>;
  adminId: string;
  /** Último `commandSeq` aceptado de la conexión administrativa vigente. */
  lastAdminSeq: number;
  /** Reloj monotónico en el último commit: el tiempo activo corre desde aquí mientras la sala es jugable. */
  anchor: number;
  /** Marcas del bucle de simulación (SPECS 5.6, 6.1). */
  frameSeq: number;
  lastCheckpoint: number;
  tickBusy: boolean;
  queue: Promise<unknown>;
  configMismatch: boolean;
  buckets: Map<string, KeyedLimiter>;
}

export interface AuthIdentity {
  principalId: string;
  roomId: string;
  role: PrincipalRecord["role"];
}

const failure = (requestId: string, code: CommandErrorCode, message: string): CommandResult => ({ ok: false, requestId, code, message });

export class RoomService {
  private readonly repo: RoomRepository;
  private readonly project: ProjectBundle;
  private readonly settings: ServerSettings;
  private readonly out: Outbox;
  private readonly mono: () => number;
  private readonly now: () => Date;
  private readonly log: Logger;
  private rooms = new Map<string, Runtime>();
  private byCode = new Map<string, string>();
  private createLimiter: KeyedLimiter;
  private joinLimiter: KeyedLimiter;

  constructor(deps: ServiceDeps) {
    this.repo = deps.repo;
    this.project = deps.project;
    this.settings = deps.settings;
    this.out = deps.outbox;
    this.mono = deps.mono ?? (() => performance.now());
    this.now = deps.now ?? (() => new Date());
    this.log = deps.logger ?? silentLogger;
    this.createLimiter = new KeyedLimiter(this.settings.rateLimits.createRoomPerMinute, this.settings.rateLimits.createRoomPerMinute / 60);
    this.joinLimiter = new KeyedLimiter(this.settings.rateLimits.joinPerMinute, this.settings.rateLimits.joinPerMinute / 60);
  }

  // ---- arranque y recuperación ------------------------------------------------------------------------

  /**
   * Recupera las salas durables. Las salas en curso quedan pausadas, sin propietario y con `turnVersion` nuevo; la presencia se
   * reconstruye como desconectada y no se suma el tiempo que el servidor estuvo apagado (SPECS 6.1).
   */
  start(): { recovered: number; unreadable: number } {
    const { rooms, unreadable } = this.repo.loadRooms();
    for (const u of unreadable) this.log.error("sala ilegible: se conserva en disco sin cargarla", u);
    const nowIso = this.now().toISOString();
    for (const stored of rooms) {
      const state = recoverAfterRestart(stored.state);
      try {
        if (state !== stored.state) this.repo.commit(state, nowIso);
      } catch (e) {
        this.log.error("no se pudo guardar la recuperación de la sala", { roomId: state.roomId, error: String(e) });
      }
      const principals = new Map(this.repo.listPrincipals(state.roomId).map((p) => [p.principalId, p]));
      const admin = [...principals.values()].find((p) => p.role === "admin");
      if (!admin) {
        this.log.error("sala sin administradora: no se carga", { roomId: state.roomId });
        continue;
      }
      this.rooms.set(state.roomId, {
        state,
        principals,
        presence: new Map(),
        adminId: admin.principalId,
        lastAdminSeq: 0,
        anchor: this.mono(),
        frameSeq: 0,
        lastCheckpoint: this.mono(),
        tickBusy: false,
        queue: Promise.resolve(),
        configMismatch: this.mismatch(state),
        buckets: new Map(),
      });
      this.byCode.set(state.code, state.roomId);
      if (this.mismatch(state)) this.log.warn("CONFIG_MISMATCH: la sala usa otra revisión de configuración o mapa", { roomId: state.roomId });
    }
    this.startLoop();
    return { recovered: this.rooms.size, unreadable: unreadable.length };
  }

  private mismatch(state: RoomState): boolean {
    return state.contentSetId !== this.project.config.contentSetId || state.configHash !== this.project.configHash || state.mapHash !== this.project.mapHash;
  }

  // ---- API HTTP: alta de sala e identidades -----------------------------------------------------------

  allowCreate(key: string): boolean {
    return this.createLimiter.allow(key);
  }
  allowJoin(key: string): boolean {
    return this.joinLimiter.allow(key);
  }

  createRoom(contentSetId: string, origin: string): CreateRoomResponse {
    if (contentSetId !== this.project.config.contentSetId) throw new ServiceError(403, "CONTENT_NOT_ALLOWED", "Ese contenido no está disponible en este servidor.");
    const nowIso = this.now().toISOString();
    let code = newRoomCode();
    for (let i = 0; i < 20 && (this.byCode.has(code) || this.repo.codeExists(code)); i++) code = newRoomCode();
    if (this.byCode.has(code) || this.repo.codeExists(code)) throw new ServiceError(503, "INTERNAL", "No se pudo asignar un código de sala.");

    const roomId = newId();
    const state = createRoomState({ roomId, code, config: this.project.config, map: this.project.map, configHash: this.project.configHash, mapHash: this.project.mapHash, nowIso });
    const token = newToken();
    const admin: PrincipalRecord = { principalId: newId(), roomId, role: "admin", name: this.adminName(), nameKey: "", color: null, distinction: 1, tokenHash: hashToken(token), createdAt: nowIso };
    try {
      this.repo.createRoom(state, admin, nowIso);
    } catch (e) {
      this.log.error("no se pudo crear la sala", { error: String(e) });
      throw new ServiceError(503, "INTERNAL", "No se pudo crear la sala. Intenta de nuevo.");
    }
    this.rooms.set(roomId, { state, principals: new Map([[admin.principalId, admin]]), presence: new Map(), adminId: admin.principalId, lastAdminSeq: 0, anchor: this.mono(), frameSeq: 0, lastCheckpoint: this.mono(), tickBusy: false, queue: Promise.resolve(), configMismatch: false, buckets: new Map() });
    this.byCode.set(code, roomId);
    // El enlace público lleva únicamente el código: nunca una credencial (CA-01).
    return { code, joinUrl: `${origin}/sala/${code}`, adminId: admin.principalId, adminToken: token };
  }

  private adminName(): string {
    return this.project.config.project.studentName.split(" ")[0] ?? "Vanessa";
  }

  describeRoom(code: string): RoomPublicInfo | undefined {
    const rt = this.runtimeByCode(code);
    return rt ? { code: rt.state.code, phase: rt.state.phase, title: this.project.config.project.title } : undefined;
  }

  joinRoom(code: string, body: JoinRoomRequest): JoinRoomResponse {
    const rt = this.runtimeByCode(code);
    if (!rt) throw new ServiceError(404, "ROOM_NOT_FOUND", "No encontramos esa sala. Revisa el código.");
    if (isTerminal(rt.state.phase)) throw new ServiceError(410, "ROOM_UNAVAILABLE", "Esta sala ya terminó.");
    const name = normalizeName(body.name);
    if (!name.ok) throw new ServiceError(400, "INVALID_PAYLOAD", name.message);
    if (!PARTICIPANT_COLOR_IDS.includes(body.color)) throw new ServiceError(400, "INVALID_PAYLOAD", "Elige un color de la paleta.");
    if (this.repo.countParticipants(rt.state.roomId) >= this.project.config.session.maxParticipants) throw new ServiceError(409, "ROOM_FULL", "La sala está llena.");

    const token = newToken();
    let record: PrincipalRecord;
    try {
      record = this.repo.addParticipant({ principalId: newId(), roomId: rt.state.roomId, role: "participant", name: name.value, nameKey: nameKey(name.value), color: body.color, tokenHash: hashToken(token), createdAt: this.now().toISOString() });
    } catch (e) {
      this.log.error("no se pudo registrar al participante", { error: String(e) });
      throw new ServiceError(503, "INTERNAL", "No se pudo entrar a la sala. Intenta de nuevo.");
    }
    rt.principals.set(record.principalId, record);
    this.sendPresence(rt);
    return { principalId: record.principalId, name: record.name, displayName: displayNameFor(record.name, record.distinction), color: body.color, distinction: record.distinction, token };
  }

  // ---- identidad de conexión ---------------------------------------------------------------------------

  /** Resuelve la identidad y la sala a partir de la credencial; el papel lo decide el servidor, nunca el navegador (SPECS 5.1). */
  authenticate(token: string): AuthIdentity | null {
    const p = this.repo.findPrincipalByTokenHash(hashToken(token));
    if (!p || !this.rooms.has(p.roomId)) return null;
    return { principalId: p.principalId, roomId: p.roomId, role: p.role };
  }

  private runtimeByCode(code: string): Runtime | undefined {
    const id = this.byCode.get(code.toUpperCase());
    return id ? this.rooms.get(id) : undefined;
  }

  private rt(roomId: string): Runtime {
    const rt = this.rooms.get(roomId);
    if (!rt) throw new Error(`Sala desconocida ${roomId}`);
    return rt;
  }

  // ---- cola serial por sala ----------------------------------------------------------------------------

  /** Cada sala procesa sus mutaciones de una en una (SPECS 5.4). Un fallo no rompe la cola. */
  private run<T>(rt: Runtime, fn: () => T | Promise<T>): Promise<T> {
    const next = rt.queue.then(fn, fn);
    rt.queue = next.catch(() => undefined);
    return next;
  }

  // ---- reloj ---------------------------------------------------------------------------------------------

  /** Tiempo activo actual: lo guardado en el último commit más lo corrido desde entonces, solo si la sala es jugable (invariante 6). */
  private liveActiveMs(rt: Runtime, at: number = this.mono()): number {
    const base = rt.state.adventure.timeline.activeMs;
    return isPlayable(rt.state) ? base + Math.max(0, at - rt.anchor) : base;
  }

  /** La sala con el reloj al día. Antes de pausar, retirar control o cerrar hay que fijar el instante para no perder tiempo. */
  private settled(rt: Runtime, at: number = this.mono()): RoomState {
    return tickRoom(rt.state, this.liveActiveMs(rt, at), this.project.config).room;
  }

  // ---- presencia -----------------------------------------------------------------------------------------

  private presenceView(rt: Runtime): PresenceView {
    return { isConnected: (id) => rt.presence.get(id)?.connected === true, isParticipant: (id) => rt.principals.get(id)?.role === "participant" };
  }

  private isConnected(rt: Runtime, id: string): boolean {
    return rt.presence.get(id)?.connected === true;
  }

  private checkConnection(rt: Runtime, principalId: string, socketId: string, epoch: number | null): CommandErrorCode | null {
    const p = rt.presence.get(principalId);
    if (!p || !p.connected || p.socketId !== socketId) return "STALE_CONNECTION";
    if (epoch !== null && epoch !== p.epoch) return "STALE_CONNECTION";
    return null;
  }

  /** Conecta una identidad. Una nueva conexión sustituye a la anterior y sube `connectionEpoch` (SPECS 5.1). */
  attach(identity: AuthIdentity, socketId: string): Promise<{ epoch: number; replacedSocketId: string | null; terminal: boolean }> {
    const rt = this.rt(identity.roomId);
    return this.run(rt, () => {
      const id = identity.principalId;
      const prev = rt.presence.get(id);
      const replacedSocketId = prev?.connected ? prev.socketId : null;
      const presence: Presence = { connected: true, epoch: (prev?.epoch ?? 0) + 1, socketId };
      rt.presence.set(id, presence);

      const before = rt.state;
      let next = before;
      if (!isTerminal(before.phase)) {
        if (identity.role === "admin") {
          rt.lastAdminSeq = 0;
          this.touchAdmin(rt);
          // Quien recarga o sustituye su conexión recupera la administración con la aventura pausada (CA-26).
          next = this.applyPolicy(rt, onAdminLost);
        } else if (replacedSocketId !== null && before.controlOwner?.principalId === id) {
          // Un controlador sustituido pausa y pierde el control; el participante nuevo vuelve en espera (SPECS 5.1).
          next = this.applyPolicy(rt, onControllerLost);
        }
      }
      this.fanOut(rt, before, next, { presenceChanged: true, adminPresenceChanged: identity.role === "admin", includeSocketOf: id });
      return { epoch: presence.epoch, replacedSocketId, terminal: isTerminal(next.phase) };
    });
  }

  /** Una desconexión solo cuenta si es la de la conexión vigente: se ignora la del socket sustituido. */
  detach(identity: AuthIdentity, socketId: string): Promise<void> {
    const rt = this.rooms.get(identity.roomId);
    if (!rt) return Promise.resolve();
    return this.run(rt, () => {
      const id = identity.principalId;
      const p = rt.presence.get(id);
      if (!p || p.socketId !== socketId) return;
      rt.presence.set(id, { connected: false, epoch: p.epoch, socketId: null });
      const before = rt.state;
      let next = before;
      if (!isTerminal(before.phase)) {
        if (identity.role === "admin") next = this.applyPolicy(rt, onAdminLost);
        else if (before.controlOwner?.principalId === id) next = this.applyPolicy(rt, onControllerLost);
      }
      this.fanOut(rt, before, next, { presenceChanged: true, adminPresenceChanged: identity.role === "admin" });
    });
  }

  /**
   * Aplica una política automática de conexión. Son transiciones de seguridad (pausar, retirar control): si la persistencia
   * falla se aplican igualmente en memoria y se registra, porque dejar jugar a quien ya no está conectado es peor.
   */
  private applyPolicy(rt: Runtime, policy: (room: RoomState) => RoomChange): RoomState {
    const at = this.mono();
    const change = policy(this.settled(rt, at));
    if (!change.ok || !change.changed) return rt.state;
    try {
      this.repo.commit(change.room, this.now().toISOString());
    } catch (e) {
      this.log.error("no se pudo guardar una pausa automática; se aplica solo en memoria", { roomId: rt.state.roomId, error: String(e) });
    }
    rt.state = change.room;
    rt.anchor = at;
    return rt.state;
  }

  private touchAdmin(rt: Runtime): void {
    try {
      this.repo.touchAdminActivity(rt.state.roomId, this.now().toISOString());
    } catch (e) {
      this.log.warn("no se pudo registrar la actividad de la administradora", { error: String(e) });
    }
  }

  /** Señal de actividad autenticada de la administradora (SPECS 6.3). */
  adminActivity(identity: AuthIdentity, socketId: string): Promise<void> {
    const rt = this.rt(identity.roomId);
    return this.run(rt, () => {
      if (identity.role !== "admin" || this.checkConnection(rt, identity.principalId, socketId, null)) return;
      this.touchAdmin(rt);
    });
  }

  // ---- comandos ------------------------------------------------------------------------------------------

  private bucket(rt: Runtime, kind: "adventure" | "admin", principalId: string): boolean {
    const rl = this.settings.rateLimits;
    let limiter = rt.buckets.get(kind);
    if (!limiter) {
      limiter = kind === "admin" ? new KeyedLimiter(rl.adminBurst, rl.adminPerSecond) : new KeyedLimiter(rl.adventureBurst, rl.adventurePerSecond);
      rt.buckets.set(kind, limiter);
    }
    return limiter.allow(principalId);
  }

  private fingerprint(kind: "admin" | "adventure", action: unknown): string {
    return contentHash({ kind, action });
  }

  /** Comando de moderación (SPECS 5.2). Orden de comprobaciones: conexión → duplicado → generación → secuencia → dominio → persistencia. */
  adminCommand(identity: AuthIdentity, socketId: string, cmd: AdminCommand): Promise<CommandResult> {
    const rt = this.rt(identity.roomId);
    if (!this.bucket(rt, "admin", identity.principalId)) return Promise.resolve(failure(cmd.requestId, "RATE_LIMITED", "Demasiados cambios seguidos. Espera un momento."));
    return this.run(rt, () => {
      const stale = this.checkConnection(rt, identity.principalId, socketId, cmd.connectionEpoch);
      if (stale) return failure(cmd.requestId, stale, "Esta pestaña ya no está activa en la sala.");
      if (identity.role !== "admin") return failure(cmd.requestId, "NOT_AUTHORIZED", "Solo la administradora puede hacer esto.");
      const fp = this.fingerprint("admin", cmd.action);
      const dup = this.duplicate(rt, identity.principalId, cmd.roomGeneration, cmd.requestId, fp);
      if (dup) return dup;
      const gen = checkGeneration(rt.state, cmd.roomGeneration);
      if (gen) return failure(cmd.requestId, gen.code, gen.message);
      if (cmd.commandSeq <= rt.lastAdminSeq) return failure(cmd.requestId, "STALE_TURN", "Ese cambio llegó tarde: se mantiene el último.");
      if (rt.configMismatch && cmd.action.type !== "room.close" && cmd.action.type !== "room.reset") {
        return failure(cmd.requestId, "CONFIG_MISMATCH", "La sala usa otra revisión del contenido. Puedes reiniciarla o cerrarla.");
      }
      this.touchAdmin(rt);

      const before = rt.state;
      const at = this.mono(); // el reloj de simulación sigue corriendo mientras se guarda: el ancla es este instante, no el del commit
      const change = applyAdminAction(this.settled(rt, at), cmd.action, {
        adminId: rt.adminId,
        presence: this.presenceView(rt),
        config: this.project.config,
        map: this.project.map,
        fingerprint: { configHash: this.project.configHash, mapHash: this.project.mapHash },
      });
      if (!change.ok) return failure(cmd.requestId, change.code, change.message);
      rt.lastAdminSeq = cmd.commandSeq;
      if (!change.changed) return this.ack(cmd.requestId, rt.state);

      const response: CommandResult = { ok: true, requestId: cmd.requestId, stateVersion: change.room.stateVersion, turnVersion: change.room.turnVersion };
      const stored: StoredCommand = { roomId: rt.state.roomId, principalId: identity.principalId, generation: cmd.roomGeneration, requestId: cmd.requestId, fingerprint: fp, response };
      const persisted = this.persist(rt, change.room, stored, at);
      if (persisted) return failure(cmd.requestId, "PERSISTENCE_FAILED", persisted);
      if (change.room.roomGeneration !== before.roomGeneration) {
        rt.configMismatch = this.mismatch(change.room);
        for (const b of rt.buckets.values()) b.forget(identity.principalId);
      }
      this.fanOut(rt, before, change.room, { effects: change.effects });
      if (isTerminal(change.room.phase)) this.closeAll(rt);
      return response;
    });
  }

  /** Acción de aventura del controlador (SPECS 5.2). */
  adventureCommand(identity: AuthIdentity, socketId: string, cmd: AdventureCommand): Promise<CommandResult> {
    const rt = this.rt(identity.roomId);
    if (!this.bucket(rt, "adventure", identity.principalId)) return Promise.resolve(failure(cmd.requestId, "RATE_LIMITED", "Demasiadas acciones seguidas. Espera un momento."));
    return this.run(rt, () => {
      const stale = this.checkConnection(rt, identity.principalId, socketId, cmd.connectionEpoch);
      if (stale) return failure(cmd.requestId, stale, "Esta pestaña ya no está activa en la sala.");
      const fp = this.fingerprint("adventure", cmd.action);
      const dup = this.duplicate(rt, identity.principalId, cmd.roomGeneration, cmd.requestId, fp);
      if (dup) return dup;
      const gen = checkGeneration(rt.state, cmd.roomGeneration);
      if (gen) return failure(cmd.requestId, gen.code, gen.message);
      if (rt.configMismatch) return failure(cmd.requestId, "CONFIG_MISMATCH", "La sala usa otra revisión del contenido; el control está bloqueado.");
      const turn = checkTurn(rt.state, identity.principalId, cmd.turnVersion);
      if (turn) return failure(cmd.requestId, turn.code, turn.message);

      const principal = rt.principals.get(identity.principalId)!;
      const before = rt.state;
      const at = this.mono();
      const change = applyAdventureAction(rt.state, cmd.action, {
        config: this.project.config,
        map: this.project.map,
        nav: this.project.nav,
        actor: { principalId: principal.principalId, role: principal.role, name: displayNameFor(principal.name, principal.distinction) },
        roomGeneration: rt.state.roomGeneration,
        nowIso: this.now().toISOString(),
        activeMs: this.liveActiveMs(rt, at),
      });
      if (!change.ok) return failure(cmd.requestId, change.code, change.message);
      if (!change.changed) return this.ack(cmd.requestId, rt.state);

      const response: CommandResult = { ok: true, requestId: cmd.requestId, stateVersion: change.room.stateVersion, turnVersion: change.room.turnVersion };
      const stored: StoredCommand = { roomId: rt.state.roomId, principalId: identity.principalId, generation: cmd.roomGeneration, requestId: cmd.requestId, fingerprint: fp, response };
      const persisted = this.persist(rt, change.room, stored, at);
      if (persisted) return failure(cmd.requestId, "PERSISTENCE_FAILED", persisted);
      this.fanOut(rt, before, change.room, { effects: change.effects });
      return response;
    });
  }

  private ack(requestId: string, state: RoomState): CommandResult {
    return { ok: true, requestId, stateVersion: state.stateVersion, turnVersion: state.turnVersion };
  }

  /** Detecta un `requestId` ya procesado: misma huella → misma respuesta, sin repetir la mutación; otra huella → se rechaza. */
  private duplicate(rt: Runtime, principalId: string, generation: number, requestId: string, fp: string): CommandResult | null {
    let stored: ReturnType<RoomRepository["findCommand"]>;
    try {
      stored = this.repo.findCommand(rt.state.roomId, principalId, generation, requestId);
    } catch (e) {
      this.log.error("no se pudo consultar el registro de comandos", { error: String(e) });
      return failure(requestId, "PERSISTENCE_FAILED", "No pudimos comprobar tu acción. Intenta de nuevo en unos segundos.");
    }
    if (!stored) return null;
    if (stored.fingerprint !== fp) return failure(requestId, "INVALID_PAYLOAD", "Ese identificador de petición ya se usó con otra acción.");
    return stored.response;
  }

  /**
   * Guarda estado y respuesta en una transacción y solo entonces actualiza la memoria (SPECS 5.4, pasos 6–7). Devuelve un mensaje de
   * error si falló: en ese caso nada cambió ni se anuncia éxito (CT-11).
   */
  private persist(rt: Runtime, next: RoomState, command?: StoredCommand, at: number = this.mono()): string | null {
    try {
      this.repo.commit(next, this.now().toISOString(), command);
    } catch (e) {
      this.log.error("falló la persistencia; la transición se descarta", { roomId: rt.state.roomId, error: e instanceof Error ? e.message : String(e) });
      return "No se pudo guardar el cambio. Tu respuesta no se perdió en tu pantalla: intenta compartirla de nuevo en unos segundos.";
    }
    rt.state = next;
    rt.anchor = at;
    return null;
  }

  // ---- sincronización -------------------------------------------------------------------------------------

  /** Estado permitido para el papel de quien lo pide. La reconexión siempre pasa por aquí: no se reproducen entradas (SPECS 5.4). */
  sync(identity: AuthIdentity, socketId: string): Promise<SyncResult> {
    const rt = this.rt(identity.roomId);
    return this.run(rt, () => {
      if (this.checkConnection(rt, identity.principalId, socketId, null)) return { ok: false, code: "STALE_CONNECTION" as const, message: "Esta pestaña ya no está activa en la sala." };
      this.sendFullStateTo(rt, identity.principalId);
      return { ok: true as const, stateVersion: rt.state.stateVersion };
    });
  }

  private sendFullStateTo(rt: Runtime, principalId: string): void {
    this.out.send(principalId, "room.summary", this.summaryFor(rt, principalId));
    if (principalId === rt.adminId) this.out.send(principalId, "presence.updated", this.presenceList(rt));
    if (principalId === rt.adminId || rt.state.controlOwner?.principalId === principalId) this.out.send(principalId, "room.snapshot", this.snapshot(rt, []));
  }

  // ---- bucle de simulación (SPECS 5.6, 6.1) ----------------------------------------------------------------------

  private timer: ReturnType<typeof setInterval> | null = null;

  /** Con `tickIntervalMs <= 0` no hay temporizador: las pruebas llaman a `tick()` a mano y controlan el reloj. */
  private startLoop(): void {
    if (this.timer || this.settings.tickIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error("falló el bucle de simulación", { error: String(e) })), this.settings.tickIntervalMs);
    this.timer.unref();
  }

  /** Detiene el bucle (cierre ordenado del servidor). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Un paso del bucle: solo toca las salas con algo en movimiento. Cada sala se procesa dentro de su cola, así que nunca se
   * cruza con un comando. Si un paso tarda más que el intervalo, el siguiente de esa sala se omite en lugar de apilarse.
   */
  async tick(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const rt of this.rooms.values()) {
      if (rt.tickBusy || !isSimulating(rt.state)) continue;
      rt.tickBusy = true;
      jobs.push(
        this.run(rt, () => this.simulate(rt))
          .catch((e) => this.log.error("falló un paso de simulación", { roomId: rt.state.roomId, error: String(e) }))
          .finally(() => void (rt.tickBusy = false)),
      );
    }
    await Promise.all(jobs);
  }

  private simulate(rt: Runtime): void {
    const before = rt.state;
    if (!isSimulating(before)) return;
    const at = this.mono();
    const live = this.liveActiveMs(rt, at);
    const t = tickRoom(before, live, this.project.config);

    if (t.changed) {
      // Algo terminó por reloj (el movimiento o una prueba de rampa): es una transición confirmada, con su persistencia.
      // El final lo decide el servidor, una sola vez; si no se puede guardar no se anuncia y se reintenta en el siguiente paso.
      const err = this.persist(rt, t.room, undefined, at);
      if (err) return void this.log.error("no se pudo guardar el fin de un movimiento o prueba; se reintenta", { roomId: before.roomId });
      rt.lastCheckpoint = at;
      this.fanOut(rt, before, rt.state);
    } else if (at - rt.lastCheckpoint >= this.settings.checkpointIntervalMs) {
      // Checkpoint de reloj y posición: no cambia de versión ni se anuncia. Tras una caída abrupta el movimiento puede
      // retroceder hasta este intervalo; lo ya confirmado no se pierde (SPECS 6.1).
      try {
        this.repo.commit(t.room, this.now().toISOString());
        rt.state = t.room;
        rt.anchor = at;
        rt.lastCheckpoint = at;
      } catch (e) {
        this.log.warn("no se pudo guardar el checkpoint de reloj", { roomId: before.roomId, error: String(e) });
      }
    }

    // Muestra visual efímera para la proyección y el controlador; la espera nunca la recibe (canal de vista).
    if (isSimulating(rt.state)) {
      const frame = buildSimulationFrame(rt.state, this.liveActiveMs(rt, at), ++rt.frameSeq);
      if (frame) this.out.sendToView(rt.state.roomId, "simulation.frame", frame);
    }
  }

  // ---- fan-out ----------------------------------------------------------------------------------------------

  private publicController(rt: Runtime): PublicController | null {
    const owner = rt.state.controlOwner;
    if (!owner) return null;
    const p = rt.principals.get(owner.principalId);
    if (!p) return null;
    return { principalId: p.principalId, role: p.role, displayName: displayNameFor(p.name, p.distinction), color: p.color };
  }

  summaryFor(rt: Runtime, principalId: string): RoomSummary {
    const p = rt.principals.get(principalId)!;
    const s = rt.state;
    return {
      code: s.code,
      roomGeneration: s.roomGeneration,
      stateVersion: s.stateVersion,
      turnVersion: s.turnVersion,
      phase: s.phase,
      resumePhase: s.resumePhase,
      controller: this.publicController(rt),
      adminConnected: this.isConnected(rt, rt.adminId),
      configMismatch: rt.configMismatch,
      self: { principalId, role: p.role, displayName: displayNameFor(p.name, p.distinction), color: p.color, connectionEpoch: rt.presence.get(principalId)?.epoch ?? 0, isController: s.controlOwner?.principalId === principalId },
    };
  }

  private presenceList(rt: Runtime): PresenceUpdate {
    const participants: ParticipantInfo[] = [...rt.principals.values()]
      .filter((p) => p.role === "participant")
      .map((p) => ({
        principalId: p.principalId,
        role: p.role,
        displayName: displayNameFor(p.name, p.distinction),
        name: p.name,
        color: p.color,
        distinction: p.distinction,
        connected: this.isConnected(rt, p.principalId),
        isController: rt.state.controlOwner?.principalId === p.principalId,
      }));
    return { participants, connectedCount: participants.filter((p) => p.connected).length };
  }

  private snapshot(rt: Runtime, effects: EffectEvent[]): RoomSnapshot {
    return { state: rt.state, controller: this.publicController(rt), effects };
  }

  private sendPresence(rt: Runtime): void {
    this.out.send(rt.adminId, "presence.updated", this.presenceList(rt));
  }

  /**
   * Anuncia una transición ya confirmada. Orden del cambio de turno (SPECS 5.5): retirar al anterior del canal de vista, actualizar
   * (ya hecho: el estado se guardó antes), añadir al nuevo, enviar el snapshot y anunciar el cambio. Los participantes en espera
   * reciben solo el resumen mínimo: nunca el cuaderno ni las actualizaciones del experimento.
   */
  private fanOut(rt: Runtime, before: RoomState, after: RoomState, opts: { effects?: EffectEvent[]; presenceChanged?: boolean; adminPresenceChanged?: boolean; includeSocketOf?: string } = {}): void {
    const roomId = after.roomId;
    const ownerChanged = !sameOwner(before.controlOwner, after.controlOwner);
    const oldOwner = before.controlOwner;
    const newOwner = after.controlOwner;
    const stateChanged = before !== after;

    // 1. Retirar al anterior del canal de vista; 2. (el estado ya está guardado); 3. añadir al nuevo.
    if (ownerChanged && oldOwner?.role === "participant") this.out.leaveView(oldOwner.principalId, roomId);
    if (ownerChanged && newOwner?.role === "participant" && this.isConnected(rt, newOwner.principalId)) this.out.joinView(newOwner.principalId, roomId);
    if (opts.includeSocketOf === rt.adminId) this.out.joinView(rt.adminId, roomId);

    // Resumen mínimo a todos, solo cuando cambia algo que les importa: la fase, el turno, quién controla o si está la administradora.
    const summaryChanged = before.phase !== after.phase || before.resumePhase !== after.resumePhase || before.turnVersion !== after.turnVersion || before.roomGeneration !== after.roomGeneration || ownerChanged || opts.adminPresenceChanged === true;
    if (summaryChanged) {
      for (const [id, p] of rt.presence) if (p.connected) this.out.send(id, "room.summary", this.summaryFor(rt, id));
    }

    // 4. Enviar el estado. Quien acaba de conectarse recibe su estado completo permitido aunque la sala no haya cambiado.
    const joiner = opts.includeSocketOf;
    if (joiner) {
      if (!summaryChanged) this.out.send(joiner, "room.summary", this.summaryFor(rt, joiner));
      if (!stateChanged && (joiner === rt.adminId || after.controlOwner?.principalId === joiner)) this.out.send(joiner, "room.snapshot", this.snapshot(rt, []));
      if (joiner === rt.adminId) this.out.send(joiner, "presence.updated", this.presenceList(rt));
    }
    if (stateChanged) this.out.sendToView(roomId, "room.snapshot", this.snapshot(rt, opts.effects ?? []));

    // 5. Anunciar el cambio a los afectados.
    if (ownerChanged || before.turnVersion !== after.turnVersion) {
      const change = { controlOwner: after.controlOwner, controller: this.publicController(rt), turnVersion: after.turnVersion, phase: after.phase, resumePhase: after.resumePhase, view: after.adventure.view };
      const affected = new Set<string>([rt.adminId]);
      if (oldOwner) affected.add(oldOwner.principalId);
      if (newOwner) affected.add(newOwner.principalId);
      for (const id of affected) if (this.isConnected(rt, id)) this.out.send(id, "control.changed", change);
    }

    if ((opts.presenceChanged || ownerChanged) && joiner !== rt.adminId) this.sendPresence(rt);
  }

  private closeAll(rt: Runtime): void {
    for (const [id, p] of rt.presence) if (p.connected && id !== rt.adminId) this.out.close(id);
    this.out.close(rt.adminId);
  }

  // ---- consulta (pruebas y diagnóstico; no exponen secretos) --------------------------------------------------------

  /** Copia del estado actual de la sala. Solo para pruebas y diagnóstico. */
  inspect(code: string): { state: RoomState; phase: RoomPhase } | undefined {
    const rt = this.runtimeByCode(code);
    return rt ? { state: rt.state, phase: rt.state.phase } : undefined;
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}

export type { ClientToServerEvents };
