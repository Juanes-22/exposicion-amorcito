import { useEffect, useRef, useState } from "react";
import type { ShadowsExperiment } from "../../../shared/contracts/config";

interface Props {
  experiment: ShadowsExperiment;
  /** Última posición registrada; la inicial si todavía no hay ninguna. */
  initialCm: number;
  disabled: boolean;
  /** Mientras se ajusta: lo dibuja la escena al instante, sin esperar al servidor. */
  onMove: (distanceCm: number) => void;
  /** Al terminar el ajuste: se registra la posición y su sombra (no hay botón de anotar). */
  onCommit: (distanceCm: number) => void;
}

const STEP_CM = 1;
/** Pausa tras el último cambio de los botones −/+ para considerar que el ajuste terminó. */
const SETTLE_MS = 600;

/**
 * Linterna: slider con «Más lejos del objeto» a la izquierda y «Más cerca del objeto» a la derecha, más botones −/+ equivalentes
 * (SPECS 3.2, 11.1). El ajuste es local; cuando termina (se suelta el slider, o los botones dejan de pulsarse un instante) la
 * posición se registra sola con su sombra: no hace falta «Anotar esta posición».
 */
export function LightControls({ experiment: e, initialCm, disabled, onMove, onCommit }: Props) {
  const { sourceDistanceMinCm: min, sourceDistanceMaxCm: max } = e;
  const [value, setValue] = useState(initialCm);
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    onMove(initialCm);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Solo al abrir: la posición inicial se muestra en la escena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    onCommit(latest.current);
  };
  const move = (d: number) => {
    const clamped = Math.min(max, Math.max(min, d));
    setValue(clamped);
    onMove(clamped);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SETTLE_MS);
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
          onPointerUp={flush}
          onPointerCancel={flush}
          onKeyUp={() => flush()}
          onBlur={flush}
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
    </div>
  );
}
