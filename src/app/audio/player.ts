/**
 * Reproductor de efectos (SPECS 10.4). Reglas:
 * · Empieza SIEMPRE en silencio: solo un gesto de la persona (`enable`) crea y reanuda el `AudioContext`, como exigen los navegadores.
 * · Un fallo de audio (sin soporte, contexto bloqueado, archivo que no baja o no decodifica) NUNCA bloquea la aventura: se queda en
 *   «no disponible» o se omite ese sonido, sin lanzar nada.
 * · Un único contexto y una única caché de buffers por página (`holder`): montar y desmontar vistas (StrictMode, cambio de turno) no
 *   duplica contextos ni sonidos (CT-04).
 */
export type AudioStatus = "off" | "on" | "unavailable";

export interface AudioHolder {
  ctx: AudioContext | null;
  gain: GainNode | null;
  buffers: Map<string, AudioBuffer>;
  /** Descargas ya iniciadas por URL, para no repetirlas aunque se llame a `enable` varias veces. */
  loading: Map<string, Promise<void>>;
}

export const createHolder = (): AudioHolder => ({ ctx: null, gain: null, buffers: new Map(), loading: new Map() });
const sharedHolder = createHolder();

export interface PlayerDeps {
  holder?: AudioHolder;
  createContext?: () => AudioContext;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  /** Para pruebas y ensayos: se avisa de cada sonido que realmente se lanzó. */
  onPlay?: (event: string) => void;
}

type Listener = () => void;

export interface AudioPlayer {
  getStatus(): AudioStatus;
  subscribe(listener: Listener): () => void;
  /** Debe llamarse dentro de un gesto (clic o toque). `urls` asigna cada evento a la URL de su archivo. */
  enable(urls: Record<string, string>): Promise<AudioStatus>;
  disable(): void;
  setVolume(volume: number): void;
  /** `true` solo si el sonido se lanzó de verdad. Nunca lanza. */
  play(event: string): boolean;
  /**
   * Pone el reproductor en uso. Debe llamarse en cada montaje: React StrictMode (solo en desarrollo) desmonta y vuelve a montar con la
   * MISMA instancia, y sin esto un `dispose` previo la dejaba inservible (el botón «Activar sonido» no hacía nada).
   */
  attach(): void;
  dispose(): void;
}

const defaultContext = (): AudioContext => {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("este navegador no tiene Web Audio");
  return new Ctor();
};
const defaultFetch = async (url: string): Promise<ArrayBuffer> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
};

export function createAudioPlayer(deps: PlayerDeps = {}): AudioPlayer {
  const holder = deps.holder ?? sharedHolder;
  const makeContext = deps.createContext ?? defaultContext;
  const fetchBytes = deps.fetchBytes ?? defaultFetch;
  let status: AudioStatus = "off";
  let volume = 0.8;
  let disposed = false;
  const listeners = new Set<Listener>();
  const events = new Map<string, string>(); // evento → url, de la última activación
  const setStatus = (s: AudioStatus) => {
    if (status === s) return;
    status = s;
    for (const l of [...listeners]) l();
  };

  const load = (url: string): Promise<void> => {
    const known = holder.loading.get(url);
    if (known) return known;
    const p = (async () => {
      try {
        const ctx = holder.ctx;
        if (!ctx) return;
        const bytes = await fetchBytes(url);
        holder.buffers.set(url, await ctx.decodeAudioData(bytes));
      } catch {
        holder.loading.delete(url); // se podrá reintentar en la próxima activación; mientras tanto ese sonido se omite
      }
    })();
    holder.loading.set(url, p);
    return p;
  };

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async enable(urls) {
      if (disposed) return status;
      try {
        if (!holder.ctx) {
          holder.ctx = makeContext();
          holder.gain = holder.ctx.createGain();
          holder.gain.connect(holder.ctx.destination);
        }
        holder.gain!.gain.value = volume;
        await holder.ctx.resume();
        if (holder.ctx.state !== "running") throw new Error("el navegador no dejó activar el audio");
        for (const [event, url] of Object.entries(urls)) events.set(event, url);
        setStatus("on");
        await Promise.allSettled([...new Set(Object.values(urls))].map(load));
      } catch {
        setStatus("unavailable");
      }
      return status;
    },

    disable() {
      if (status === "on") setStatus("off");
    },

    setVolume(v) {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.8));
      if (holder.gain) holder.gain.gain.value = volume;
    },

    play(event) {
      if (status !== "on" || !holder.ctx || !holder.gain) return false;
      try {
        const url = events.get(event);
        const buffer = url ? holder.buffers.get(url) : undefined;
        if (!buffer) return false; // sin sonido asignado o aún sin decodificar: se omite, el texto sigue
        const source = holder.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(holder.gain);
        source.start();
        deps.onPlay?.(event);
        return true;
      } catch {
        return false;
      }
    },

    attach() {
      disposed = false;
    },

    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
