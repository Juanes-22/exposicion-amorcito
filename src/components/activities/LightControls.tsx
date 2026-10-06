import { useEffect, useMemo, useRef, useState } from "react";
import type { AdventureAction, CommandResult } from "../../../shared/contracts/actions";
import type { ShadowsExperiment } from "../../../shared/contracts/config";
import { createThrottledSender } from "./throttle";

interface Props {
  experiment: ShadowsExperiment;
  /** Distancia vigente según el servidor. */
  distanceCm: number;
  disabled: boolean;
  send: (action: AdventureAction) => Promise<CommandResult>;
  /** Solo en el paso de exploración se pueden anotar posiciones. */
  canNote: boolean;
}

const STEP_CM = 1;

/**
 * Linterna: slider con «Más lejos del objeto» a la izquierda y «Más cerca del objeto» a la derecha, más botones −/+ equivalentes
 * (SPECS 3.2, 11.1). El arrastre se envía a ≈ 12 Hz sin contar como exploración; la posición se anota al terminar el gesto o al
 * pulsar «Anotar esta posición» (teclado y botones). El valor mostrado mientras se arrastra es local y se reconcilia con el servidor.
 */
export function LightControls({ experiment: e, distanceCm, disabled, send, canNote }: Props) {
  const { sourceDistanceMinCm: min, sourceDistanceMaxCm: max } = e;
  const [local, setLocal] = useState<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const value = local ?? distanceCm;
  const latest = useRef(value);
  latest.current = value;

  const sender = useMemo(() => createThrottledSender<number>((d) => void send({ type: "shadows.light.set", distanceCm: d, commitSample: false })), [send]);
  useEffect(() => () => sender.dispose(), [sender]);
  // Cuando el servidor ya refleja lo que se arrastró, se vuelve a mostrar su valor.
  useEffect(() => {
    if (local !== null && Math.abs(local - distanceCm) < 1e-6) setLocal(null);
  }, [distanceCm, local]);
  useEffect(() => () => void (clearTimer.current && clearTimeout(clearTimer.current)), []);

  const move = (d: number) => {
    const clamped = Math.min(max, Math.max(min, d));
    setLocal(clamped);
    sender.push(clamped);
  };
  const note = (d: number) => {
    sender.flush();
    void send({ type: "shadows.light.set", distanceCm: d, commitSample: true });
    // Si el servidor rechaza o no cambia nada, no se queda un valor local flotando.
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setLocal(null), 800);
  };

  // El slider crece hacia «más cerca»: izquierda = más lejos (distancia máxima).
  const slider = min + max - value;
  return (
    <div className="light-controls">
      <div className="light-controls__row">
        <button type="button" className="btn btn--round" disabled={disabled || value >= max} onClick={() => move(value + STEP_CM)} aria-label="Alejar la linterna del objeto">
          −
        </button>
        <input
          type="range"
          className="light-controls__slider"
          min={min}
          max={max}
          step={STEP_CM}
          value={slider}
          disabled={disabled}
          onChange={(ev) => move(min + max - Number(ev.target.value))}
          onPointerUp={() => canNote && note(latest.current)}
          aria-label="Distancia de la linterna al objeto"
          aria-valuetext={`${value} centímetros del objeto`}
        />
        <button type="button" className="btn btn--round" disabled={disabled || value <= min} onClick={() => move(value - STEP_CM)} aria-label="Acercar la linterna al objeto">
          +
        </button>
      </div>
      <div className="light-controls__ends" aria-hidden="true">
        <span>Más lejos del objeto</span>
        <span>Más cerca del objeto</span>
      </div>
      {canNote ? (
        <button type="button" className="btn" disabled={disabled} onClick={() => note(value)}>
          Anotar esta posición
        </button>
      ) : null}
    </div>
  );
}
