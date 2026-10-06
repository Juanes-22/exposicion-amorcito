import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { parseAdminCommand, parseAdventureCommand } from "../../shared/contracts/schemas";
import type { CommandResult } from "../../shared/contracts/actions";
import type { ClientToServerEvents, ServerToClientEvents } from "../../shared/contracts/events";
import type { CommandErrorCode } from "../../shared/contracts/limits";
import { looksLikeToken } from "./auth";
import type { ServerSettings } from "./config";
import { isAllowedOrigin } from "./http";
import type { AuthIdentity, Logger, Outbox, RoomService } from "./roomService";

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { identity: AuthIdentity }>;

/** Tiempo para que el último mensaje (p. ej. «la aventura terminó») llegue antes de cerrar la conexión. */
const CLOSE_GRACE_MS = 250;

/**
 * Transporte Socket.IO (SPECS 5.3, 5.5). Guarda la conexión vigente de cada identidad y expone el `Outbox` que usa el servicio.
 * Se crea antes que el servicio (que necesita el `Outbox`) y se engancha al servidor HTTP después.
 */
export class SocketHub {
  private connections = new Map<string, AppSocket>();
  private io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { identity: AuthIdentity }> | null = null;

  readonly outbox: Outbox = {
    send: (principalId, event, ...args) => {
      (this.connections.get(principalId) as { emit: (e: string, ...a: unknown[]) => void } | undefined)?.emit(event, ...args);
    },
    sendToView: (roomId, event, ...args) => {
      (this.io?.to(viewChannel(roomId)) as unknown as { emit: (e: string, ...a: unknown[]) => void } | undefined)?.emit(event, ...args);
    },
    joinView: (principalId, roomId) => void this.connections.get(principalId)?.join(viewChannel(roomId)),
    leaveView: (principalId, roomId) => void this.connections.get(principalId)?.leave(viewChannel(roomId)),
    close: (principalId) => {
      const socket = this.connections.get(principalId);
      if (socket) setTimeout(() => socket.disconnect(true), CLOSE_GRACE_MS).unref();
    },
  };

  attach(httpServer: HttpServer, service: RoomService, settings: ServerSettings, logger: Logger): void {
    const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { identity: AuthIdentity }>(httpServer, {
      serveClient: false,
      // Latido ajustado para detectar cortes en ≤ 10 s (SPECS 6.2); los valores por defecto de Socket.IO no cumplen ese objetivo.
      pingInterval: settings.pingIntervalMs,
      pingTimeout: settings.pingTimeoutMs,
      maxHttpBufferSize: settings.maxMessageBytes,
      cors: { origin: settings.allowedOrigins.length > 0 ? settings.allowedOrigins : false, methods: ["GET", "POST"] },
      // Los WebSocket no pasan por CORS: se comprueba el origen aquí.
      allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin, req.headers.host, settings.allowedOrigins)),
    });
    this.io = io;

    // La credencial viaja en `auth`, nunca en la query string (SPECS 5.1). El papel lo resuelve el servidor.
    io.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      const identity = looksLikeToken(token) ? service.authenticate(token) : null;
      if (!identity) return next(new Error("UNAUTHORIZED"));
      socket.data.identity = identity;
      next();
    });

    io.on("connection", (socket) => {
      const identity = socket.data.identity;
      const previous = this.connections.get(identity.principalId);
      this.connections.set(identity.principalId, socket);

      // Los manejadores se registran antes de cualquier espera: la cola de la sala los ordena después del `attach`.
      socket.on("admin.command", (raw, ack) => {
        if (typeof ack !== "function") return;
        const parsed = parseAdminCommand(raw);
        if (!parsed.ok) return ack(invalid(raw));
        guard(() => service.adminCommand(identity, socket.id, parsed.value), parsed.value.requestId, ack, logger);
      });
      socket.on("adventure.action", (raw, ack) => {
        if (typeof ack !== "function") return;
        const parsed = parseAdventureCommand(raw);
        if (!parsed.ok) return ack(invalid(raw));
        guard(() => service.adventureCommand(identity, socket.id, parsed.value), parsed.value.requestId, ack, logger);
      });
      socket.on("room.sync", (ack) => {
        if (typeof ack !== "function") return;
        service.sync(identity, socket.id).then(ack, (e) => {
          logger.error("falló room.sync", { error: String(e) });
          ack({ ok: false, code: "ROOM_UNAVAILABLE", message: "No se pudo sincronizar." });
        });
      });
      socket.on("admin.activity", () => void service.adminActivity(identity, socket.id).catch((e) => logger.warn("falló admin.activity", { error: String(e) })));
      socket.on("disconnect", () => {
        if (this.connections.get(identity.principalId) === socket) this.connections.delete(identity.principalId);
        void service.detach(identity, socket.id).catch((e) => logger.error("falló detach", { error: String(e) }));
      });

      service.attach(identity, socket.id).then(
        ({ replacedSocketId, terminal }) => {
          // La pestaña sustituida se deshabilita: solo la conexión vigente puede actuar (CA-28).
          if (previous && replacedSocketId === previous.id) {
            previous.emit("session.replaced");
            setTimeout(() => previous.disconnect(true), CLOSE_GRACE_MS).unref();
          }
          if (terminal) setTimeout(() => socket.disconnect(true), CLOSE_GRACE_MS).unref();
        },
        (e) => {
          logger.error("falló attach", { error: String(e) });
          socket.disconnect(true);
        },
      );
    });
  }

  async close(): Promise<void> {
    await this.io?.close();
  }
}

const viewChannel = (roomId: string) => `view:${roomId}`;

function invalid(raw: unknown): CommandResult {
  const requestId = typeof (raw as { requestId?: unknown })?.requestId === "string" ? ((raw as { requestId: string }).requestId.slice(0, 64)) : "";
  return { ok: false, requestId, code: "INVALID_PAYLOAD", message: "La acción no es válida." };
}

function guard(run: () => Promise<CommandResult>, requestId: string, ack: (r: CommandResult) => void, logger: Logger): void {
  run().then(ack, (e) => {
    // Un fallo inesperado nunca debe dejar un botón bloqueado ni mostrar detalles internos.
    logger.error("error inesperado procesando un comando", { error: e instanceof Error ? e.message : String(e) });
    ack({ ok: false, requestId, code: "ROOM_UNAVAILABLE" satisfies CommandErrorCode, message: "Ocurrió un error inesperado. Intenta de nuevo." });
  });
}
