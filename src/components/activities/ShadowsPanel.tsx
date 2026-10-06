import { useEffect, useState } from "react";
import type { ShadowsActivityConfig } from "../../../shared/contracts/config";
import type { ShadowsState } from "../../../shared/contracts/state";
import { describeShadow, shadowHeightCm } from "../../../shared/domain/models";
import { LightControls } from "./LightControls";
import { modalitiesFor, suggestionsFor } from "./modalities";
import { RecordForm } from "./RecordForm";
import type { PanelCommon } from "./types";

/** Mantiene un texto estable un momento antes de anunciarlo a lectores de pantalla: arrastrar el slider no debe inundarlos. */
function useSettled(text: string, ms = 700): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setShown(text), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return shown;
}

export function ShadowsPanel({ cfg, st, c }: { cfg: ShadowsActivityConfig; st: ShadowsState; c: PanelCommon }) {
  const e = cfg.experiment;
  const counted = st.samples.filter((s) => s.counts).length;
  const description = describeShadow(st.distanceCm, shadowHeightCm(st.distanceCm, e.screenDistanceCm, e.objectHeightCm), e.objectHeightCm);
  const announced = useSettled(description);
  const form = (field: "firstIdea" | "observation" | "nextQuestion", prompt: string) => (
    <RecordForm
      room={c.room}
      activityId={c.id}
      field={field}
      prompt={prompt}
      modalities={modalitiesFor("shadows", field)}
      suggestions={suggestionsFor(cfg, field)}
      suggestionsLabel={field === "firstIdea" ? "Elegir una idea" : "Elegir una pregunta"}
      labels={c.labels}
      maxChars={c.maxChars}
      busy={c.busy}
      onSubmit={(value) => c.send({ type: "record.confirm", activityId: c.id, field, value })}
    />
  );
  const exploring = st.step === "explore" || st.step === "observation" || st.step === "completed";

  return (
    <>
      {st.step === "surprise" || st.step === "firstIdea" ? (
        <>
          <p className="activity-prompt">{cfg.firstPrompt}</p>
          {c.interactive && st.step === "surprise" ? (
            <button type="button" className="btn" disabled={c.busy} onClick={() => void c.send({ type: "shadows.surprise.ack" })}>
              Mirar el objeto
            </button>
          ) : null}
          {c.interactive ? form("firstIdea", cfg.prompts.firstIdea!) : <p className="activity-wait">{c.ownerName ? `${c.ownerName} está pensando su primera idea…` : cfg.prompts.firstIdea}</p>}
        </>
      ) : null}

      {st.step === "explore" ? <p className="activity-prompt">{cfg.prompts.explore}</p> : null}
      {st.step === "observation" && !c.interactive ? <p className="activity-prompt">{cfg.prompts.observation}</p> : null}
      {st.step === "nextQuestion" ? (c.interactive ? form("nextQuestion", cfg.prompts.nextQuestion!) : <p className="activity-prompt">{cfg.prompts.nextQuestion}</p>) : null}

      {exploring ? (
        <div className="experiment">
          <p className="experiment__readout" role="status" aria-live="polite">
            <span className="visually-hidden">{announced}</span>
            <span aria-hidden="true">{description}</span>
          </p>
          <p className="hint">
            Posiciones anotadas: {counted} de {e.requiredSamples}
            {st.samples.length > counted ? ` (${st.samples.length - counted} muy parecida${st.samples.length - counted > 1 ? "s" : ""} a otra: no cuenta${st.samples.length - counted > 1 ? "n" : ""})` : ""}
          </p>
          {c.interactive ? <LightControls experiment={e} distanceCm={st.distanceCm} disabled={false} send={c.send} canNote={st.step === "explore"} /> : null}
        </div>
      ) : null}

      {st.step === "observation" && c.interactive ? form("observation", cfg.prompts.observation!) : null}
    </>
  );
}
