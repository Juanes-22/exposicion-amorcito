import { useState } from "react";
import type { CommandResult, SavableNoteKind } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState, GroupNote } from "../../../shared/contracts/state";
import { currentActivityId } from "../../../shared/domain/round";
import { NOTE_LABEL, noteText } from "../notebook/notes";
import { NoteForm } from "./NoteForm";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  busy: boolean;
  save: (kind: SavableNoteKind, text: string) => Promise<CommandResult>;
  edit: (noteId: string, expectedRevision: number, text: string) => Promise<CommandResult>;
}

/**
 * Cuaderno del grupo: Vanessa guarda lo que el grupo piensa. La idea inicial de Sombras se conserva aparte de la síntesis de la
 * conversación; ambas se identifican como «Idea del grupo». Las comparaciones entran solas cuando proyecta resultados.
 */
export function GroupNotes({ config, adv, busy, save, edit }: Props) {
  const id = currentActivityId(adv, config);
  const cfg = id ? config.activities[id] : null;
  // Se recuerda la revisión que Vanessa tenía a la vista al empezar a corregir: eso es lo que se envía, para que un cambio que llegue
  // mientras escribe se detecte como conflicto en lugar de pisarse.
  const [editing, setEditing] = useState<{ id: string; openedRevision: number } | null>(null);
  const [conflicted, setConflicted] = useState<string | null>(null);
  const max = config.ui.maxRecordCharacters;
  const savable = adv.notebook.filter((n) => n.kind !== "comparison" && n.kind !== "finalQuestion");
  const comparisons = adv.notebook.filter((n) => n.kind === "comparison");

  return (
    <div className="stack">
      {cfg ? (
        <>
          {cfg.type === "shadows" ? <NoteForm label="Idea inicial del grupo" hint="Se conserva aparte, aunque después cambie." maxChars={max} submitLabel="Guardar la idea inicial" busy={busy} onSubmit={(t) => save("initialIdea", t)} /> : null}
          <NoteForm label="Idea del grupo (síntesis de la conversación)" maxChars={max} submitLabel="Guardar la idea" busy={busy} onSubmit={(t) => save("synthesis", t)} />
          <NoteForm label="Pregunta que el grupo quiere conservar" hint="Podrá elegirse como pregunta final." maxChars={max} submitLabel="Guardar la pregunta" busy={busy} onSubmit={(t) => save("question", t)} />
        </>
      ) : (
        <p className="hint">Ya pasamos por las tres mesas: la pregunta final se escribe o se elige en el cierre.</p>
      )}

      {savable.length > 0 || comparisons.length > 0 ? (
        <ul className="records" aria-label="Notas del grupo">
          {[...savable, ...comparisons].map((n) => (
            <li key={n.id} className="record">
              <div className="record__head">
                <strong>{NOTE_LABEL[n.kind]}</strong>
                <span className="hint">· {n.activityId === currentActivityId(adv, config) ? "mesa de ahora" : (config.activities[n.activityId]?.title ?? n.activityId)}</span>
                {n.revision > 1 ? <span className="chip">corregida</span> : null}
              </div>
              {editing?.id === n.id && n.kind !== "comparison" ? (
                <>
                  {conflicted === n.id ? <p className="error" role="alert">Esta nota cambió mientras la editabas. La versión vigente es: «{n.text}». Tu texto se conserva: revísalo y vuelve a guardarlo.</p> : null}
                  <NoteForm
                    label="Corregir la nota"
                    maxChars={max}
                    initial={n.text ?? ""}
                    keep
                    submitLabel="Guardar la corrección"
                    busy={busy}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (t) => {
                      // Tras un conflicto, la siguiente confirmación ya es sobre la versión vigente que Vanessa acaba de leer.
                      const r = await edit(n.id, conflicted === n.id ? n.revision : editing.openedRevision, t);
                      if (r.ok) setEditing(null);
                      else if (r.code === "REVISION_CONFLICT") setConflicted(n.id);
                      return r;
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="record__text">{noteText(n, config)}</p>
                  {n.history.length > 0 && n.kind !== "comparison" ? (
                    <details className="record__history">
                      <summary>Versiones anteriores ({n.history.length})</summary>
                      <ol>{n.history.map((h) => <li key={h.revision}><span className="hint">Versión {h.revision}:</span> {h.text}</li>)}</ol>
                    </details>
                  ) : null}
                  {n.kind !== "comparison" ? (
                    <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => { setConflicted(null); setEditing({ id: n.id, openedRevision: n.revision }); }}>
                      Corregir
                    </button>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type { GroupNote };
