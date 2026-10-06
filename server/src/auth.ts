import { createHash, randomBytes, randomInt } from "node:crypto";
import { MIN_TOKEN_BYTES, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../../shared/contracts/limits";

/** Credencial opaca aleatoria de al menos 32 bytes (SPECS 5.1). Se entrega una sola vez; el servidor guarda solo su hash. */
export const newToken = (): string => randomBytes(Math.max(MIN_TOKEN_BYTES, 32)).toString("base64url");

/** Un token de 256 bits aleatorios no necesita un KDF lento: SHA-256 basta para guardarlo y buscarlo. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export const newId = (): string => randomBytes(12).toString("base64url");

export function newRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** Forma plausible de un token enviado por un cliente: evita consultar la base con basura o con cargas enormes. */
export const looksLikeToken = (value: unknown): value is string => typeof value === "string" && value.length >= 40 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
