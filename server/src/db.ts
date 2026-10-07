import { copyFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import type { CommandResult } from "../../shared/contracts/actions";
import type { Role } from "../../shared/contracts/events";
import type { RoomPhase, RoomState } from "../../shared/contracts/state";

/**
 * Persistencia de salas (SPECS 6.1): un repositorio pequeño sobre SQLite, con transacciones y estado JSON validado. Sin event
 * sourcing. Las tablas son `rooms`, `principals` y `processed_commands`; los sockets nunca se guardan.
 * Todas las operaciones son síncronas (better-sqlite3): lo que vuelve sin lanzar ya es durable.
 */

export interface PrincipalRecord {
  principalId: string;
  roomId: string;
  role: Role;
  name: string;
  /** Clave de comparación del nombre, para asignar la distinción de duplicados. */
  nameKey: string;
  color: string | null;
  distinction: number;
  /** Acompaña sin jugar: no tiene personaje ni cuenta en la ronda. */
  observer: boolean;
  /** Hash de la credencial; nunca el token. */
  tokenHash: string;
  createdAt: string;
}

export interface StoredCommand {
  roomId: string;
  principalId: string;
  generation: number;
  requestId: string;
  fingerprint: string;
  response: CommandResult;
}

export interface StoredRoom {
  state: RoomState;
  lastAdminActivityAt: string;
  terminalAt: string | null;
}

const PHASES: readonly RoomPhase[] = ["welcome", "running", "paused", "finished", "closed", "expired"];

/** Comprobación estructural de lo que se lee del disco: no es un esquema completo, pero impide cargar basura (o salas del modelo anterior) como estado. */
export function isPlausibleRoomState(x: unknown): x is RoomState {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  const adv = r.adventure as Record<string, unknown> | undefined;
  const round = adv?.round as Record<string, unknown> | undefined;
  return (
    typeof r.roomId === "string" &&
    typeof r.code === "string" &&
    typeof r.contentSetId === "string" &&
    typeof r.configHash === "string" &&
    typeof r.mapHash === "string" &&
    Number.isInteger(r.roomGeneration) &&
    Number.isInteger(r.stateVersion) &&
    Number.isInteger(r.roundVersion) &&
    typeof r.phase === "string" &&
    PHASES.includes(r.phase as RoomPhase) &&
    typeof r.participants === "object" &&
    r.participants !== null &&
    typeof adv === "object" &&
    adv !== null &&
    typeof adv.mapId === "string" &&
    Array.isArray(adv.notebook) &&
    typeof round === "object" &&
    round !== null &&
    typeof round.stage === "string"
  );
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  state_json TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  round_version INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  phase TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_admin_activity_at TEXT NOT NULL,
  terminal_at TEXT
);
CREATE TABLE IF NOT EXISTS principals (
  principal_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'participant')),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  color TEXT,
  distinction INTEGER NOT NULL,
  observer INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS principals_room ON principals(room_id);
CREATE TABLE IF NOT EXISTS processed_commands (
  room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, principal_id, generation, request_id)
);
`;

/** 2: participación simultánea (rondas). `turn_version` pasó a `round_version` y las identidades pueden ser observadoras. */
export const SCHEMA_VERSION = 2;

export class SqliteRoomRepository {
  /** Solo para pruebas (simular fallos reales de SQLite); el código de aplicación no lo usa. */
  readonly raw: Database.Database;

  constructor(path: string) {
    this.raw = new Database(path);
    this.raw.pragma("journal_mode = WAL");
    // FULL: un commit confirmado sobrevive también a un corte de energía, no solo a la caída del proceso (SPECS 11.2).
    this.raw.pragma("synchronous = FULL");
    this.raw.pragma("foreign_keys = ON");
    const version = this.raw.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION) throw new Error(`La base de datos es de una versión más nueva (${version}) que la que entiende este servidor (${SCHEMA_VERSION})`);
    if (version === 1) this.migrateFromTurns(path);
    this.raw.exec(SCHEMA);
    this.raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  /**
   * Migra la base del modelo de turnos (versión 1) al de rondas (versión 2). Antes de tocar nada se copia el archivo junto al original
   * (`.v1.bak`): las salas del modelo anterior no se pueden jugar con el nuevo (su estado tiene otra forma), así que quedan en disco sin
   * cargarse; la copia permite recuperarlas con la versión anterior.
   */
  private migrateFromTurns(path: string): void {
    if (path !== ":memory:" && existsSync(path) && !existsSync(`${path}.v1.bak`)) {
      this.raw.pragma("wal_checkpoint(TRUNCATE)");
      copyFileSync(path, `${path}.v1.bak`);
    }
    this.raw.transaction(() => {
      this.raw.exec("ALTER TABLE rooms RENAME COLUMN turn_version TO round_version");
      this.raw.exec("ALTER TABLE principals ADD COLUMN observer INTEGER NOT NULL DEFAULT 0");
    })();
  }

  close(): void {
    this.raw.close();
  }

  // ---- salas ----

  codeExists(code: string): boolean {
    return this.raw.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code) !== undefined;
  }

  createRoom(state: RoomState, admin: PrincipalRecord, nowIso: string): void {
    this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO rooms (room_id, code, state_json, state_version, round_version, generation, phase, created_at, updated_at, last_admin_activity_at, terminal_at)
           VALUES (@roomId, @code, @json, @sv, @rv, @gen, @phase, @now, @now, @now, NULL)`,
        )
        .run({ roomId: state.roomId, code: state.code, json: JSON.stringify(state), sv: state.stateVersion, rv: state.roundVersion, gen: state.roomGeneration, phase: state.phase, now: nowIso });
      this.insertPrincipal(admin);
    })();
  }

  /**
   * Guarda el estado y, si lo hay, la respuesta del comando en UNA transacción (SPECS 5.4, paso 6). Si lanza, no se escribió nada:
   * quien llama no debe anunciar éxito ni actualizar su copia en memoria.
   */
  commit(state: RoomState, nowIso: string, command?: StoredCommand): void {
    this.raw.transaction(() => {
      const terminal = state.phase === "closed" || state.phase === "expired";
      const info = this.raw
        .prepare(
          `UPDATE rooms SET state_json = @json, state_version = @sv, round_version = @rv, generation = @gen, phase = @phase, updated_at = @now,
             terminal_at = CASE WHEN @terminal = 1 THEN COALESCE(terminal_at, @now) ELSE NULL END
           WHERE room_id = @roomId`,
        )
        .run({ json: JSON.stringify(state), sv: state.stateVersion, rv: state.roundVersion, gen: state.roomGeneration, phase: state.phase, now: nowIso, terminal: terminal ? 1 : 0, roomId: state.roomId });
      if (info.changes !== 1) throw new Error(`La sala ${state.roomId} no existe`);
      if (command) {
        this.raw
          .prepare("INSERT INTO processed_commands (room_id, principal_id, generation, request_id, fingerprint, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(command.roomId, command.principalId, command.generation, command.requestId, command.fingerprint, JSON.stringify(command.response), nowIso);
      }
    })();
  }

  loadRooms(): { rooms: StoredRoom[]; unreadable: Array<{ roomId: string; reason: string }> } {
    const rows = this.raw.prepare("SELECT room_id, state_json, last_admin_activity_at, terminal_at FROM rooms").all() as Array<{ room_id: string; state_json: string; last_admin_activity_at: string; terminal_at: string | null }>;
    const rooms: StoredRoom[] = [];
    const unreadable: Array<{ roomId: string; reason: string }> = [];
    for (const row of rows) {
      try {
        const state = JSON.parse(row.state_json) as unknown;
        if (!isPlausibleRoomState(state)) {
          unreadable.push({ roomId: row.room_id, reason: "el estado guardado no tiene la forma esperada" });
          continue;
        }
        rooms.push({ state, lastAdminActivityAt: row.last_admin_activity_at, terminalAt: row.terminal_at });
      } catch (e) {
        unreadable.push({ roomId: row.room_id, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { rooms, unreadable };
  }

  touchAdminActivity(roomId: string, nowIso: string): void {
    this.raw.prepare("UPDATE rooms SET last_admin_activity_at = ? WHERE room_id = ?").run(nowIso, roomId);
  }

  deleteRoom(roomId: string): void {
    this.raw.prepare("DELETE FROM rooms WHERE room_id = ?").run(roomId);
  }

  // ---- identidades ----

  private insertPrincipal(p: PrincipalRecord): void {
    this.raw
      .prepare("INSERT INTO principals (principal_id, room_id, role, name, name_key, color, distinction, observer, token_hash, created_at) VALUES (@principalId, @roomId, @role, @name, @nameKey, @color, @distinction, @observer, @tokenHash, @createdAt)")
      .run({ ...p, observer: p.observer ? 1 : 0 });
  }

  /** Añade un participante asignando su distinción dentro de la misma transacción (sin carreras entre dos entradas simultáneas). */
  addParticipant(p: Omit<PrincipalRecord, "distinction">): PrincipalRecord {
    return this.raw.transaction(() => {
      const row = this.raw.prepare("SELECT COALESCE(MAX(distinction), 0) AS d FROM principals WHERE room_id = ? AND name_key = ? AND role = 'participant'").get(p.roomId, p.nameKey) as { d: number };
      const record = { ...p, distinction: row.d + 1 };
      this.insertPrincipal(record);
      return record;
    })();
  }

  countParticipants(roomId: string): number {
    return (this.raw.prepare("SELECT COUNT(*) AS n FROM principals WHERE room_id = ? AND role = 'participant'").get(roomId) as { n: number }).n;
  }

  listPrincipals(roomId: string): PrincipalRecord[] {
    return (this.raw.prepare("SELECT principal_id, room_id, role, name, name_key, color, distinction, observer, token_hash, created_at FROM principals WHERE room_id = ? ORDER BY created_at, rowid").all(roomId) as Array<Record<string, unknown>>).map(toPrincipal);
  }

  findPrincipalByTokenHash(tokenHash: string): PrincipalRecord | undefined {
    const row = this.raw.prepare("SELECT principal_id, room_id, role, name, name_key, color, distinction, observer, token_hash, created_at FROM principals WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | undefined;
    return row ? toPrincipal(row) : undefined;
  }

  // ---- comandos procesados ----

  findCommand(roomId: string, principalId: string, generation: number, requestId: string): { fingerprint: string; response: CommandResult } | undefined {
    const row = this.raw.prepare("SELECT fingerprint, response_json FROM processed_commands WHERE room_id = ? AND principal_id = ? AND generation = ? AND request_id = ?").get(roomId, principalId, generation, requestId) as { fingerprint: string; response_json: string } | undefined;
    return row ? { fingerprint: row.fingerprint, response: JSON.parse(row.response_json) as CommandResult } : undefined;
  }
}

const toPrincipal = (r: Record<string, unknown>): PrincipalRecord => ({
  principalId: r.principal_id as string,
  roomId: r.room_id as string,
  role: r.role as Role,
  name: r.name as string,
  nameKey: r.name_key as string,
  color: (r.color as string | null) ?? null,
  distinction: r.distinction as number,
  observer: r.observer === 1,
  tokenHash: r.token_hash as string,
  createdAt: r.created_at as string,
});

export type RoomRepository = SqliteRoomRepository;
