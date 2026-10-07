import { useEffect, useState } from "react";
import type { RampsActivityConfig } from "../../../shared/contracts/config";
import type { RampsState } from "../../../shared/contracts/state";
import { formatNumber } from "../../../shared/domain/models";
import { finishedTrials, hasComparableTrials, runningTrial } from "../../../shared/domain/results";
import type { PersonalActions } from "./types";

/**
 * Rampas (propuesta de rondas, sección 6): cada persona elige una inclinación y suelta la pelota; al terminar, el ángulo y el tiempo de
 * la simulación se registran solos. Mientras la pelota rueda no se puede cambiar la inclinación ni soltar otra.
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

  useEffect(() => {
    a.setLocal({ angleDeg: angle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle]);
  const choose = (v: number) => setAngle(v);
  const comparable = hasComparableTrials(st, cfg);

  return (
    <div className="experiment">
      <p className="experiment__readout" role="status" aria-live="polite">
        Inclinación: <strong>{formatNumber(angle)}°</strong> · la pelota recorre {formatNumber(e.lengthMeters)} m
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
            aria-valuetext={`${angle} grados`}
          />
          <button type="button" className="btn btn--round" disabled={lock || idx >= angles.length - 1} onClick={() => choose(angles[idx + 1]!)} aria-label="Subir la inclinación">
            +
          </button>
        </div>
        <div className="light-controls__ends" aria-hidden="true">
          <span>{formatNumber(e.minAngleDeg)}°</span>
          <span>{formatNumber(e.maxAngleDeg)}°</span>
        </div>
        <button type="button" className="btn btn--primary" disabled={lock || a.busy} onClick={() => void a.act({ type: "ramps.trial.start", angleDeg: angle })}>
          {running ? "La pelota está rodando…" : "Soltar la pelota"}
        </button>
      </div>
      {st.trials.length > 0 ? (
        <table className="trials">
          <caption className="visually-hidden">Tus pruebas de la rampa</caption>
          <thead>
            <tr>
              <th scope="col">Prueba</th>
              <th scope="col">Inclinación</th>
              <th scope="col">Tiempo de la simulación</th>
            </tr>
          </thead>
          <tbody>
            {st.trials.map((t, i) => (
              <tr key={t.trialId}>
                <th scope="row">{i + 1}</th>
                <td>{formatNumber(t.angleDeg)}°</td>
                <td>{t.state === "finished" ? `${formatNumber(t.durationMs / 1000, 1)} s` : t.state === "running" ? "rodando…" : "cancelada"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="hint">
        {comparable ? "Ya tienes pruebas que se pueden comparar: puedes seguir probando." : `Para comparar hacen falta ${e.requiredTrials} pruebas terminadas con inclinaciones que se diferencien al menos ${formatNumber(e.minDistinctAngleDeg)}° (llevas ${done.length}).`}{" "}
        El tiempo es el de la simulación, no una medición real.
      </p>
    </div>
  );
}
