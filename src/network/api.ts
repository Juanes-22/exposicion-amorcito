import type { ApiError, CreateRoomResponse, JoinRoomResponse, RoomPublicInfo } from "../../shared/contracts/events";

/** Error de la API HTTP con su código estable y un mensaje apto para mostrar. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

const base = () => import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiFailure(0, "NETWORK", "No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiFailure(res.status, err?.code ?? "INTERNAL", err?.message ?? "Ocurrió un error inesperado.");
  }
  return body as T;
}

export const createRoom = (contentSetId: string) => request<CreateRoomResponse>("/api/rooms", { method: "POST", body: JSON.stringify({ contentSetId }) });
export const joinRoom = (code: string, name: string, color: string, observer = false) => request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, { method: "POST", body: JSON.stringify({ name, color, ...(observer ? { observer: true } : {}) }) });
export const getRoomInfo = (code: string) => request<RoomPublicInfo>(`/api/rooms/${encodeURIComponent(code)}`);
