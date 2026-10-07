// Solo pruebas: servidor real en un puerto efímero, SQLite temporal en archivo y clientes Socket.IO con credenciales propias.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import type { ProjectBundle } from "../../../shared/config/validateProject";
import type { AdminAction, AdminCommand, CommandResult, ParticipantAction, ParticipantCommand } from "../../../shared/contracts/actions";
import type { ClientToServerEvents, ClockSample, CreateRoomResponse, GroupSnapshot, JoinRoomResponse, MeSnapshot, PresenceUpdate, PublicCharacter, RoomSummary, ServerToClientEvents } from "../../../shared/contracts/events";
import { realBundle } from "../../../shared/testing/project";
import { createServerApp, type ServerApp } from "../app";
import { loadSettings, type ServerSettings } from "../config";

export interface TestServer {
  app: ServerApp;
  url: string;
  dbPath: string;
  /** Cierra el servidor y, salvo que se indique, borra la carpeta temporal. */
  stop(keepFiles?: boolean): Promise<void>;
}

export interface StartOptions {
  dir?: string;
  project?: ProjectBundle;
  settings?: Partial<ServerSettings>;
  mono?: () => number;
  /** Reloj de pared (vencimientos y marcas de tiempo); por defecto el real. */
  now?: () => Date;
}

export async function startServer(options: StartOptions = {}): Promise<TestServer> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "laboratorio-test-"));
  const dbPath = join(dir, "test.sqlite");
  // Se enlaza a 127.0.0.1 de forma explícita: con la interfaz comodín el SO puede entregar un puerto que otro proceso local ya tiene en
  // 127.0.0.1 (visto aquí: ayudantes de VS Code que responden «Unauthorized») y las pruebas hablarían con ese proceso.
  const settings = loadSettings({}, { databasePath: dbPath, port: 0, host: "127.0.0.1", ...options.settings });
  const app = createServerApp({ settings, project: options.project ?? realBundle(), mono: options.mono, now: options.now });
  const port = await app.listen(options.settings?.port ?? 0);
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    dbPath,
    async stop(keepFiles = false) {
      await app.close();
      if (!keepFiles) rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const folderOf = (server: TestServer): string => server.dbPath.replace(/\/test\.sqlite$/, "");

async function api<T>(url: string, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${url}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  return { status: res.status, body: (await res.json()) as T };
}

export const createRoom = async (url: string, contentSetId = "laboratorio-cosas-cotidianas") => api<CreateRoomResponse>(url, "/api/rooms", { method: "POST", body: JSON.stringify({ contentSetId }) });
export const joinRoom = async (url: string, code: string, name: string, color = "azul", observer?: boolean) => api<JoinRoomResponse>(url, `/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ name, color, ...(observer === undefined ? {} : { observer }) }) });
export const getRoom = async (url: string, code: string) => api<{ code: string; phase: string; title: string }>(url, `/api/rooms/${code}`);

type Pred = () => boolean;

export class TestClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  summary: RoomSummary | null = null;
  presence: PresenceUpdate | null = null;
  /** Estado de grupo recibido (el último y todos, en orden). */
  group: GroupSnapshot | null = null;
  groups: GroupSnapshot[] = [];
  /** Estado personal recibido: solo existe para quien juega. */
  me: MeSnapshot | null = null;
  mes: MeSnapshot[] = [];
  characters = new Map<string, PublicCharacter>();
  clocks: ClockSample[] = [];
  replaced = false;
  disconnected = false;
  connectError: string | null = null;
  readonly log: string[] = [];
  private seq = 0;

  constructor(url: string, readonly token: string | undefined, options: { auth?: Record<string, unknown>; query?: Record<string, string> } = {}) {
    this.socket = io(url, { auth: options.auth ?? { token }, query: options.query, transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.on("room.summary", (s) => {
      this.summary = s;
      this.log.push("room.summary");
    });
    this.socket.on("presence.updated", (p) => {
      this.presence = p;
      this.log.push("presence.updated");
    });
    this.socket.on("group.state", (g) => {
      this.group = g;
      this.groups.push(g);
      this.log.push("group.state");
    });
    this.socket.on("me.state", (m) => {
      this.me = m;
      this.mes.push(m);
      this.log.push("me.state");
    });
    this.socket.on("characters.state", (c) => {
      this.characters = new Map(c.characters.map((x) => [x.principalId, x]));
      this.log.push("characters.state");
    });
    this.socket.on("character.updated", (c) => {
      this.characters.set(c.principalId, c);
      this.log.push("character.updated");
    });
    this.socket.on("clock.sample", (c) => {
      this.clocks.push(c);
      this.log.push("clock.sample");
    });
    this.socket.on("session.replaced", () => {
      this.replaced = true;
      this.log.push("session.replaced");
    });
    this.socket.on("connect_error", (e) => (this.connectError = e.message));
    this.socket.on("disconnect", () => (this.disconnected = true));
  }

  /** Versión de ronda que esta persona conoce (la acción que lleve otra se rechaza como tardía). */
  get roundVersion(): number {
    return Math.max(this.summary?.roundVersion ?? 0, this.group?.roundVersion ?? 0);
  }

  async until(cond: Pred, what: string, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) throw new Error(`Tiempo agotado esperando: ${what}\nEventos: ${this.log.join(", ")}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** Espera a conectar y a recibir el primer resumen. */
  async ready(): Promise<this> {
    await this.until(() => this.summary !== null || this.connectError !== null, "primer resumen de la sala");
    return this;
  }

  /** Espera un instante para comprobar que NO llega nada más. */
  async quiet(ms = 120): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  count(event: string): number {
    return this.log.filter((e) => e === event).length;
  }

  get epoch(): number {
    return this.summary!.self.connectionEpoch;
  }
  get generation(): number {
    return this.summary!.roomGeneration;
  }

  private emitAck<C extends AdminCommand | ParticipantCommand>(event: "admin.command" | "participant.action", payload: C): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, ack: (r: CommandResult) => void) => void }).emit(event, payload, resolve));
  }

  adminEnvelope(action: AdminAction, over: Partial<AdminCommand> = {}): AdminCommand {
    return { requestId: `a${++this.seq}-${Math.random().toString(36).slice(2, 8)}`, roomGeneration: this.generation, connectionEpoch: this.epoch, commandSeq: this.seq, action, ...over };
  }
  participantEnvelope(action: ParticipantAction, over: Partial<ParticipantCommand> = {}): ParticipantCommand {
    return { requestId: `v${++this.seq}-${Math.random().toString(36).slice(2, 8)}`, roomGeneration: this.generation, roundVersion: this.roundVersion, connectionEpoch: this.epoch, action, ...over };
  }

  admin(action: AdminAction, over: Partial<AdminCommand> = {}): Promise<CommandResult> {
    return this.emitAck("admin.command", this.adminEnvelope(action, over));
  }
  /** Acción personal de quien juega. */
  act(action: ParticipantAction, over: Partial<ParticipantCommand> = {}): Promise<CommandResult> {
    return this.emitAck("participant.action", this.participantEnvelope(action, over));
  }
  rawAdmin(payload: unknown): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, a: (r: CommandResult) => void) => void }).emit("admin.command", payload, resolve));
  }
  rawParticipant(payload: unknown): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, a: (r: CommandResult) => void) => void }).emit("participant.action", payload, resolve));
  }

  sync() {
    return new Promise<unknown>((resolve) => this.socket.emit("room.sync", resolve));
  }

  close(): void {
    this.socket.disconnect();
  }
}

/** Crea una sala con administradora y `names.length` participantes (más observadores opcionales), todos conectados con credenciales distintas. */
export async function setupRoom(server: TestServer, names: string[] = ["Ana", "Beto"], options: { observers?: string[] } = {}) {
  const created = await createRoom(server.url);
  if (created.status !== 201) throw new Error(`No se pudo crear la sala: ${JSON.stringify(created.body)}`);
  const code = created.body.code;
  const admin = await new TestClient(server.url, created.body.adminToken).ready();
  const people: Array<{ client: TestClient; join: JoinRoomResponse }> = [];
  const colors = ["azul", "verde", "rojo", "rosa", "morado", "naranja", "turquesa", "amarillo"];
  for (const [i, name] of names.entries()) {
    const j = await joinRoom(server.url, code, name, colors[i % colors.length]);
    if (j.status !== 201) throw new Error(`No se pudo entrar: ${JSON.stringify(j.body)}`);
    const client = await new TestClient(server.url, j.body.token).ready();
    people.push({ client, join: j.body });
  }
  const observers: Array<{ client: TestClient; join: JoinRoomResponse }> = [];
  for (const name of options.observers ?? []) {
    const j = await joinRoom(server.url, code, name, "azul", true);
    if (j.status !== 201) throw new Error(`No se pudo entrar como observador: ${JSON.stringify(j.body)}`);
    observers.push({ client: await new TestClient(server.url, j.body.token).ready(), join: j.body });
  }
  const total = names.length + observers.length;
  await admin.until(() => admin.presence?.connectedCount === total, "todos los participantes conectados en la presencia");
  // Quien juega ya tiene su estado y personaje.
  for (const p of people) await p.client.until(() => p.client.me !== null, `estado personal de ${p.join.displayName}`);
  const everyone = [admin, ...people.map((p) => p.client), ...observers.map((o) => o.client)];
  return { code, admin, adminToken: created.body.adminToken, created: created.body, people, observers, clients: everyone };
}

/** Espera a que todas las conexiones (menos Vanessa, que la recibe por la respuesta) conozcan la versión de ronda indicada. */
export async function inSync(r: Pick<Awaited<ReturnType<typeof setupRoom>>, "people" | "observers">, roundVersion: number): Promise<void> {
  for (const p of [...r.people, ...r.observers]) await p.client.until(() => p.client.roundVersion >= roundVersion, `ronda ${roundVersion} visible para ${p.join.displayName}`);
}

/** Comienza la aventura y abre la mesa de la ronda: todas las personas quedan en exploración y conocen la ronda vigente. */
export async function beginExploration(r: Awaited<ReturnType<typeof setupRoom>>): Promise<void> {
  const start = await r.admin.admin({ type: "room.start" });
  if (!start.ok) throw new Error(`room.start: ${start.message}`);
  const open = await r.admin.admin({ type: "round.open" });
  if (!open.ok) throw new Error(`round.open: ${open.message}`);
  await inSync(r, open.roundVersion);
  for (const p of r.people) await p.client.until(() => p.client.group?.adventure.round.stage === "exploration", `exploración visible para ${p.join.displayName}`);
}
