import { useEffect, useState } from "react";
import type { RampsActivityConfig } from "../../../shared/contracts/config";
import type { RampsState } from "../../../shared/contracts/state";
import { angleLabel } from "../../../shared/domain/models";
import { finishedTrials, hasComparableTrials, runningTrial } from "../../../shared/domain/results";
import type { PersonalActions } from "./types";

/**
 * Rampas (propuesta de rondas, sección 6): cada persona elige una de las inclinaciones de la mesa, por su nombre, y suelta la pelota; al
 * terminar, la prueba se registra sola. La mesa no muestra grados ni tiempos: cuánto demoró la pelota en caer es la pregunta que el
 * grupo conversa después. Mientras la pelota rueda no se puede cambiar la inclinación ni soltar otra.
 */
export function RampsControls({ cfg, st, a }: { cfg: RampsActivityConfig; st: RampsState; a: PersonalActions }) {
  const e = cfg.experiment;
  const angles: number[] = [];
  for (let x = e.minAngleDeg; x <= e.maxAngleDeg + 1e-9; x += e.angleStepDeg) angles.push(x);
  const running = runningTrial(st);
  const done = finishedTrials(st);
  const [angle, setAngle] = useState(() => st.trials.at(-1)?.angleDeg ?? e.minAngleDeg);
  const idx = Math.max(0, angles.indexOf(angle));
  const lock = running !== undefined || !a.interactive; // sin nueva suelta ni cambio de inclinación durante una prueba
  const label = angleLabel(e, angle);

  useEffect(() => {
    a.setLocal({ angleDeg: angle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle]);
  const choose = (v: number) => setAngle(v);
  const comparable = hasComparableTrials(st, cfg);

  return (
    <div className="experiment">
      <p className="experiment__readout" role="status" aria-live="polite">
        Inclinación: <strong>{label}</strong>
      </p>
      <div className="light-controls">
        <div className="light-controls__row">
          <button type="button" className="btn btn--round" disabled={lock || idx <= 0} onClick={() => choose(angles[idx - 1]!)} aria-label="Bajar la inclinación">
            −
          </button>
          <input
            type="range"
            className="light-controls__slider"
            min={0}
            max={angles.length - 1}
            step={1}
            value={idx}
            disabled={lock}
            onChange={(ev) => choose(angles[Number(ev.target.value)]!)}
            aria-label="Inclinación de la rampa"
            aria-valuetext={label}
          />
          <button type="button" className="btn btn--round" disabled={lock || idx >= angles.length - 1} onClick={() => choose(angles[idx + 1]!)} aria-label="Subir la inclinación">
            +
          </button>
        </div>
        <div className="light-controls__ends" aria-hidden="true">
          <span>Menos empinada</span>
          <span>Más empinada</span>
        </div>
        <button type="button" className="btn btn--primary" disabled={lock || a.busy} onClick={() => void a.act({ type: "ramps.trial.start", angleDeg: angle })}>
          {running ? "La pelota está rodando…" : "Soltar la pelota"}
        </button>
      </div>
      {st.trials.length > 0 ? (
        <ol className="results" aria-label="Tus pruebas de la rampa">
          {st.trials.map((t, i) => (
            <li key={t.trialId}>
              Prueba {i + 1}: {angleLabel(e, t.angleDeg).toLowerCase()}
              {t.state === "running" ? " · rodando…" : t.state === "cancelled" ? " · cancelada" : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="hint">
        {comparable ? "Ya soltaste la pelota con inclinaciones distintas: puedes seguir probando." : `Suelta la pelota con ${e.requiredTrials} inclinaciones distintas y mira cómo baja (llevas ${done.length}).`} ¿Cuánto crees que demora en caer?
      </p>
    </div>
  );
}
