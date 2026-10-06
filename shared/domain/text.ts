import { NAME_MAX_CHARS, NAME_MIN_CHARS, TEXT_MAX_UTF16_FACTOR } from "../contracts/limits";

/** Normalización y límites de texto del público. Se ejecuta en servidor; el cliente la reutiliza para avisar antes de enviar. */

const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;

/** Cuenta caracteres percibidos (grafemas): un emoji con modificadores cuenta como uno. */
export function countChars(value: string): number {
  if (!segmenter) return Array.from(value).length;
  let n = 0;
  for (const _ of segmenter.segment(value)) n++;
  return n;
}

// Controles de dirección de texto: permiten falsificar cómo se ve un nombre en la proyección.
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/u;
const CONTROL_CHARS = /[\p{Cc}]/u;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/u;

export type TextResult = { ok: true; value: string; chars: number } | { ok: false; message: string };

/** Nombre de participante: NFC, espacios recortados y colapsados, 1–20 caracteres, sin controles. */
export function normalizeName(raw: unknown): TextResult {
  if (typeof raw !== "string") return { ok: false, message: "El nombre debe ser texto." };
  if (raw.length > NAME_MAX_CHARS * TEXT_MAX_UTF16_FACTOR) return { ok: false, message: "El nombre es demasiado largo." };
  const value = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (CONTROL_CHARS.test(value) || BIDI_CONTROLS.test(value)) return { ok: false, message: "El nombre tiene caracteres que no se pueden usar." };
  const chars = countChars(value);
  if (chars < NAME_MIN_CHARS) return { ok: false, message: "Escribe tu nombre." };
  if (chars > NAME_MAX_CHARS) return { ok: false, message: `El nombre puede tener hasta ${NAME_MAX_CHARS} caracteres.` };
  return { ok: true, value, chars };
}

/** Clave para decidir si dos nombres son «el mismo» al asignar la distinción (no distingue mayúsculas ni acentos de composición). */
export function nameKey(normalized: string): string {
  return normalized.toLocaleLowerCase("es");
}

/** Texto de un registro: NFC, recortado, saltos de línea unificados, hasta `max` caracteres, no vacío. */
export function normalizeRecordText(raw: unknown, max: number): TextResult {
  if (typeof raw !== "string") return { ok: false, message: "El texto debe ser texto." };
  if (raw.length > max * TEXT_MAX_UTF16_FACTOR) return { ok: false, message: `El texto puede tener hasta ${max} caracteres.` };
  const value = raw.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (CONTROL_EXCEPT_NEWLINE.test(value) || BIDI_CONTROLS.test(value)) return { ok: false, message: "El texto tiene caracteres que no se pueden usar." };
  const chars = countChars(value);
  if (chars === 0) return { ok: false, message: "Escribe algo antes de compartir." };
  if (chars > max) return { ok: false, message: `El texto puede tener hasta ${max} caracteres.` };
  return { ok: true, value, chars };
}

/** `Laura` la primera vez; `Laura · 2` desde la segunda (SPECS 2.1). */
export function displayNameFor(name: string, distinction: number): string {
  return distinction > 1 ? `${name} · ${distinction}` : name;
}
