import type { RampsActivityConfig } from "../../../shared/contracts/config";
import type { RampsState } from "../../../shared/contracts/state";
import { finishedTrials, hasComparableTrials, runningTrial } from "../../../shared/domain/adventure";
import { formatNumber } from "../../../shared/domain/models";
import { modalitiesFor, suggestionsFor } from "./modalities";
import { RecordForm } from "./RecordForm";
import type { PanelCommon } from "./types";

export function RampsPanel({ cfg, st, c }: { cfg: RampsActivityConfig; st: RampsState; c: PanelCommon }) {
  const e = cfg.experiment;
  const running = runningTrial(st);
  const done = finishedTrials(st);
  const comparable = hasComparableTrials(st, cfg);
  const experimenting = st.step === "trials" || st.step === "observation" || st.step === "completed";
  const form = (field: "question" | "prediction" | "observation", prompt: string) => (
    <RecordForm
      room={c.room}
      activityId={c.id}
      field={field}
      prompt={prompt}
      modalities={modalitiesFor("ramps", field)}
      suggestions={suggestionsFor(cfg, field)}
      suggestionsLabel="Elegir una pregunta"
      labels={c.labels}
      maxChars={c.maxChars}
      busy={c.busy}
      onSubmit={(value) => c.send({ type: "record.confirm", activityId: c.id, field, value })}
    />
  );
  const angles: number[] = [];
  for (let a = e.minAngleDeg; a <= e.maxAngleDeg + 1e-9; a += e.angleStepDeg) angles.push(a);
  const idx = Math.max(0, angles.indexOf(st.angleDeg));
  const setAngle = (a: number) => void c.send({ type: "ramps.angle.set", angleDeg: a });
  const lock = running !== undefined; // sin nueva suelta ni cambio de inclinación durante una prueba

  return (
    <>
      {st.step === "closedAnswer" ? (
        <>
          <div className="dialogue">
            <p><strong>Docente</strong>: «{cfg.firstPrompt}»</p>
            <p><strong>Guía</strong>: {cfg.guideLine}</p>
          </div>
          {c.interactive ? (
            <button type="button" className="btn btn--primary" disabled={c.busy} onClick={() => void c.send({ type: "ramps.question.open" })}>
              Tengo una pregunta
            </button>
          ) : (
            <p className="activity-wait">{c.ownerName ? `${c.ownerName} puede levantar la mano con «Tengo una pregunta».` : ""}</p>
          )}
          <p className="hint">Los controles de la rampa están desactivados hasta que alguien pregunte.</p>
        </>
      ) : null}

      {st.step === "question" ? (c.interactive ? form("question", cfg.prompts.question!) : <p className="activity-prompt">{cfg.prompts.question}</p>) : null}

      {st.step === "prediction" ? (
        <>
          <div className="dialogue"><p><strong>Docente</strong>: «{c.dialogues[cfg.inviteDialogueId]}»</p></div>
          {c.interactive ? form("prediction", cfg.prompts.prediction!) : <p className="activity-prompt">{cfg.prompts.prediction}</p>}
        </>
      ) : null}

      {experimenting ? (
        <div className="experiment">
          <p className="activity-prompt">{st.step === "observation" && !c.interactive ? cfg.prompts.observation : cfg.prompts.trials}</p>
          <p className="experiment__readout" role="status" aria-live="polite">
            Inclinación: <strong>{formatNumber(st.angleDeg)}°</strong> · la pelota recorre {formatNumber(e.lengthMeters)} m
          </p>
          {c.interactive ? (
            <div className="light-controls">
              <div className="light-controls__row">
                <button type="button" className="btn btn--round" disabled={lock || idx <= 0} onClick={() => setAngle(angles[idx - 1]!)} aria-label="Bajar la inclinación">−</button>
                <input
                  type="range"
                  className="light-controls__slider"
                  min={0}
                  max={angles.length - 1}
                  step={1}
                  value={idx}
                  disabled={lock}
                  onChange={(ev) => setAngle(angles[Number(ev.target.value)]!)}
                  aria-label="Inclinación de la rampa"
                  aria-valuetext={`${st.angleDeg} grados`}
                />
                <button type="button" className="btn btn--round" disabled={lock || idx >= angles.length - 1} onClick={() => setAngle(angles[idx + 1]!)} aria-label="Subir la inclinación">+</button>
              </div>
              <div className="light-controls__ends" aria-hidden="true"><span>{formatNumber(e.minAngleDeg)}°</span><span>{formatNumber(e.maxAngleDeg)}°</span></div>
              <button type="button" className="btn btn--primary" disabled={lock || c.busy} onClick={() => void c.send({ type: "ramps.trial.start" })}>
                {lock ? "La pelota está rodando…" : "Soltar la pelota"}
              </button>
            </div>
          ) : null}

          {st.trials.length > 0 ? (
            <table className="trials">
              <caption className="visually-hidden">Pruebas de la rampa</caption>
              <thead>
                <tr><th scope="col">Prueba</th><th scope="col">Inclinación</th><th scope="col">Tiempo de la simulación</th></tr>
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
            {comparable
              ? "Ya tienes pruebas que se pueden comparar."
              : `Para comparar hacen falta ${e.requiredTrials} pruebas terminadas con inclinaciones que se diferencien al menos ${formatNumber(e.minDistinctAngleDeg)}° (llevas ${done.length}).`}{" "}
            El tiempo es el de la simulación, no una medición real.
          </p>
        </div>
      ) : null}

      {st.step === "observation" && c.interactive ? form("observation", cfg.prompts.observation!) : null}
    </>
  );
}
