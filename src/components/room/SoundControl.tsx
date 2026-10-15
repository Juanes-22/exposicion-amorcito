import type { AudioSignals } from "../../app/audio/useAudioSignals";

/**
 * Control de sonido de esta pantalla (SPECS 10.4): empieza activado (suena desde el primer toque en la página) y se puede silenciar. El
 * volumen y el silencio son preferencia local. Si el navegador no puede reproducir audio, lo dice y todo sigue igual: cada señal
 * importante tiene su texto.
 */
export function SoundControl({ audio, compact = false }: { audio: AudioSignals; compact?: boolean }) {
  const on = audio.status === "on" || audio.armed;
  return (
    <div className={`sound-control${compact ? " sound-control--compact" : ""}`}>
      <button type="button" className="btn btn--small-bar" data-sound-toggle aria-pressed={on} disabled={audio.status === "unavailable"} onClick={on ? audio.disable : audio.enable}>
        {on ? "🔊 Silenciar" : "🔈 Activar sonido"}
      </button>
      {on && !compact ? (
        <label className="sound-control__volume">
          <span className="visually-hidden">Volumen</span>
          <input type="range" min={0} max={1} step={0.1} value={audio.volume} onChange={(e) => audio.setVolume(Number(e.target.value))} aria-label="Volumen del sonido" />
        </label>
      ) : null}
      {audio.status === "unavailable" ? (
        <span className="sound-control__note" role="status">
          Sonido no disponible aquí. La aventura sigue igual.
        </span>
      ) : null}
    </div>
  );
}

/** Texto equivalente de la última señal importante: anunciado a lectores de pantalla y visible unos segundos (independiente del sonido). */
export function SignalText({ audio }: { audio: AudioSignals }) {
  return (
    <>
      <div role="status" aria-live="polite" className="visually-hidden">{audio.signal?.text ?? ""}</div>
      {audio.signal ? <div className="signal" aria-hidden="true">{audio.signal.text}</div> : null}
    </>
  );
}
