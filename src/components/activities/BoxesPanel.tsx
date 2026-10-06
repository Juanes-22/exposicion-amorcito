import { useState } from "react";
import type { BoxesActivityConfig } from "../../../shared/contracts/config";
import type { BoxesState } from "../../../shared/contracts/state";
import { modalitiesFor, suggestionsFor } from "./modalities";
import { RecordForm } from "./RecordForm";
import type { PanelCommon } from "./types";

export function BoxesPanel({ cfg, st, c }: { cfg: BoxesActivityConfig; st: BoxesState; c: PanelCommon }) {
  // El toque sobre la caja personal solo muestra un mensaje local: NO existe ninguna acción de abrirla (SPECS 3.4).
  const [touched, setTouched] = useState(false);
  const afterRefusal = st.step === "refusal" || st.step === "respect" || st.step === "nextQuestion" || st.step === "completed";
  const canInspect = c.interactive && st.sharedOpen;

  const selected = cfg.sharedObjects.find((o) => o.id === st.selectedObjectId);
  const ownerSays = (
    <div className="dialogue">
      <p className="hint">{cfg.personalBox.ownerLabel}</p>
      <p>«{c.dialogues[cfg.refusalDialogueId]}»</p>
    </div>
  );
  // Quien tiene el turno elige objetos; la proyección solo ve cuáles se han mirado (sin botones que parezcan activos).
  const objects = (
    <>
      <ul className="objects" aria-label="Objetos de la caja compartida">
        {cfg.sharedObjects.map((o) => {
          const mark = `${st.inspected.includes(o.id) ? "✓ " : ""}${o.label}`;
          return (
            <li key={o.id}>
              {canInspect ? (
                <button
                  type="button"
                  className={`btn object${st.selectedObjectId === o.id ? " is-selected" : ""}`}
                  disabled={c.busy}
                  aria-pressed={st.selectedObjectId === o.id}
                  onClick={() => void c.send({ type: "boxes.object.inspect", objectId: o.id })}
                >
                  {mark}
                </button>
              ) : (
                <span className={`object-chip${st.selectedObjectId === o.id ? " is-selected" : ""}`}>{mark}</span>
              )}
            </li>
          );
        })}
      </ul>
      {selected ? <p className="object__desc" role="status">{selected.description}</p> : null}
    </>
  );

  return (
    <>
      {st.step === "exploreShared" ? <p className="activity-prompt">{cfg.prompts.exploreShared}</p> : null}
      {st.step === "askPermission" ? <p className="activity-prompt">{cfg.prompts.askPermission}</p> : null}
      {st.step === "nextQuestion" && !c.interactive ? <p className="activity-prompt">{cfg.prompts.nextQuestion}</p> : null}

      {c.interactive && !st.sharedOpen ? (
        <button type="button" className="btn btn--primary" disabled={c.busy} onClick={() => void c.send({ type: "boxes.shared.open" })}>
          Abrir la caja para explorar
        </button>
      ) : null}
      {st.sharedOpen ? objects : null}

      {st.step === "askPermission" && c.interactive ? (
        <button type="button" className="btn" disabled={c.busy} onClick={() => void c.send({ type: "boxes.permission.ask" })}>
          Pedir permiso para abrir la caja personal
        </button>
      ) : null}

      {st.step === "refusal" ? (
        <>
          {ownerSays}
          {c.interactive ? (
            <button type="button" className="btn btn--primary" disabled={c.busy} onClick={() => void c.send({ type: "boxes.refusal.ack" })}>
              Entendido
            </button>
          ) : null}
        </>
      ) : null}

      {st.step === "respect" ? (
        <>
          {ownerSays}
          <p className="activity-prompt">{cfg.prompts.respect}</p>
          {c.interactive ? (
            <button type="button" className="btn btn--primary" disabled={c.busy} onClick={() => void c.send({ type: "boxes.refusal.respect" })}>
              Respetar y seguir explorando
            </button>
          ) : null}
        </>
      ) : null}

      {st.step === "nextQuestion" && c.interactive ? (
        <RecordForm
          room={c.room}
          activityId={c.id}
          field="question"
          prompt={cfg.prompts.nextQuestion!}
          modalities={modalitiesFor("boxes", "question")}
          suggestions={suggestionsFor(cfg, "question")}
          suggestionsLabel="Elegir una pregunta"
          objects={cfg.sharedObjects}
          initialObjectId={st.selectedObjectId}
          labels={c.labels}
          maxChars={c.maxChars}
          busy={c.busy}
          onSubmit={(value, objectId) => c.send({ type: "record.confirm", activityId: c.id, field: "question", value, ...(objectId ? { objectId } : {}) })}
        />
      ) : null}

      {afterRefusal ? (
        <div className="personal-box">
          <button type="button" className="btn btn--ghost" onClick={() => setTouched(true)}>
            {cfg.personalBox.label} (cerrada)
          </button>
          {touched ? <p role="status">{c.dialogues[cfg.personalTouchDialogueId]}</p> : null}
        </div>
      ) : null}
    </>
  );
}
