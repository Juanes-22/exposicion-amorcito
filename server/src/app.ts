import { createServer, type Server as HttpServer } from "node:http";
import type { ProjectBundle } from "../../shared/config/validateProject";
import { createHttpApp } from "./http";
import { loadProjectFromDisk } from "./project";
import { loadSettings, type ServerSettings } from "./config";
import { SqliteRoomRepository, type RoomRepository } from "./db";
import { RoomService, silentLogger, type Logger } from "./roomService";
import { SocketHub } from "./socket";

export interface ServerOptions {
  settings?: ServerSettings;
  project?: ProjectBundle;
  repo?: RoomRepository;
  logger?: Logger;
  mono?: () => number;
  now?: () => Date;
}

export interface ServerApp {
  service: RoomService;
  settings: ServerSettings;
  repo: RoomRepository;
  project: ProjectBundle;
  httpServer: HttpServer;
  /** Arranca: recupera las salas durables y empieza a escuchar. Devuelve el puerto real. */
  listen(port?: number): Promise<number>;
  /** Cierra conexiones, el servidor HTTP y la base de datos. */
  close(): Promise<void>;
}

/** Ensambla HTTP + Socket.IO + servicio + SQLite. Las pruebas de integración arrancan esta misma función con una base temporal. */
export function createServerApp(options: ServerOptions = {}): ServerApp {
  const settings = options.settings ?? loadSettings();
  const logger = options.logger ?? silentLogger;
  const project = options.project ?? loadProjectFromDisk(settings.publicDir);
  const repo = options.repo ?? new SqliteRoomRepository(settings.databasePath);
  const hub = new SocketHub();
  const service = new RoomService({ repo, project, settings, outbox: hub.outbox, mono: options.mono, now: options.now, logger });
  const httpServer = createServer(createHttpApp({ service, settings, logger }));
  hub.attach(httpServer, service, settings, logger);

  return {
    service,
    settings,
    repo,
    project,
    httpServer,
    async listen(port = settings.port) {
      const recovered = service.start();
      logger.info("salas recuperadas", recovered);
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, settings.host, () => resolve());
      });
      const address = httpServer.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close() {
      service.stop();
      await hub.close();
      if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      repo.close();
    },
  };
}
