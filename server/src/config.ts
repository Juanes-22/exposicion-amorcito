import { resolve } from "node:path";

/** Ajustes del servidor. Todo lo operativo vive en el entorno, nunca en el JSON público (SPECS 9.1). */
export interface ServerSettings {
  port: number;
  /** Interfaz de red. `0.0.0.0` permite entrar desde celulares de la red local; las pruebas fijan `127.0.0.1`. */
  host: string;
  /** Archivo SQLite. En producción: un volumen que sobreviva a los reinicios. `:memory:` solo en pruebas. */
  databasePath: string;
  /** Orígenes autorizados además del propio servidor (CORS de la API y de Socket.IO). */
  allowedOrigins: string[];
  /** Origen público con el que se construyen los enlaces de entrada; si falta se deduce de la petición. */
  publicOrigin: string | null;
  /** Carpeta `public/` con configuración, mapa y catálogo. */
  publicDir: string;
  /** Frontend compilado; si no existe no se sirve (en desarrollo lo sirve Vite). */
  distDir: string;
  /** Vencimiento por inactividad de la administradora (ms). Prevalece el valor del servidor sobre el del JSON. */
  adminIdleTtlMs: number | null;
  /** Retención de datos de una sala terminal antes de limpiarla (ms). */
  terminalRetentionMs: number;
  /** Cada cuánto se revisan vencimientos y limpieza (ms). */
  sweepIntervalMs: number;
  /** Cada cuánto corre el bucle de simulación y se emiten frames (10 Hz). `0` lo desactiva (pruebas). */
  tickIntervalMs: number;
  /** Cada cuánto se guarda un checkpoint de reloj y posición mientras algo se mueve. */
  checkpointIntervalMs: number;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  maxMessageBytes: number;
  trustProxy: boolean;
  rateLimits: {
    createRoomPerMinute: number;
    joinPerMinute: number;
    /** Comandos de aventura: ráfaga y reposición por segundo (el arrastre del slider llega a ~12 Hz). */
    adventureBurst: number;
    adventurePerSecond: number;
    adminBurst: number;
    adminPerSecond: number;
  };
}

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Valor numérico inválido en el entorno: «${v}»`);
  return n;
};

export function loadSettings(env: NodeJS.ProcessEnv = process.env, overrides: Partial<ServerSettings> = {}): ServerSettings {
  const origins = [env.ALLOWED_ORIGIN, env.PUBLIC_ORIGIN].filter((o): o is string => !!o).map((o) => o.replace(/\/$/, ""));
  return {
    port: num(env.PORT, 3001),
    host: env.HOST || "0.0.0.0",
    databasePath: resolve(env.DATABASE_PATH ?? "server/data/laboratorio.sqlite"),
    allowedOrigins: [...new Set(origins)],
    publicOrigin: env.PUBLIC_ORIGIN ? env.PUBLIC_ORIGIN.replace(/\/$/, "") : null,
    publicDir: resolve(env.PUBLIC_DIR ?? "public"),
    distDir: resolve(env.DIST_DIR ?? "dist"),
    adminIdleTtlMs: env.ADMIN_IDLE_TTL_MS ? num(env.ADMIN_IDLE_TTL_MS, 0) : null,
    terminalRetentionMs: num(env.TERMINAL_RETENTION_MS, 24 * 3600 * 1000),
    sweepIntervalMs: num(env.SWEEP_INTERVAL_MS, 30_000),
    tickIntervalMs: num(env.TICK_INTERVAL_MS, 100),
    checkpointIntervalMs: num(env.CHECKPOINT_INTERVAL_MS, 500),
    // Valores de arranque del SPECS 6.2 para detectar cortes en ≤ 10 s; medir falsos cortes en celulares reales (P6-02).
    pingIntervalMs: num(env.PING_INTERVAL_MS, 4000),
    pingTimeoutMs: num(env.PING_TIMEOUT_MS, 5000),
    maxMessageBytes: num(env.MAX_MESSAGE_BYTES, 64 * 1024),
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
    rateLimits: { createRoomPerMinute: 10, joinPerMinute: 60, adventureBurst: 40, adventurePerSecond: 25, adminBurst: 20, adminPerSecond: 8 },
    ...overrides,
  };
}
