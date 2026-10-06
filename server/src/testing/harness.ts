// Solo pruebas: servidor real en un puerto efímero, SQLite temporal en archivo y clientes Socket.IO con credenciales propias.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import type { ProjectBundle } from "../../../shared/config/validateProject";
import type { AdminAction, AdminCommand, AdventureAction, AdventureCommand, CommandResult } from "../../../shared/contracts/actions";
import type { ClientToServerEvents, ControlChanged, CreateRoomResponse, JoinRoomResponse, PresenceUpdate, RoomSnapshot, RoomSummary, ServerToClientEvents } from "../../../shared/contracts/events";
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
}

export async function startServer(options: StartOptions = {}): Promise<TestServer> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "laboratorio-test-"));
  const dbPath = join(dir, "test.sqlite");
  // Se enlaza a 127.0.0.1 de forma explícita: con la interfaz comodín el SO puede entregar un puerto que otro proceso local ya tiene en
  // 127.0.0.1 (visto aquí: ayudantes de VS Code que responden «Unauthorized») y las pruebas hablarían con ese proceso.
  const settings = loadSettings({}, { databasePath: dbPath, port: 0, host: "127.0.0.1", ...options.settings });
  const app = createServerApp({ settings, project: options.project ?? realBundle(), mono: options.mono });
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
export const joinRoom = async (url: string, code: string, name: string, color = "azul") => api<JoinRoomResponse>(url, `/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ name, color }) });
export const getRoom = async (url: string, code: string) => api<{ code: string; phase: string; title: string }>(url, `/api/rooms/${code}`);

type Pred = () => boolean;

export class TestClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  summary: RoomSummary | null = null;
  presence: PresenceUpdate | null = null;
  snapshots: RoomSnapshot[] = [];
  changes: ControlChanged[] = [];
  replaced = false;
  disconnected = false;
  connectError: string | null = null;
  readonly log: string[] = [];
  turnVersion = 0;
  private seq = 0;

  constructor(url: string, readonly token: string | undefined, options: { auth?: Record<string, unknown>; query?: Record<string, string> } = {}) {
    this.socket = io(url, { auth: options.auth ?? { token }, query: options.query, transports: ["websocket"], reconnection: false, forceNew: true });
    this.socket.on("room.summary", (s) => {
      this.summary = s;
      this.turnVersion = Math.max(this.turnVersion, s.turnVersion);
      this.log.push("room.summary");
    });
    this.socket.on("presence.updated", (p) => {
      this.presence = p;
      this.log.push("presence.updated");
    });
    this.socket.on("room.snapshot", (s) => {
      this.snapshots.push(s);
      this.turnVersion = Math.max(this.turnVersion, s.state.turnVersion);
      this.log.push("room.snapshot");
    });
    this.socket.on("control.changed", (c) => {
      this.changes.push(c);
      this.turnVersion = Math.max(this.turnVersion, c.turnVersion);
      this.log.push("control.changed");
    });
    this.socket.on("simulation.frame", () => this.log.push("simulation.frame"));
    this.socket.on("session.replaced", () => {
      this.replaced = true;
      this.log.push("session.replaced");
    });
    this.socket.on("connect_error", (e) => (this.connectError = e.message));
    this.socket.on("disconnect", () => (this.disconnected = true));
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

  private emitAck<C extends AdminCommand | AdventureCommand>(event: "admin.command" | "adventure.action", payload: C): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, ack: (r: CommandResult) => void) => void }).emit(event, payload, resolve));
  }

  adminEnvelope(action: AdminAction, over: Partial<AdminCommand> = {}): AdminCommand {
    return { requestId: `a${++this.seq}-${Math.random().toString(36).slice(2, 8)}`, roomGeneration: this.generation, connectionEpoch: this.epoch, commandSeq: this.seq, action, ...over };
  }
  adventureEnvelope(action: AdventureAction, over: Partial<AdventureCommand> = {}): AdventureCommand {
    return { requestId: `v${++this.seq}-${Math.random().toString(36).slice(2, 8)}`, roomGeneration: this.generation, turnVersion: this.turnVersion, connectionEpoch: this.epoch, action, ...over };
  }

  admin(action: AdminAction, over: Partial<AdminCommand> = {}): Promise<CommandResult> {
    return this.emitAck("admin.command", this.adminEnvelope(action, over));
  }
  adventure(action: AdventureAction, over: Partial<AdventureCommand> = {}): Promise<CommandResult> {
    return this.emitAck("adventure.action", this.adventureEnvelope(action, over));
  }
  rawAdmin(payload: unknown): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, a: (r: CommandResult) => void) => void }).emit("admin.command", payload, resolve));
  }
  rawAdventure(payload: unknown): Promise<CommandResult> {
    return new Promise((resolve) => (this.socket as unknown as { emit: (e: string, p: unknown, a: (r: CommandResult) => void) => void }).emit("adventure.action", payload, resolve));
  }

  sync() {
    return new Promise<unknown>((resolve) => this.socket.emit("room.sync", resolve));
  }

  close(): void {
    this.socket.disconnect();
  }
}

/** Crea una sala con administradora y `names.length` participantes, todos conectados con credenciales distintas. */
export async function setupRoom(server: TestServer, names: string[] = ["Ana", "Beto"]) {
  const created = await createRoom(server.url);
  if (created.status !== 201) throw new Error(`No se pudo crear la sala: ${JSON.stringify(created.body)}`);
  const code = created.body.code;
  const admin = await new TestClient(server.url, created.body.adminToken).ready();
  const people: Array<{ client: TestClient; join: JoinRoomResponse }> = [];
  for (const [i, name] of names.entries()) {
    const j = await joinRoom(server.url, code, name, ["azul", "verde", "rojo", "rosa"][i % 4]);
    if (j.status !== 201) throw new Error(`No se pudo entrar: ${JSON.stringify(j.body)}`);
    const client = await new TestClient(server.url, j.body.token).ready();
    people.push({ client, join: j.body });
  }
  await admin.until(() => admin.presence?.connectedCount === names.length, "todos los participantes conectados en la presencia");
  return { code, admin, adminToken: created.body.adminToken, created: created.body, people, clients: [admin, ...people.map((p) => p.client)] };
}
