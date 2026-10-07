import { useState } from "react";
import type { CommandResult, FinalQuestionInput } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { NoteForm } from "./NoteForm";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  busy: boolean;
  confirm: (value: FinalQuestionInput) => Promise<CommandResult>;
  correct: (expectedRevision: number, text: string) => Promise<CommandResult>;
}

/**
 * Pregunta final (propuesta de rondas, sección 8): Vanessa la escribe o elige una pregunta que el grupo guardó. Antes de imprimirla en
 * el inventor se le muestra para que la confirme; después se puede corregir un error de escritura (se conserva la versión anterior).
 */
export function FinalQuestion({ config, adv, busy, confirm, correct }: Props) {
  const max = config.ui.maxRecordCharacters;
  const saved = adv.notebook.filter((n) => n.kind === "question" && n.text);
  const final = adv.notebook.find((n) => n.id === adv.inventor.finalQuestionId) ?? null;
  const [choice, setChoice] = useState<"written" | "saved">(saved.length > 0 ? "saved" : "written");
  const [noteId, setNoteId] = useState<string>(saved[0]?.id ?? "");
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

  return (
    <div className="stack">
      <p>{config.inventor.prompt}</p>
      <div className="row" role="radiogroup" aria-label="Cómo elegir la pregunta final">
        <label className="check"><input type="radio" name="final-kind" checked={choice === "saved"} disabled={saved.length === 0} onChange={() => setChoice("saved")} /> <span>Elegir una pregunta guardada</span></label>
        <label className="check"><input type="radio" name="final-kind" checked={choice === "written"} onChange={() => setChoice("written")} /> <span>Escribir una pregunta</span></label>
      </div>
      {choice === "saved" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="final-saved">Preguntas guardadas por el grupo</label>
            <select id="final-saved" className="input" value={noteId} onChange={(e) => setNoteId(e.target.value)}>
              {saved.map((n) => (
                <option key={n.id} value={n.id}>{n.text}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn--primary" disabled={busy || !noteId} onClick={() => setPending({ value: { kind: "saved", noteId }, text: saved.find((n) => n.id === noteId)?.text ?? "" })}>
            Revisar y confirmar
          </button>
        </div>
      ) : (
        <NoteForm label="Pregunta final del grupo" maxChars={max} submitLabel="Revisar y confirmar" busy={busy} keep onSubmit={async (t) => { setPending({ value: { kind: "written", text: t }, text: t.trim() }); return { ok: false, requestId: "", code: "INVALID_STEP", message: "" }; }} />
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
