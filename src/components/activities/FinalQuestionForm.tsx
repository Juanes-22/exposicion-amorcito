import { useId, useState } from "react";
import type { AdventureAction, CommandResult, FinalQuestionInput } from "../../../shared/contracts/actions";
import { INVENTOR_ID, type LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { countChars } from "../../../shared/domain/text";
import { drafts } from "./drafts";
import { FIELD_LABEL, recordText } from "./steps";

type Mode = "saved" | "suggested" | "written" | "oral";
const MODE_LABEL: Record<Mode, string> = { saved: "Elegir una pregunta del cuaderno", suggested: "Elegir una sugerencia", written: "Escribir una nueva", oral: "La diremos en voz alta" };

interface Props {
  room: string;
  config: LaboratorioConfig;
  adv: AdventureState;
  busy: boolean;
  send: (action: AdventureAction) => Promise<CommandResult>;
}

/**
 * Pregunta final del inventor (SPECS 3.5): una pregunta ya guardada en el cuaderno, una sugerencia, una nueva o la participación oral.
 * El texto escrito es un borrador local hasta compartirlo. No genera respuestas: solo registra la pregunta elegida por el grupo.
 */
export function FinalQuestionForm({ room, config, adv, busy, send }: Props) {
  const uid = useId();
  const saved = adv.notebook.filter((r) => r.field === "nextQuestion" || r.field === "question");
  const suggestions = [...new Map(config.route.flatMap((id) => config.activities[id]!.suggestions).map((o) => [o.id, o])).values()];
  const modes = ([saved.length > 0 ? "saved" : null, suggestions.length > 0 ? "suggested" : null, "written", "oral"] as Array<Mode | null>).filter((m): m is Mode => m !== null);
  const key = { room, activityId: INVENTOR_ID, field: "finalQuestion" };
  const [mode, setMode] = useState<Mode>(modes[0]!);
  const [text, setText] = useState(() => drafts.get(key));
  const [pick, setPick] = useState("");
  const [sending, setSending] = useState(false);
  const max = config.ui.maxRecordCharacters;
  const chars = countChars(text.trim());
  const tooLong = chars > max;
  const valid = mode === "written" ? chars > 0 && !tooLong : mode === "oral" ? true : pick !== "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy || sending) return;
    const value: FinalQuestionInput = mode === "saved" ? { modality: "saved", recordId: pick } : mode === "suggested" ? { modality: "suggested", optionId: pick } : mode === "written" ? { modality: "written", text: text.trim() } : { modality: "oral" };
    setSending(true);
    try {
      const result = await send({ type: "inventor.question.confirm", value });
      if (result.ok) drafts.clear(key);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="record-form" onSubmit={submit} noValidate>
      <p className="record-form__notice" role="note">{config.ui.labels.shareNotice ?? "Esta idea se compartirá con el grupo"}</p>
      <p className="record-form__prompt">{config.inventor.prompt}</p>
      <fieldset className="record-form__modes">
        <legend className="visually-hidden">Cómo quieres elegir la pregunta</legend>
        {modes.map((m) => (
          <label key={m} className={`mode${mode === m ? " is-selected" : ""}`}>
            <input type="radio" name={`${uid}-mode`} value={m} checked={mode === m} onChange={() => (setMode(m), setPick(""))} />
            <span>{MODE_LABEL[m]}</span>
          </label>
        ))}
      </fieldset>

      {mode === "saved" ? (
        <fieldset className="record-form__options">
          <legend className="visually-hidden">{MODE_LABEL.saved}</legend>
          {saved.map((r) => (
            <label key={r.id} className={`option${pick === r.id ? " is-selected" : ""}`}>
              <input type="radio" name={`${uid}-saved`} value={r.id} checked={pick === r.id} onChange={() => setPick(r.id)} />
              <span>
                {recordText(r, config.ui.labels)} <span className="hint">· {config.activities[r.activityId]?.title ?? r.activityId} · {FIELD_LABEL[r.field]} de {r.authorName}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {mode === "suggested" ? (
        <fieldset className="record-form__options">
          <legend className="visually-hidden">{MODE_LABEL.suggested}</legend>
          {suggestions.map((o) => (
            <label key={o.id} className={`option${pick === o.id ? " is-selected" : ""}`}>
              <input type="radio" name={`${uid}-sug`} value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
              <span>{o.text}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {mode === "written" ? (
        <div className="field">
          <label htmlFor={`${uid}-text`}>Tu pregunta</label>
          <textarea
            id={`${uid}-text`}
            className="input record-form__text"
            rows={3}
            value={text}
            onChange={(e) => (setText(e.target.value), drafts.set(key, e.target.value))}
            onFocus={(e) => window.setTimeout(() => e.currentTarget.scrollIntoView({ block: "center" }), 300)}
            aria-describedby={`${uid}-count`}
            aria-invalid={tooLong}
            autoComplete="off"
          />
          <span id={`${uid}-count`} className={`hint${tooLong ? " error" : ""}`}>{chars}/{max} caracteres. Tu borrador se queda en este dispositivo hasta que lo compartas.</span>
        </div>
      ) : null}
      {mode === "oral" ? <p className="record-form__fixed">{config.inventor.oralQuestionText}</p> : null}

      <button type="submit" className="btn btn--primary" disabled={!valid || busy || sending}>
        {sending || busy ? "Compartiendo…" : "Compartir la pregunta final"}
      </button>
    </form>
  );
}
