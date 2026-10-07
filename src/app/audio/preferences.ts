/** Preferencia LOCAL de sonido (SPECS 10.4): no forma parte del progreso compartido ni viaja al servidor. */
const KEY = "laboratorio-cosas-cotidianas:v1:sonido";

export interface SoundPreference {
  /** La persona lo había activado la última vez. Solo un gesto puede volver a hacerlo sonar. */
  on: boolean;
  volume: number;
}

const DEFAULT: SoundPreference = { on: false, volume: 0.8 };

export function loadSoundPreference(): SoundPreference {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<SoundPreference>;
    return { on: v.on === true, volume: typeof v.volume === "number" && v.volume >= 0 && v.volume <= 1 ? v.volume : DEFAULT.volume };
  } catch {
    return DEFAULT;
  }
}

export function saveSoundPreference(p: SoundPreference): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento la preferencia no se recuerda: el sonido sigue funcionando */
  }
}
