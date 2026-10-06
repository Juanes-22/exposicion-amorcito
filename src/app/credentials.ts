import type { Role } from "../../shared/contracts/events";

/** Credencial de una sala en este navegador. Claves propias por proyecto y sala (SPECS 5.1). */
export interface StoredCredential {
  token: string;
  role: Role;
  principalId: string;
  displayName: string;
  color: string | null;
  savedAt: string;
}

const keyFor = (code: string) => `laboratorio-cosas-cotidianas:v1:sala:${code.toUpperCase()}`;
// Si el almacenamiento falla (ventana privada, datos bloqueados) la sesión sigue en memoria mientras no se recargue la página.
const memory = new Map<string, StoredCredential>();

const isCredential = (v: unknown): v is StoredCredential => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.token === "string" && (c.role === "admin" || c.role === "participant") && typeof c.principalId === "string" && typeof c.displayName === "string";
};

export function loadCredential(code: string): StoredCredential | null {
  try {
    const raw = window.localStorage.getItem(keyFor(code));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isCredential(parsed)) return parsed;
    }
  } catch {
    /* almacenamiento no disponible */
  }
  return memory.get(keyFor(code)) ?? null;
}

export function saveCredential(code: string, credential: StoredCredential): void {
  memory.set(keyFor(code), credential);
  try {
    window.localStorage.setItem(keyFor(code), JSON.stringify(credential));
  } catch {
    /* se conserva solo en memoria */
  }
}

export function clearCredential(code: string): void {
  memory.delete(keyFor(code));
  try {
    window.localStorage.removeItem(keyFor(code));
  } catch {
    /* nada que limpiar */
  }
}
