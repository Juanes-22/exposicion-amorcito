/** Preferencia LOCAL de sonido (SPECS 10.4): no forma parte del progreso compartido ni viaja al servidor. */
const KEY = "laboratorio-cosas-cotidianas:v1:sonido";

export interface SoundPreference {
  /** El sonido está activado (por defecto, sí; queda apagado solo si la persona lo silenció). Solo un gesto puede hacerlo sonar. */
  on: boolean;
  volume: number;
}

const DEFAULT: SoundPreference = { on: true, volume: 0.8 };

export function loadSoundPreference(): SoundPreference {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const v = JSON.parse(raw) as Partial<SoundPreference>;
    return { on: v.on !== false, volume: typeof v.volume === "number" && v.volume >= 0 && v.volume <= 1 ? v.volume : DEFAULT.volume };
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
