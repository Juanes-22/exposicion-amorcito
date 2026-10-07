import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from "express";
import { parseCreateRoomRequest, parseJoinRoomRequest } from "../../shared/contracts/schemas";
import type { ApiError } from "../../shared/contracts/events";
import type { HttpErrorCode } from "../../shared/contracts/limits";
import type { ServerSettings } from "./config";
import { ServiceError, type Logger, type RoomService } from "./roomService";

export interface HttpDeps {
  service: RoomService;
  settings: ServerSettings;
  logger: Logger;
}

const apiError = (res: Response, status: number, code: HttpErrorCode, message: string) => void res.status(status).json({ error: { code, message } } satisfies ApiError);

/** ¿El `Origin` de una petición es el propio servidor o uno de los orígenes autorizados? */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true; // peticiones sin Origin (no navegadores): la credencial sigue siendo obligatoria
  if (allowed.includes(origin.replace(/\/$/, ""))) return true;
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Origen público para armar el enlace de entrada. Si no está configurado se deduce del `Host`, validado para que no inyecte nada. */
function publicOrigin(req: Request, settings: ServerSettings): string {
  if (settings.publicOrigin) return settings.publicOrigin;
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${/^[A-Za-z0-9.\-:[\]]{1,255}$/.test(host) ? host : "localhost"}`;
}

export function createHttpApp({ service, settings, logger }: HttpDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", settings.trustProxy);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // El enlace de entrada solo lleva el código, pero no hay motivo para filtrar la URL a terceros.
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  // CORS: solo el propio origen y los autorizados por el entorno.
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin && !isAllowedOrigin(origin, req.get("host"), settings.allowedOrigins)) return apiError(res, 403, "CONTENT_NOT_ALLOWED", "Origen no autorizado.");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "8kb" }));

  app.get("/api/health", (_req, res) => void res.json({ status: "ok" }));

  app.post("/api/rooms", (req, res) => {
    if (!service.allowCreate(req.ip ?? "?")) return apiError(res, 429, "RATE_LIMITED", "Demasiadas salas creadas. Espera un momento.");
    const body = parseCreateRoomRequest(req.body);
    if (!body.ok) return apiError(res, 400, "INVALID_PAYLOAD", "La solicitud no es válida.");
    res.status(201).json(service.createRoom(body.value.contentSetId, publicOrigin(req, settings)));
  });

  app.get("/api/rooms/:code", (req, res) => {
    const info = /^[A-Za-z0-9]{3,12}$/.test(req.params.code) ? service.describeRoom(req.params.code) : undefined;
    if (!info) return apiError(res, 404, "ROOM_NOT_FOUND", "No encontramos esa sala. Revisa el código.");
    res.json(info);
  });

  app.post("/api/rooms/:code/join", (req, res) => {
    if (!service.allowJoin(req.ip ?? "?")) return apiError(res, 429, "RATE_LIMITED", "Demasiados intentos. Espera un momento.");
    if (!/^[A-Za-z0-9]{3,12}$/.test(req.params.code)) return apiError(res, 404, "ROOM_NOT_FOUND", "No encontramos esa sala. Revisa el código.");
    const body = parseJoinRoomRequest(req.body);
    if (!body.ok) return apiError(res, 400, "INVALID_PAYLOAD", "Escribe tu nombre y elige un color.");
    res.status(201).json(service.joinRoom(req.params.code, body.value));
  });

  app.use("/api", (_req, res) => apiError(res, 404, "ROOM_NOT_FOUND", "No existe."));

  // Frontend compilado (producción): hashed bundles inmutables; configuración, mapa y catálogo siempre revalidados.
  const index = join(settings.distDir, "index.html");
  if (existsSync(index)) {
    app.use(
      express.static(settings.distDir, {
        index: false,
        setHeaders(res, path) {
          if (path.includes(`${sep}bundle${sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          // Imágenes y sonidos del catálogo: no cambian durante una sesión. Una hora de caché permite que la demostración, abierta
          // desde una página ya cargada, vuelva a pintar la escena aunque el servidor haya dejado de responder (SPECS 6.4).
          else if (/\.(png|jpe?g|webp|gif|svg|woff2?|mp3|ogg|wav)$/i.test(path)) res.setHeader("Cache-Control", "public, max-age=3600");
          else res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    // Las rutas del frontend (`/`, `/sala/:code`, `/demo`) devuelven la aplicación (SPECS 2.1).
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/socket.io")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(index);
    });
  }

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof ServiceError) return apiError(res, err.status, err.code, err.message);
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large") return apiError(res, 413, "INVALID_PAYLOAD", "La solicitud es demasiado grande.");
    if (e?.type === "entity.parse.failed") return apiError(res, 400, "INVALID_PAYLOAD", "La solicitud no es válida.");
    // Nunca se devuelven trazas ni detalles internos al navegador.
    logger.error("error no controlado en la API", { error: err instanceof Error ? err.message : String(err) });
    apiError(res, 500, "INTERNAL", "Ocurrió un error inesperado.");
  };
  app.use(onError);
  return app;
}
