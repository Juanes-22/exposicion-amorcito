import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
}

/**
 * Señales de la aventura para una pantalla (SPECS 10.4): texto equivalente SIEMPRE y sonido solo si la persona lo activó con un gesto.
 * - `phone`: empieza en silencio y no recupera una preferencia anterior si `audio.phoneInitiallyMuted`.
 * - `computer` (la proyección): si la última vez estaba activado, el PRIMER gesto en la página lo vuelve a activar.
 * La espera nunca llega aquí: no recibe snapshots ni efectos.
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
  useEffect(() => () => player.dispose(), [player]);
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

  const enable = useCallback(() => {
    player.setVolume(volume);
    void player.enable(urls).then((s) => saveSoundPreference({ on: s === "on", volume }));
  }, [player, urls, volume]);
  const disable = useCallback(() => {
    player.disable();
    saveSoundPreference({ on: false, volume });
  }, [player, volume]);
  const setVolume = useCallback(
    (v: number) => {
      setVolumeState(v);
      player.setVolume(v);
      saveSoundPreference({ on: player.getStatus() === "on", volume: v });
    },
    [player],
  );

  // En la computadora proyectada, una preferencia «activado» se retoma con el primer gesto (los navegadores no dejan sonar antes).
  const armed = useRef(device === "computer" && loadSoundPreference().on);
  useEffect(() => {
    if (!armed.current || player.getStatus() !== "off") return;
    const arm = () => {
      armed.current = false;
      void player.enable(urls);
    };
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [player, urls]);

  // Sin conexión no se «adivina» nada: el siguiente snapshot, ya reconectado, es solo línea de base (sin celebraciones históricas).
  useEffect(() => {
    if (state.status !== "connected") tracker.reset();
  }, [tracker, state.status]);

  const snapshot = state.snapshot;
  const connected = state.status === "connected";
  useEffect(() => {
    // Un snapshot que llega sin conexión vigente no es una transición: el primero tras reconectar vuelve a ser línea de base.
    if (!snapshot || !connected) return;
    for (const s of tracker.consume(snapshot)) {
      setSignal({ id: s.id, text: s.text });
      player.play(s.event);
    }
  }, [snapshot, connected, tracker, player]);

  useEffect(() => {
    if (!signal) return;
    const t = setTimeout(() => setSignal((cur) => (cur?.id === signal.id ? null : cur)), SIGNAL_MS);
    return () => clearTimeout(t);
  }, [signal]);

  return { status, volume, enable, disable, setVolume, signal };
}
