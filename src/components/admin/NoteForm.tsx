import { useState } from "react";
import type { CommandResult } from "../../../shared/contracts/actions";
import { countChars } from "../../../shared/domain/text";

interface Props {
  label: string;
  hint?: string;
  maxChars: number;
  submitLabel: string;
  initial?: string;
  busy: boolean;
  /** Devuelve el resultado; el texto se limpia solo si se aceptó. */
  onSubmit: (text: string) => Promise<CommandResult>;
  onCancel?: () => void;
  /** Conserva lo escrito aunque se acepte (una corrección que ya terminó cierra el formulario por su cuenta). */
  keep?: boolean;
}

/** Cuadro de texto de Vanessa para una nota del grupo: cuenta los caracteres y nunca pierde lo escrito si el servidor lo rechaza. */
export function NoteForm({ label, hint, maxChars, submitLabel, initial = "", busy, onSubmit, onCancel, keep }: Props) {
  const [text, setText] = useState(initial);
  const [sending, setSending] = useState(false);
  const chars = countChars(text.trim());
  const id = `note-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <form
      className="stack note-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setSending(true);
        try {
          const r = await onSubmit(text);
          if (r.ok && !keep) setText("");
        } finally {
          setSending(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <textarea id={id} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <span className={`hint${chars > maxChars ? " error" : ""}`}>
          {chars}/{maxChars} caracteres{hint ? `. ${hint}` : ""}
        </span>
      </div>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy || sending || !text.trim() || chars > maxChars}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
