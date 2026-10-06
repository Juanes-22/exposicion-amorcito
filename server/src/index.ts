import { createServerApp } from "./app";
import { loadSettings } from "./config";
import type { Logger } from "./roomService";

// Registro mínimo en consola. Nunca se registran credenciales ni textos del público (SPECS 5.1, 11.2).
const logger: Logger = {
  info: (m, d) => console.log(`[info] ${m}`, d ?? ""),
  warn: (m, d) => console.warn(`[warn] ${m}`, d ?? ""),
  error: (m, d) => console.error(`[error] ${m}`, d ?? ""),
};

const settings = loadSettings();
const app = createServerApp({ settings, logger });
const port = await app.listen();
logger.info(`Servidor escuchando en http://localhost:${port}`, { database: settings.databasePath, publicDir: settings.publicDir, serveFrontend: settings.distDir });

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  logger.info(`${signal}: cerrando`);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => logger.error("promesa rechazada sin controlar", { error: String(e) }));
