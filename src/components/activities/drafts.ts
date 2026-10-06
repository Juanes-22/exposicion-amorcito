/**
 * Borradores de texto (SPECS 3.1): permanecen en el dispositivo, no se proyectan letra por letra, no se transfieren al nuevo jugador y
 * no forman parte del progreso compartido. Cambiar de turno los separa del registro confirmado. Clave propia por proyecto, sala, mesa y campo.
 * Si el almacenamiento falla (ventana privada) siguen en memoria mientras no se recargue la página.
 */
const PREFIX = "laboratorio-cosas-cotidianas:v1:borrador:";
const memory = new Map<string, string>();

export interface DraftKey {
  room: string;
  activityId: string;
  field: string;
}

const keyOf = (k: DraftKey) => `${PREFIX}${k.room.toUpperCase()}:${k.activityId}:${k.field}`;

export const drafts = {
  get(k: DraftKey): string {
    const key = keyOf(k);
    if (memory.has(key)) return memory.get(key)!;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) {
        memory.set(key, stored);
        return stored;
      }
    } catch {
      /* almacenamiento no disponible */
    }
    return "";
  },

  set(k: DraftKey, text: string): void {
    const key = keyOf(k);
    memory.set(key, text);
    try {
      if (text === "") window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, text);
    } catch {
      /* se conserva solo en memoria */
    }
  },

  clear(k: DraftKey): void {
    this.set(k, "");
  },

  /** Olvida todos los borradores de una sala (p. ej. cuando termina o se sale de ella). */
  forgetRoom(room: string): void {
    const prefix = `${PREFIX}${room.toUpperCase()}:`;
    for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
      }
    } catch {
      /* nada que limpiar */
    }
  },

  /** ¿Hay en esta sala un texto escrito que NO se compartió con el grupo? Sirve para avisar al perder el turno. */
  hasUnshared(room: string): boolean {
    const prefix = `${PREFIX}${room.toUpperCase()}:`;
    for (const [key, text] of memory) if (key.startsWith(prefix) && text.trim() !== "") return true;
    try {
      // También los que sobrevivieron a una recarga y todavía no se abrieron en esta página.
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(prefix) && (window.localStorage.getItem(key) ?? "").trim() !== "") return true;
      }
    } catch {
      /* almacenamiento no disponible: solo cuenta lo que hay en memoria */
    }
    return false;
  },
};
