import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { LoadedProject } from "../../config/loadProject";
import { readGameFlags } from "../../game/flags";
import type { RoomClientState } from "../RoomController";
import { loadSoundPreference, saveSoundPreference } from "./preferences";
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "./player";
import { createSignalTracker, type Signal } from "./signals";

/** Cuánto dura a la vista el texto de una señal (también se anuncia a lectores de pantalla). */
const SIGNAL_MS = 6000;

export interface AudioSignals {
  status: AudioStatus;
  volume: number;
  enable(): void;
  disable(): void;
  setVolume(v: number): void;
  /** El texto equivalente de la última señal importante; existe aunque el sonido esté apagado. */
  signal: Pick<Signal, "id" | "text"> | null;
  /**
   * El sonido está activado pero todavía no puede sonar: los navegadores esperan un primer toque o tecla en la página, y con ese gesto
   * (en cualquier parte) empieza. El control lo muestra como activado.
   */
  armed: boolean;
}

/**
 * Señales de la aventura para una pantalla (SPECS 10.4): texto equivalente SIEMPRE y sonido activado por defecto. Como los navegadores no
 * dejan sonar antes de un gesto, el sonido empieza con el PRIMER toque o tecla en la página (en cualquier parte). Quien lo silencia lo
 * deja apagado en ese dispositivo (preferencia local). Con `audio.phoneInitiallyMuted` el teléfono empieza en silencio igualmente.
 * Quien acompaña como observadora recibe las señales de grupo, pero ninguna personal.
 */
export function useAudioSignals({ project, state, device, player: injected }: { project: LoadedProject; state: RoomClientState; device: "computer" | "phone"; player?: AudioPlayer }): AudioSignals {
  const { config } = project.bundle;
  const player = useMemo(
    () =>
      injected ??
      createAudioPlayer({
        onPlay: (e) => {
          if (readGameFlags().hooks) ((window as unknown as { __AUDIO_LOG__?: string[] }).__AUDIO_LOG__ ??= []).push(e);
        },
      }),
    [injected],
  );
  // `attach` en cada montaje: StrictMode (desarrollo) desmonta y monta de nuevo con el mismo reproductor, ya «soltado» por el primer desmontaje.
  useEffect(() => {
    player.attach();
    return () => player.dispose();
  }, [player]);
  const status = useSyncExternalStore(player.subscribe, player.getStatus);
  const [volume, setVolumeState] = useState(() => loadSoundPreference().volume);
  const [signal, setSignal] = useState<Pick<Signal, "id" | "text"> | null>(null);
  const tracker = useMemo(() => createSignalTracker(config), [config]);

  // Evento → URL del archivo, solo de los eventos con sonido asignado y presente en el catálogo.
  const urls = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [event, id] of Object.entries(config.audio.events)) if (project.registry.has(id)) out[event] = project.registry.url(id);
    return out;
  }, [config, project]);

  // Activado por preferencia (por defecto, sí) y a la espera del primer gesto de la página.
  const [armed, setArmed] = useState(() => loadSoundPreference().on && !(device === "phone" && config.audio.phoneInitiallyMuted));

  const enable = useCallback(() => {
    setArmed(false);
    player.setVolume(volume);
    void player.enable(urls).then((s) => saveSoundPreference({ on: s === "on", volume }));
  }, [player, urls, volume]);
  const disable = useCallback(() => {
    setArmed(false);
    player.disable();
    saveSoundPreference({ on: false, volume });
  }, [player, volume]);
  const setVolume = useCallback(
    (v: number) => {
      setVolumeState(v);
      player.setVolume(v);
      // Cambiar el volumen no enciende ni silencia: se conserva lo que la persona eligió.
      saveSoundPreference({ ...loadSoundPreference(), volume: v });
    },
    [player],
  );

  // El primer gesto en cualquier parte de la página hace sonar el sonido activado. El propio botón de sonido queda fuera: lo que decide
  // pulsarlo (por ejemplo, silenciarlo de entrada) lo resuelve su clic, sin que este gesto lo encienda antes.
  useEffect(() => {
    if (!armed || player.getStatus() !== "off") return;
    const arm = (ev: Event) => {
      if (ev.target instanceof Element && ev.target.closest("[data-sound-toggle]")) return;
      setArmed(false);
      player.setVolume(volume);
      void player.enable(urls);
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [armed, player, urls, volume]);

  // Sin conexión no se «adivina» nada: el siguiente snapshot, ya reconectado, es solo línea de base (sin celebraciones históricas).
  useEffect(() => {
    if (state.status !== "connected") tracker.reset();
  }, [tracker, state.status]);

  const group = state.group;
  const me = state.me;
  const connected = state.status === "connected";
  const emit = useCallback(
    (signals: Signal[]) => {
      for (const s of signals) {
        setSignal({ id: s.id, text: s.text });
        player.play(s.event);
      }
    },
    [player],
  );
  // Un estado que llega sin conexión vigente no es una transición: el primero tras reconectar vuelve a ser línea de base.
  useEffect(() => {
    if (group && connected) emit(tracker.group(group));
  }, [group, connected, tracker, emit]);
  useEffect(() => {
    if (me && connected) emit(tracker.me(me));
  }, [me, connected, tracker, emit]);

  useEffect(() => {
    if (!signal) return;
    const t = setTimeout(() => setSignal((cur) => (cur?.id === signal.id ? null : cur)), SIGNAL_MS);
    return () => clearTimeout(t);
  }, [signal]);

  return { status, volume, enable, disable, setVolume, signal, armed: armed && status === "off" };
}
