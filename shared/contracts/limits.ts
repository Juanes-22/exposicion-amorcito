/** Límites y constantes que cliente y servidor comparten. El servidor vuelve a comprobarlos siempre (SPECS 5.1, 9.5). */

export const NAME_MAX_CHARS = 20;
export const NAME_MIN_CHARS = 1;
/** Tope de unidades UTF-16 de un texto antes de contar caracteres: impide cargas enormes con pocos grafemas. */
export const TEXT_MAX_UTF16_FACTOR = 8;
export const RECORD_MAX_CHARS_DEFAULT = 280;

export const ROOM_CODE_LENGTH = 6;
/** Sin 0/O/1/I/L: el código se dicta y se teclea desde una proyección. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Paleta de colores de participantes. El color no es el identificador (SPECS 2.1). */
export const PARTICIPANT_COLORS = [
  { id: "rojo", label: "Rojo", hex: "#d9534f" },
  { id: "naranja", label: "Naranja", hex: "#e8923a" },
  { id: "amarillo", label: "Amarillo", hex: "#e3b92c" },
  { id: "verde", label: "Verde", hex: "#4e9a51" },
  { id: "turquesa", label: "Turquesa", hex: "#2f9c95" },
  { id: "azul", label: "Azul", hex: "#3b7dd8" },
  { id: "morado", label: "Morado", hex: "#8a63c4" },
  { id: "rosa", label: "Rosa", hex: "#d6609b" },
] as const;
export type ParticipantColorId = (typeof PARTICIPANT_COLORS)[number]["id"];
export const PARTICIPANT_COLOR_IDS: readonly string[] = PARTICIPANT_COLORS.map((c) => c.id);

export const MAX_REQUEST_ID_LENGTH = 64;
export const MIN_TOKEN_BYTES = 32;

/** Códigos de error de comando estables (SPECS 5.3). */
export const COMMAND_ERROR_CODES = [
  "NOT_AUTHORIZED",
  "STALE_CONNECTION",
  "STALE_TURN",
  "STALE_ROUND",
  "STALE_GENERATION",
  "ROOM_PAUSED",
  "INVALID_STEP",
  "INVALID_PAYLOAD",
  "ROOM_UNAVAILABLE",
  "REVISION_CONFLICT",
  "CONFIG_MISMATCH",
  "RATE_LIMITED",
  "PERSISTENCE_FAILED",
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/** Códigos de error de la API HTTP (alta de sala e identidad). */
export const HTTP_ERROR_CODES = ["INVALID_PAYLOAD", "ROOM_NOT_FOUND", "ROOM_FULL", "ROOM_UNAVAILABLE", "CONTENT_NOT_ALLOWED", "RATE_LIMITED", "INTERNAL"] as const;
export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[number];
