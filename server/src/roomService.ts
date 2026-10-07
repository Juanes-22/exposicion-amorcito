import { contentHash } from "../../shared/config/hash";
import type { ProjectBundle } from "../../shared/config/validateProject";
import type { AdminCommand, CommandResult, ParticipantCommand } from "../../shared/contracts/actions";
import type {
  ClientToServerEvents,
  ClockSample,
  CreateRoomResponse,
  EffectEvent,
  GroupSnapshot,
  JoinRoomRequest,
  JoinRoomResponse,
  MeSnapshot,
  ParticipantInfo,
  PresenceUpdate,
  PublicCharacter,
  RoomPublicInfo,
  RoomSummary,
  ServerToClientEvents,
  SyncResult,
} from "../../shared/contracts/events";
import { PARTICIPANT_COLOR_IDS, type CommandErrorCode, type HttpErrorCode } from "../../shared/contracts/limits";
import type { AdventureState, RoomPhase, RoomState } from "../../shared/contracts/state";
import { displayNameFor, nameKey, normalizeName } from "../../shared/domain/text";
import {
  applyAdminAction,
  applyParticipantAction,
  checkGeneration,
  checkRound,
  createRoomState,
  ensureParticipant,
  expireRoom,
  isClockRunning,
  isSimulating,
  isTerminal,
  onAdminLost,
  recoverAfterRestart,
  tickRoom,
  type RoomChange,
} from "../../shared/domain/room";
import { personReadiness } from "../../shared/domain/results";
import { currentActivityId, roundCounter, roundMembers } from "../../shared/domain/round";
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

/** Lo que el servicio necesita del transporte: entrega a conexiones concretas y al canal de toda la sala. */
export interface Outbox {
  send<E extends EventName>(principalId: string, event: E, ...args: EventArgs<E>): void;
  /** Canal de la sala: todas las personas conectadas (Vanessa, participantes y observadores). */
  broadcast<E extends EventName>(roomId: string, event: E, ...args: EventArgs<E>): void;
  join(principalId: string, roomId: string): void;
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
  /** Reloj monotónico en el último commit: el tiempo activo corre desde aquí mientras la sala está en curso. */
  anchor: number;
  /** Marcas del bucle de simulación (SPECS 5.6, 6.1). */
  clockSeq: number;
  lastClock: number;
  lastCheckpoint: number;
  tickBusy: boolean;
  queue: Promise<unknown>;
  configMismatch: boolean;
  buckets: Map<string, KeyedLimiter>;
  /** Última señal autenticada de la administradora (ms de reloj de pared). Solo ella mantiene viva la sala (SPECS 6.3). */
  adminActiveAt: number;
  /** Cuándo pasó a terminal (ms de reloj de pared); `null` mientras siga viva. Con él se decide la limpieza. */
  terminalAt: number | null;
  /** Último contador enviado a Vanessa: solo se vuelve a enviar cuando algo que le importa cambió. */
  lastPresenceKey: string;
}

export interface AuthIdentity {
  principalId: string;
  roomId: string;
  role: PrincipalRecord["role"];
}

const failure = (requestId: string, code: CommandErrorCode, message: string): CommandResult => ({ ok: false, requestId, code, message });

/** Lo del estado de grupo que importa a todas las personas: si no cambia, no se vuelve a enviar. */
const groupKey = (a: AdventureState): string => JSON.stringify([a.round, a.completed, a.pieces, a.notebook, a.presentedNoteId, a.inventor]);

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

  private newRuntime(state: RoomState, principals: Map<string, PrincipalRecord>, adminId: string, adminActiveAt: number, terminalAt: number | null): Runtime {
    return {
      state,
      principals,
      presence: new Map(),
      adminId,
      lastAdminSeq: 0,
      anchor: this.mono(),
      clockSeq: 0,
      lastClock: this.mono(),
      lastCheckpoint: this.mono(),
      tickBusy: false,
      queue: Promise.resolve(),
      configMismatch: this.mismatch(state),
      buckets: new Map(),
      adminActiveAt,
      terminalAt,
      lastPresenceKey: "",
    };
  }

  // ---- arranque y recuperación ------------------------------------------------------------------------

  /**
   * Recupera las salas durables. Las salas en curso quedan pausadas y con `roundVersion` nuevo; la presencia se reconstruye como
   * desconectada y no se suma el tiempo que el servidor estuvo apagado (SPECS 6.1).
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
      this.rooms.set(state.roomId, this.newRuntime(state, principals, admin.principalId, Date.parse(stored.lastAdminActivityAt) || this.now().getTime(), isTerminal(state.phase) ? Date.parse(stored.terminalAt ?? "") || this.now().getTime() : null));
      this.byCode.set(state.code, state.roomId);
      if (this.mismatch(state)) this.log.warn("CONFIG_MISMATCH: la sala usa otra revisión de configuración o mapa", { roomId: state.roomId });
    }
    this.startLoop();
    this.startSweep();
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
    const admin: PrincipalRecord = { principalId: newId(), roomId, role: "admin", name: this.adminName(), nameKey: "", color: null, distinction: 1, observer: false, tokenHash: hashToken(token), createdAt: nowIso };
    try {
      this.repo.createRoom(state, admin, nowIso);
    } catch (e) {
      this.log.error("no se pudo crear la sala", { error: String(e) });
      throw new ServiceError(503, "INTERNAL", "No se pudo crear la sala. Intenta de nuevo.");
    }
    this.rooms.set(roomId, this.newRuntime(state, new Map([[admin.principalId, admin]]), admin.principalId, this.now().getTime(), null));
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
    if (isTerminal(rt.state.phase)) throw new ServiceError(410, "ROOM_UNAVAILABLE", rt.state.phase === "expired" ? "Esta sala venció por inactividad." : "Esta sala ya terminó.");
    const name = normalizeName(body.name);
    if (!name.ok) throw new ServiceError(400, "INVALID_PAYLOAD", name.message);
    if (!PARTICIPANT_COLOR_IDS.includes(body.color)) throw new ServiceError(400, "INVALID_PAYLOAD", "Elige un color de la paleta.");
    if (this.repo.countParticipants(rt.state.roomId) >= this.project.config.session.maxParticipants) throw new ServiceError(409, "ROOM_FULL", "La sala está llena.");

    const token = newToken();
    const observer = body.observer === true;
    let record: PrincipalRecord;
    try {
      record = this.repo.addParticipant({ principalId: newId(), roomId: rt.state.roomId, role: "participant", name: name.value, nameKey: nameKey(name.value), color: body.color, observer, tokenHash: hashToken(token), createdAt: this.now().toISOString() });
    } catch (e) {
      this.log.error("no se pudo registrar al participante", { error: String(e) });
      throw new ServiceError(503, "INTERNAL", "No se pudo entrar a la sala. Intenta de nuevo.");
    }
    rt.principals.set(record.principalId, record);
    this.sendPresence(rt);
    return { principalId: record.principalId, name: record.name, displayName: displayNameFor(record.name, record.distinction), color: body.color, distinction: record.distinction, observer, token };
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

  // ---- cola serial por sala ----------------------------------------------------------------------------

  /** Cada sala procesa sus mutaciones de una en una (SPECS 5.4). Un fallo no rompe la cola. */
  private run<T>(rt: Runtime, fn: () => T | Promise<T>): Promise<T> {
    const next = rt.queue.then(fn, fn);
    rt.queue = next.catch(() => undefined);
    return next;
  }

  // ---- reloj ---------------------------------------------------------------------------------------------

  /** Tiempo activo actual: lo guardado en el último commit más lo corrido desde entonces, solo con la sala en curso (invariante 6). */
  private liveActiveMs(rt: Runtime, at: number = this.mono()): number {
    const base = rt.state.adventure.timeline.activeMs;
    return isClockRunning(rt.state) ? base + Math.max(0, at - rt.anchor) : base;
  }

  /** La sala con el reloj al día y las pruebas vencidas asentadas. Antes de cualquier cambio hay que fijar el instante para no perder tiempo. */
  private settled(rt: Runtime, at: number = this.mono()): RoomState {
    return tickRoom(rt.state, this.liveActiveMs(rt, at)).room;
  }

  // ---- presencia -----------------------------------------------------------------------------------------

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
    const rt = this.rooms.get(identity.roomId);
    if (!rt) return Promise.reject(new Error("La sala ya no existe")); // eliminada por la limpieza entre la autenticación y la conexión
    return this.run(rt, () => {
      const id = identity.principalId;
      const prev = rt.presence.get(id);
      const replacedSocketId = prev?.connected ? prev.socketId : null;
      const presence: Presence = { connected: true, epoch: (prev?.epoch ?? 0) + 1, socketId };
      rt.presence.set(id, presence);
      this.out.join(id, rt.state.roomId);

      const before = rt.state;
      let next = before;
      if (!isTerminal(before.phase)) {
        if (identity.role === "admin") {
          rt.lastAdminSeq = 0;
          this.touchAdmin(rt);
          // Quien recarga o sustituye su conexión recupera la conducción con la aventura pausada (CA-26).
          next = this.applyPolicy(rt, onAdminLost);
        } else if (!rt.principals.get(id)?.observer) {
          next = this.enroll(rt, id);
        }
      }
      this.fanOut(rt, before, next, { joiner: id });
      return { epoch: presence.epoch, replacedSocketId, terminal: isTerminal(next.phase) };
    });
  }

  /** Da de alta el estado de quien juega, con su personaje en la entrada. Se guarda: forma parte de la sala. */
  private enroll(rt: Runtime, principalId: string): RoomState {
    if (rt.state.participants[principalId]) return rt.state;
    const at = this.mono();
    const next = ensureParticipant(this.settled(rt, at), principalId, this.project.config, this.project.map);
    const failed = this.persist(rt, next, undefined, at);
    if (failed) this.log.error("no se pudo guardar el alta de un participante; se reintenta al reconectar", { roomId: rt.state.roomId });
    return rt.state;
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
      if (!isTerminal(before.phase) && identity.role === "admin") next = this.applyPolicy(rt, onAdminLost);
      // Una persona que se desconecta conserva su progreso y su lugar en el contador: solo aparece «Sin conexión».
      this.fanOut(rt, before, next, { disconnected: id });
    });
  }

  /**
   * Aplica una política automática de conexión. Son transiciones de seguridad (pausar): si la persistencia falla se aplican
   * igualmente en memoria y se registra, porque dejar jugar sin quien conduce es peor.
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
    const now = this.now();
    rt.adminActiveAt = now.getTime();
    try {
      this.repo.touchAdminActivity(rt.state.roomId, now.toISOString());
    } catch (e) {
      this.log.warn("no se pudo registrar la actividad de la administradora", { error: String(e) });
    }
  }

  /** Señal de actividad autenticada de la administradora (SPECS 6.3). */
  adminActivity(identity: AuthIdentity, socketId: string): Promise<void> {
    const rt = this.rooms.get(identity.roomId);
    if (!rt) return Promise.resolve();
    return this.run(rt, () => {
      if (identity.role !== "admin" || this.checkConnection(rt, identity.principalId, socketId, null)) return;
      this.touchAdmin(rt);
    });
  }

  // ---- comandos ------------------------------------------------------------------------------------------

  private bucket(rt: Runtime, kind: "participant" | "admin", principalId: string): boolean {
    const rl = this.settings.rateLimits;
    let limiter = rt.buckets.get(kind);
    if (!limiter) {
      limiter = kind === "admin" ? new KeyedLimiter(rl.adminBurst, rl.adminPerSecond) : new KeyedLimiter(rl.participantBurst, rl.participantPerSecond);
      rt.buckets.set(kind, limiter);
    }
    return limiter.allow(principalId);
  }

  private fingerprint(kind: "admin" | "participant", action: unknown): string {
    return contentHash({ kind, action });
  }

  private displayName(rt: Runtime, principalId: string): string {
    const p = rt.principals.get(principalId);
    return p ? displayNameFor(p.name, p.distinction) : principalId;
  }

  /** Comando de Vanessa (SPECS 5.2). Orden de comprobaciones: conexión → duplicado → generación → secuencia → dominio → persistencia. */
  adminCommand(identity: AuthIdentity, socketId: string, cmd: AdminCommand): Promise<CommandResult> {
    const rt = this.rooms.get(identity.roomId);
    if (!rt) return Promise.resolve(failure(cmd.requestId, "ROOM_UNAVAILABLE", "La sala ya no está disponible."));
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
      const settled = this.settled(rt, at);
      const change = applyAdminAction(settled, cmd.action, {
        config: this.project.config,
        map: this.project.map,
        nowIso: this.now().toISOString(),
        activeMs: settled.adventure.timeline.activeMs,
        nameOf: (id) => this.displayName(rt, id),
        fingerprint: { configHash: this.project.configHash, mapHash: this.project.mapHash },
      });
      if (!change.ok) return failure(cmd.requestId, change.code, change.message);
      rt.lastAdminSeq = cmd.commandSeq;
      if (!change.changed) return this.ack(cmd.requestId, rt.state);

      const response: CommandResult = { ok: true, requestId: cmd.requestId, stateVersion: change.room.stateVersion, roundVersion: change.room.roundVersion };
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

  /** Acción personal de quien juega (SPECS 5.2): cada persona actúa sobre su propio personaje y sus propias pruebas, a la vez que las demás. */
  participantCommand(identity: AuthIdentity, socketId: string, cmd: ParticipantCommand): Promise<CommandResult> {
    const rt = this.rooms.get(identity.roomId);
    if (!rt) return Promise.resolve(failure(cmd.requestId, "ROOM_UNAVAILABLE", "La sala ya no está disponible."));
    if (!this.bucket(rt, "participant", identity.principalId)) return Promise.resolve(failure(cmd.requestId, "RATE_LIMITED", "Demasiadas acciones seguidas. Espera un momento."));
    return this.run(rt, () => {
      const stale = this.checkConnection(rt, identity.principalId, socketId, cmd.connectionEpoch);
      if (stale) return failure(cmd.requestId, stale, "Esta pestaña ya no está activa en la sala.");
      if (identity.role !== "participant" || rt.principals.get(identity.principalId)?.observer) return failure(cmd.requestId, "NOT_AUTHORIZED", "Estás como observador: sigue la aventura en la proyección.");
      const fp = this.fingerprint("participant", cmd.action);
      const dup = this.duplicate(rt, identity.principalId, cmd.roomGeneration, cmd.requestId, fp);
      if (dup) return dup;
      const gen = checkGeneration(rt.state, cmd.roomGeneration);
      if (gen) return failure(cmd.requestId, gen.code, gen.message);
      if (rt.configMismatch) return failure(cmd.requestId, "CONFIG_MISMATCH", "La sala usa otra revisión del contenido; el juego está bloqueado.");
      const round = checkRound(rt.state, cmd.roundVersion);
      if (round) return failure(cmd.requestId, round.code, round.message);

      const before = rt.state;
      const at = this.mono();
      const settled = this.settled(rt, at);
      const change = applyParticipantAction(settled, identity.principalId, cmd.action, { config: this.project.config, map: this.project.map, nav: this.project.nav, activeMs: settled.adventure.timeline.activeMs });
      if (!change.ok) return failure(cmd.requestId, change.code, change.message);
      if (!change.changed) return this.ack(cmd.requestId, rt.state);

      const response: CommandResult = { ok: true, requestId: cmd.requestId, stateVersion: change.room.stateVersion, roundVersion: change.room.roundVersion };
      const stored: StoredCommand = { roomId: rt.state.roomId, principalId: identity.principalId, generation: cmd.roomGeneration, requestId: cmd.requestId, fingerprint: fp, response };
      const persisted = this.persist(rt, change.room, stored, at);
      if (persisted) return failure(cmd.requestId, "PERSISTENCE_FAILED", persisted);
      this.fanOut(rt, before, change.room, { effects: change.effects });
      return response;
    });
  }

  private ack(requestId: string, state: RoomState): CommandResult {
    return { ok: true, requestId, stateVersion: state.stateVersion, roundVersion: state.roundVersion };
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
      return "No se pudo guardar el cambio. Intenta de nuevo en unos segundos.";
    }
    rt.state = next;
    rt.anchor = at;
    if (isTerminal(next.phase) && rt.terminalAt === null) rt.terminalAt = this.now().getTime();
    return null;
  }

  // ---- sincronización -------------------------------------------------------------------------------------

  /** Estado permitido para el papel de quien lo pide. La reconexión siempre pasa por aquí: no se reproducen entradas (SPECS 5.4). */
  sync(identity: AuthIdentity, socketId: string): Promise<SyncResult> {
    const rt = this.rooms.get(identity.roomId);
    if (!rt) return Promise.resolve({ ok: false, code: "ROOM_UNAVAILABLE" as const, message: "La sala ya no está disponible." });
    return this.run(rt, () => {
      if (this.checkConnection(rt, identity.principalId, socketId, null)) return { ok: false, code: "STALE_CONNECTION" as const, message: "Esta pestaña ya no está activa en la sala." };
      this.sendFullStateTo(rt, identity.principalId);
      return { ok: true as const, stateVersion: rt.state.stateVersion };
    });
  }

  /** Todo lo que esta persona puede ver, completo: su resumen, el grupo, los personajes, su estado personal y, a Vanessa, el contador. */
  private sendFullStateTo(rt: Runtime, principalId: string): void {
    this.out.send(principalId, "room.summary", this.summaryFor(rt, principalId));
    this.out.send(principalId, "group.state", this.groupSnapshot(rt, []));
    this.out.send(principalId, "characters.state", { roomGeneration: rt.state.roomGeneration, characters: this.characters(rt) });
    const me = this.meSnapshot(rt, principalId);
    if (me) this.out.send(principalId, "me.state", me);
    if (principalId === rt.adminId) this.out.send(principalId, "presence.updated", this.presenceList(rt));
    this.out.send(principalId, "clock.sample", this.clockSample(rt));
  }

  // ---- bucle de simulación (SPECS 5.6, 6.1) ----------------------------------------------------------------------

  private timer: ReturnType<typeof setInterval> | null = null;

  /** Con `tickIntervalMs <= 0` no hay temporizador: las pruebas llaman a `tick()` a mano y controlan el reloj. */
  private startLoop(): void {
    if (this.timer || this.settings.tickIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error("falló el bucle de simulación", { error: String(e) })), this.settings.tickIntervalMs);
    this.timer.unref();
  }

  /** Detiene el bucle y el barrido de vencimientos (cierre ordenado del servidor). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ---- vencimiento y limpieza (SPECS 6.3) ---------------------------------------------------------------------

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  private startSweep(): void {
    if (this.sweepTimer || this.settings.sweepIntervalMs <= 0) return;
    this.sweepTimer = setInterval(() => void this.sweep().catch((e) => this.log.error("falló el barrido de vencimientos", { error: String(e) })), this.settings.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  /** Vencimiento efectivo: el valor del servidor prevalece sobre el del JSON público (SPECS 9.1). */
  private get adminIdleTtlMs(): number {
    return this.settings.adminIdleTtlMs ?? this.project.config.session.adminIdleTtlMs;
  }

  /**
   * Revisa vencimientos y limpieza. Una sala viva cuya administradora lleva más del TTL sin dar señales autenticadas (comandos o
   * `admin.activity`; los participantes no la mantienen viva) vence: pasa a terminal, se avisa y se cierran las conexiones. Una sala
   * terminal cuya retención ya pasó se elimina por completo: sala, identidades y comandos procesados. Cada sala se procesa dentro de su
   * cola, así que no se cruza con un comando. Si guardar falla, no se cambia nada en memoria y se reintenta en el siguiente barrido.
   */
  async sweep(): Promise<{ expired: number; purged: number }> {
    const result = { expired: 0, purged: 0 };
    const ttl = this.adminIdleTtlMs;
    const retention = this.settings.terminalRetentionMs;
    for (const rt of [...this.rooms.values()]) {
      const outcome = await this.run(rt, () => {
        const nowMs = this.now().getTime();
        if (!isTerminal(rt.state.phase)) {
          if (ttl <= 0 || nowMs - rt.adminActiveAt < ttl) return "none" as const;
          const before = rt.state;
          const at = this.mono();
          const change = expireRoom(this.settled(rt, at));
          if (!change.ok || !change.changed) return "none" as const;
          const failed = this.persist(rt, change.room, undefined, at);
          if (failed) return "none" as const; // sin guardar no se anuncia: se reintenta
          this.fanOut(rt, before, change.room);
          this.closeAll(rt);
          return "expired" as const;
        }
        if (rt.terminalAt === null || nowMs - rt.terminalAt < retention) return "none" as const;
        try {
          this.closeAll(rt); // por si alguien siguiera conectado a una sala terminal
          this.repo.deleteRoom(rt.state.roomId); // en cascada: identidades y comandos procesados
        } catch (e) {
          this.log.error("no se pudo limpiar una sala terminal; se reintenta", { roomId: rt.state.roomId, error: String(e) });
          return "none" as const;
        }
        this.rooms.delete(rt.state.roomId);
        this.byCode.delete(rt.state.code);
        return "purged" as const;
      });
      if (outcome === "expired") result.expired++;
      else if (outcome === "purged") result.purged++;
    }
    return result;
  }

  /**
   * Un paso del bucle: solo toca las salas con algo en movimiento (una prueba de rampa en marcha o alguien caminando). Cada sala se
   * procesa dentro de su cola, así que nunca se cruza con un comando. Si un paso tarda más que el intervalo, el siguiente de esa sala
   * se omite en lugar de apilarse.
   */
  async tick(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const rt of this.rooms.values()) {
      if (rt.tickBusy || !isSimulating(rt.state, this.liveActiveMs(rt))) continue;
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
    const at = this.mono();
    const live = this.liveActiveMs(rt, at);
    if (!isSimulating(before, live)) return;
    const t = tickRoom(before, live);

    if (t.changed) {
      // Una prueba terminó por reloj: es una transición confirmada, con su persistencia. El final lo decide el servidor, una sola
      // vez; si no se puede guardar no se anuncia y se reintenta en el siguiente paso.
      const err = this.persist(rt, t.room, undefined, at);
      if (err) return void this.log.error("no se pudo guardar el fin de una prueba; se reintenta", { roomId: before.roomId });
      rt.lastCheckpoint = at;
      this.fanOut(rt, before, rt.state);
    } else if (at - rt.lastCheckpoint >= this.settings.checkpointIntervalMs) {
      // Checkpoint de reloj: no cambia de versión ni se anuncia. Tras una caída abrupta lo ya confirmado no se pierde (SPECS 6.1).
      try {
        this.repo.commit(t.room, this.now().toISOString());
        rt.state = t.room;
        rt.anchor = at;
        rt.lastCheckpoint = at;
      } catch (e) {
        this.log.warn("no se pudo guardar el checkpoint de reloj", { roomId: before.roomId, error: String(e) });
      }
    }

    // Muestra del reloj para todas las personas: cada cliente interpola entre muestras y el servidor decide (nunca el dispositivo).
    if (at - rt.lastClock >= this.settings.clockSampleMs) {
      rt.lastClock = at;
      this.out.broadcast(rt.state.roomId, "clock.sample", this.clockSample(rt, at));
    }
  }

  // ---- lo que ve cada audiencia -------------------------------------------------------------------------------

  private summaryFor(rt: Runtime, principalId: string): RoomSummary {
    const p = rt.principals.get(principalId)!;
    const s = rt.state;
    return {
      code: s.code,
      roomGeneration: s.roomGeneration,
      stateVersion: s.stateVersion,
      roundVersion: s.roundVersion,
      phase: s.phase,
      resumePhase: s.resumePhase,
      adminConnected: this.isConnected(rt, rt.adminId),
      configMismatch: rt.configMismatch,
      self: { principalId, role: p.role, displayName: displayNameFor(p.name, p.distinction), color: p.color, connectionEpoch: rt.presence.get(principalId)?.epoch ?? 0, observer: p.observer },
    };
  }

  private groupSnapshot(rt: Runtime, effects: EffectEvent[]): GroupSnapshot {
    const s = rt.state;
    return { roomGeneration: s.roomGeneration, stateVersion: s.stateVersion, roundVersion: s.roundVersion, phase: s.phase, adventure: s.adventure, effects };
  }

  private meSnapshot(rt: Runtime, principalId: string): MeSnapshot | null {
    const participant = rt.state.participants[principalId];
    return participant ? { roomGeneration: rt.state.roomGeneration, stateVersion: rt.state.stateVersion, participant } : null;
  }

  private characterOf(rt: Runtime, principalId: string): PublicCharacter | null {
    const p = rt.principals.get(principalId);
    const st = rt.state.participants[principalId];
    if (!p || !st) return null;
    return { principalId, displayName: displayNameFor(p.name, p.distinction), color: p.color, connected: this.isConnected(rt, principalId), character: st.character };
  }

  private characters(rt: Runtime): PublicCharacter[] {
    return Object.keys(rt.state.participants)
      .map((id) => this.characterOf(rt, id))
      .filter((c): c is PublicCharacter => c !== null);
  }

  private clockSample(rt: Runtime, at: number = this.mono()): ClockSample {
    return { roomGeneration: rt.state.roomGeneration, stateVersion: rt.state.stateVersion, activeMs: this.liveActiveMs(rt, at), running: isClockRunning(rt.state), seq: ++rt.clockSeq };
  }

  /** Quién está conectado y cuántas personas están listas en la ronda: solo para Vanessa. */
  private presenceList(rt: Runtime): PresenceUpdate {
    const config = this.project.config;
    const stage = rt.state.adventure.round.stage;
    const exploring = stage === "exploration" || stage === "conversation";
    const activityId = currentActivityId(rt.state.adventure, config);
    const members = new Set(exploring ? roundMembers(rt.state) : []);
    const participants: ParticipantInfo[] = [...rt.principals.values()]
      .filter((p) => p.role === "participant")
      .map((p) => {
        const st = rt.state.participants[p.principalId];
        const r = exploring && activityId && st ? personReadiness(st, activityId, config) : null;
        return {
          principalId: p.principalId,
          role: p.role,
          displayName: displayNameFor(p.name, p.distinction),
          name: p.name,
          color: p.color,
          distinction: p.distinction,
          connected: this.isConnected(rt, p.principalId),
          observer: p.observer,
          inRound: members.has(p.principalId),
          ready: r?.ready ?? false,
          progress: r ? { done: r.done, needed: r.needed } : null,
        };
      });
    const counter = roundCounter(rt.state, config);
    return { participants, connectedCount: participants.filter((p) => p.connected).length, round: { ready: counter.ready, total: counter.total } };
  }

  private sendPresence(rt: Runtime, force = false): void {
    const list = this.presenceList(rt);
    const key = JSON.stringify(list);
    if (!force && key === rt.lastPresenceKey) return;
    rt.lastPresenceKey = key;
    this.out.send(rt.adminId, "presence.updated", list);
  }

  /**
   * Anuncia una transición ya confirmada, a cada audiencia lo suyo (el estado ya se guardó antes):
   * - A todas las personas: el resumen (fase, ronda), el estado de grupo, los personajes que cambiaron y el reloj.
   * - A cada participante, SU estado personal si cambió: nunca el de otra persona.
   * - A Vanessa, además, quién está conectado y cuántas personas están listas, solo cuando eso cambió.
   */
  private fanOut(rt: Runtime, before: RoomState, after: RoomState, opts: { effects?: EffectEvent[]; joiner?: string; disconnected?: string } = {}): void {
    const roomId = after.roomId;
    const joiner = opts.joiner;
    const generationChanged = before.roomGeneration !== after.roomGeneration;
    const summaryChanged = before.phase !== after.phase || before.resumePhase !== after.resumePhase || before.roundVersion !== after.roundVersion || generationChanged || joiner === rt.adminId;
    const groupChanged = summaryChanged || groupKey(before.adventure) !== groupKey(after.adventure) || (opts.effects?.length ?? 0) > 0;

    if (summaryChanged) for (const [id, p] of rt.presence) if (p.connected && id !== joiner) this.out.send(id, "room.summary", this.summaryFor(rt, id));
    if (groupChanged) this.out.broadcast(roomId, "group.state", this.groupSnapshot(rt, opts.effects ?? []));

    if (generationChanged) {
      this.out.broadcast(roomId, "characters.state", { roomGeneration: after.roomGeneration, characters: this.characters(rt) });
      for (const id of Object.keys(after.participants)) {
        const me = this.meSnapshot(rt, id);
        if (me && this.isConnected(rt, id) && id !== joiner) this.out.send(id, "me.state", me);
      }
    } else {
      for (const id of Object.keys(after.participants)) {
        const b = before.participants[id];
        const a = after.participants[id]!;
        if (b === a) continue;
        if (this.isConnected(rt, id) && id !== joiner) {
          this.out.send(id, "me.state", this.meSnapshot(rt, id)!);
          // La prueba que empieza o termina se anima con el reloj de simulación: se le recuerda para que coincida con el del servidor.
          this.out.send(id, "clock.sample", this.clockSample(rt));
        }
        if (!b || JSON.stringify(b.character) !== JSON.stringify(a.character)) {
          const c = this.characterOf(rt, id);
          if (c && id !== joiner) this.out.broadcast(roomId, "character.updated", c);
        }
      }
    }
    if (before.phase !== after.phase) this.out.broadcast(roomId, "clock.sample", this.clockSample(rt));

    // Quien acaba de conectarse recibe su estado completo permitido aunque la sala no haya cambiado; los demás ven que apareció.
    if (joiner) {
      this.sendFullStateTo(rt, joiner);
      const c = this.characterOf(rt, joiner);
      if (c) this.out.broadcast(roomId, "character.updated", c);
    }
    if (opts.disconnected) {
      const c = this.characterOf(rt, opts.disconnected);
      if (c) this.out.broadcast(roomId, "character.updated", c);
    }

    this.sendPresence(rt, joiner === rt.adminId);
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
