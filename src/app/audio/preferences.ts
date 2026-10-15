/**
 * Preferencia LOCAL de sonido (SPECS 10.4): no forma parte del progreso compartido ni viaja al servidor. La clave es la v2 desde que el
 * celular empieza al volumen máximo (15 de octubre de 2026): lo guardado con la v1 (volumen 0,8 o silenciado en los ensayos) se ignora.
 */
const KEY = "laboratorio-cosas-cotidianas:v2:sonido";

export interface SoundPreference {
  /** El sonido está activado (por defecto, sí; queda apagado solo si la persona lo silenció). Solo un gesto puede hacerlo sonar. */
  on: boolean;
  volume: number;
}

/** Por defecto el sonido está activado; en el celular de quien juega, al volumen máximo. */
const defaultFor = (device: "computer" | "phone"): SoundPreference => ({ on: true, volume: device === "phone" ? 1 : 0.8 });

export function loadSoundPreference(device: "computer" | "phone" = "computer"): SoundPreference {
  const fallback = defaultFor(device);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<SoundPreference>;
    return { on: v.on !== false, volume: typeof v.volume === "number" && v.volume >= 0 && v.volume <= 1 ? v.volume : fallback.volume };
  } catch {
    return fallback;
  }
}

export function saveSoundPreference(p: SoundPreference): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento la preferencia no se recuerda: el sonido sigue funcionando */
  }
}
