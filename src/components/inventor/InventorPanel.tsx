import { useState } from "react";
import type { CommandResult, ParticipantAction, ParticipantQuestionInput } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { ParticipantState } from "../../../shared/contracts/state";
import { countChars } from "../../../shared/domain/text";
import { questionGroups } from "./questions";

/** Valor de la opción «escribir mi pregunta» (los IDs de las preguntas sugeridas nunca empiezan con «_»). */
const WRITE = "_write";

interface Props {
  config: LaboratorioConfig;
  participant: ParticipantState;
  act: (action: ParticipantAction) => Promise<CommandResult>;
  busy: boolean;
  /** El inventor está abierto y la aventura en curso: se puede registrar o cambiar la pregunta. */
  interactive: boolean;
  /** La pregunta del grupo ya quedó impresa: solo se muestra la propia. */
  finished: boolean;
}

/**
 * El inventor en el celular de cada persona: la pregunta de Vanessa y la lista de preguntas sugeridas por mesa. Cada persona elige una o
 * escribe la suya y la registra; puede cambiarla mientras el inventor siga abierto, y recién entonces puede volver al mapa. Vanessa las
 * ve todas en su pantalla y elige con el grupo la que imprime el inventor.
 */
export function InventorPanel({ config, participant, act, busy, interactive, finished }: Props) {
  const mine = participant.question ?? null;
  const [editing, setEditing] = useState(mine === null);
  const [choice, setChoice] = useState<string>("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = config.ui.maxRecordCharacters;
  const chars = countChars(text.trim());
  const groups = questionGroups(config);
  const canSend = interactive && !busy && !sending && (choice === WRITE ? chars > 0 && chars <= max : choice !== "");

  const startEditing = () => {
    setChoice(mine?.presetId ?? (mine ? WRITE : ""));
    setText(mine && mine.presetId === null ? mine.text : "");
    setError(null);
    setEditing(true);
  };

  const submit = async () => {
    const question: ParticipantQuestionInput = choice === WRITE ? { kind: "written", text } : { kind: "preset", presetId: choice };
    setSending(true);
    setError(null);
    try {
      const r = await act({ type: "inventor.question", question });
      if (r.ok) setEditing(false);
      else setError(r.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="personal" aria-labelledby="inventor-title">
      <header className="personal__head">
        <h2 id="inventor-title">El inventor de preguntas</h2>
        {/* Como en las mesas: se vuelve al mapa recién después de registrar la pregunta (al terminar, siempre). */}
        {mine || finished ? (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void act({ type: "adventure.returnToMap" })}>
            Volver al mapa
          </button>
        ) : null}
      </header>
      <p className="personal__goal">{config.inventor.prompt}</p>

      {mine && (!editing || finished) ? (
        <div className="stack">
          <p className="chip chip--ok" role="status">✓ Tu pregunta quedó registrada</p>
          <blockquote className="final-question">{mine.text}</blockquote>
          {finished ? null : (
            <>
              <p className="hint">Vanessa ve las preguntas de todo el grupo y elegirá con ustedes la que imprime el inventor.</p>
              <button type="button" className="btn" disabled={!interactive || busy} onClick={startEditing}>
                Cambiar mi pregunta
              </button>
            </>
          )}
        </div>
      ) : finished ? (
        <p className="hint">La pregunta del grupo ya quedó impresa en el inventor.</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) void submit();
          }}
        >
          <fieldset className="question-choices">
            <legend>Elige una pregunta o escribe la tuya</legend>
            {groups.map((g) => (
              <div key={g.activityId} className="question-group" role="group" aria-labelledby={`qg-${g.activityId}`}>
                <p id={`qg-${g.activityId}`} className="question-group__title">
                  {g.title}
                </p>
                {g.questions.map((q) => (
                  <label key={q.id} className="question-option">
                    <input type="radio" name="inventor-question" value={q.id} checked={choice === q.id} onChange={() => setChoice(q.id)} />
                    <span>{q.text}</span>
                  </label>
                ))}
              </div>
            ))}
            <div className="question-group" role="group" aria-labelledby="qg-own">
              <p id="qg-own" className="question-group__title">
                Tu propia pregunta
              </p>
              <label className="question-option">
                <input type="radio" name="inventor-question" value={WRITE} checked={choice === WRITE} onChange={() => setChoice(WRITE)} />
                <span>Quiero escribir mi pregunta</span>
              </label>
            </div>
          </fieldset>
          {choice === WRITE ? (
            <div className="field">
              <label htmlFor="inventor-own">Tu pregunta</label>
              <textarea id="inventor-own" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              <span className={`hint${chars > max ? " error" : ""}`}>
                {chars}/{max} caracteres
              </span>
            </div>
          ) : null}
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={!canSend}>
              Registrar mi pregunta
            </button>
            {mine ? (
              <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="hint error" role="alert">
              {error}
            </p>
          ) : null}
          {!interactive ? (
            <p className="hint" role="status">
              La aventura está en pausa.
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
