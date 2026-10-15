import { useState, type ReactNode } from "react";
import type { CommandResult, FinalQuestionInput } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { ParticipantInfo } from "../../../shared/contracts/events";
import type { AdventureState } from "../../../shared/contracts/state";
import { questionGroups, questionKey } from "../inventor/questions";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { NoteForm } from "./NoteForm";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  /** Personas de la sala (presencia): de aquí salen las preguntas que registró cada una en el inventor. */
  participants: ParticipantInfo[];
  busy: boolean;
  confirm: (value: FinalQuestionInput) => Promise<CommandResult>;
  correct: (expectedRevision: number, text: string) => Promise<CommandResult>;
}

/** Valor de la opción «escribir otra pregunta» (las demás claves llevan prefijo: `person:`, `preset:`, `saved:`). */
const WRITE = "write";

interface Choice {
  key: string;
  text: string;
  value: FinalQuestionInput;
  /** Quiénes la registraron. */
  who: string[];
}

/**
 * Preguntas del inventor (propuesta de rondas, sección 8): Vanessa ve las que registró cada persona (escritas por ella o elegidas entre
 * las sugeridas por las mesas) y elige con el grupo la pregunta final; también puede tomar una pregunta guardada en el cuaderno o
 * escribir otra. Antes de imprimirla en el inventor se le muestra para que la confirme; después se puede corregir un error de escritura
 * (se conserva la versión anterior).
 */
export function FinalQuestion({ config, adv, participants, busy, confirm, correct }: Props) {
  const max = config.ui.maxRecordCharacters;
  const final = adv.notebook.find((n) => n.id === adv.inventor.finalQuestionId) ?? null;
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState<{ value: FinalQuestionInput; text: string } | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [sending, setSending] = useState(false);

  if (final) {
    return (
      <div className="stack">
        <p className="projection__kicker">Pregunta final del grupo</p>
        <blockquote className="final-question">{final.text}</blockquote>
        {final.revision > 1 ? <p className="hint">Se corrigió {final.revision - 1} {final.revision === 2 ? "vez" : "veces"}.</p> : null}
        {correcting ? (
          <NoteForm label="Corregir la pregunta final" hint="Solo para arreglar un error de escritura." maxChars={max} initial={final.text ?? ""} keep submitLabel="Guardar la corrección" busy={busy} onCancel={() => setCorrecting(false)} onSubmit={async (t) => { const r = await correct(final.revision, t); if (r.ok) setCorrecting(false); return r; }} />
        ) : (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setCorrecting(true)}>Corregir un error de escritura</button>
        )}
      </div>
    );
  }

  const players = participants.filter((p) => !p.observer);
  const registered = players.filter((p) => p.question !== null);
  // Las preguntas escritas iguales se reúnen en una sola opción, con todas las personas que la escribieron.
  const written = new Map<string, Choice>();
  for (const p of registered) {
    const q = p.question!;
    if (q.presetId !== null) continue;
    const key = `person:${questionKey(q.text)}`;
    const entry = written.get(key) ?? { key, text: q.text, value: { kind: "written", text: q.text }, who: [] };
    entry.who.push(p.displayName);
    written.set(key, entry);
  }
  const groups = questionGroups(config).map((g) => ({
    ...g,
    choices: g.questions.map((q): Choice => ({ key: `preset:${q.id}`, text: q.text, value: { kind: "written", text: q.text }, who: registered.filter((p) => p.question!.presetId === q.id).map((p) => p.displayName) })),
  }));
  const saved = adv.notebook.filter((n) => n.kind === "question" && n.text).map((n): Choice => ({ key: `saved:${n.id}`, text: n.text!, value: { kind: "saved", noteId: n.id }, who: [] }));
  const all = [...written.values(), ...groups.flatMap((g) => g.choices), ...saved];
  const selected = all.find((c) => c.key === choice) ?? null;

  const option = (c: Choice, whoLabel: (names: string[]) => string) => (
    <label key={c.key} className="question-option">
      <input type="radio" name="final-question" value={c.key} checked={choice === c.key} onChange={() => setChoice(c.key)} />
      <span>
        <span className="question-option__text">{c.text}</span>
        {c.who.length > 0 ? <span className="question-option__who">{whoLabel(c.who)}</span> : null}
      </span>
    </label>
  );
  const group = (id: string, title: string, children: ReactNode) => (
    <div className="question-group" role="group" aria-labelledby={`final-${id}`}>
      <p id={`final-${id}`} className="question-group__title">{title}</p>
      {children}
    </div>
  );

  return (
    <div className="stack">
      <p>{config.inventor.prompt}</p>
      <p className="hint" role="status">
        {players.length === 0 ? "Todavía no hay personas en la sala." : `${registered.length} de ${players.length} ${players.length === 1 ? "persona registró" : "personas registraron"} su pregunta.`}
      </p>
      <fieldset className="question-choices">
        <legend>Elige la pregunta del grupo</legend>
        {group(
          "personas",
          "Escritas por las personas",
          written.size > 0 ? [...written.values()].map((c) => option(c, (names) => names.join(", "))) : <p className="hint">Todavía nadie escribió su propia pregunta.</p>,
        )}
        {groups.map((g) => group(g.activityId, `Sugeridas en ${g.title}`, g.choices.map((c) => option(c, (names) => `Elegida por ${names.length}: ${names.join(", ")}`))))}
        {saved.length > 0 ? group("cuaderno", "Guardadas en el cuaderno del grupo", saved.map((c) => option(c, () => ""))) : null}
        {group(
          "otra",
          "Otra pregunta",
          <label className="question-option">
            <input type="radio" name="final-question" value={WRITE} checked={choice === WRITE} onChange={() => setChoice(WRITE)} />
            <span>Escribir otra pregunta</span>
          </label>,
        )}
      </fieldset>
      {choice === WRITE ? (
        <NoteForm label="Pregunta final del grupo" maxChars={max} submitLabel="Revisar y confirmar" busy={busy} keep onSubmit={async (t) => { setPending({ value: { kind: "written", text: t }, text: t.trim() }); return { ok: false, requestId: "", code: "INVALID_STEP", message: "" }; }} />
      ) : (
        <button type="button" className="btn btn--primary" disabled={busy || !selected} onClick={() => selected && setPending({ value: selected.value, text: selected.text })}>
          Revisar y confirmar
        </button>
      )}
      {pending ? (
        <ConfirmDialog
          title="¿Esta es la pregunta final?"
          confirmLabel="Sí, imprimirla en el inventor"
          busy={sending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setSending(true);
            void confirm(pending.value).then((r) => {
              setSending(false);
              if (r.ok) setPending(null);
            });
          }}
        >
          <blockquote className="final-question">{pending.text}</blockquote>
          <p>Quedará impresa en el inventor y la aventura terminará. Después solo se podrán corregir errores de escritura.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
