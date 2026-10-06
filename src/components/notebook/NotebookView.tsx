import { useState } from "react";
import type { AdventureAction, CommandResult } from "../../../shared/contracts/actions";
import { INVENTOR_ID, type LaboratorioConfig } from "../../../shared/contracts/config";
import type { NotebookRecord } from "../../../shared/contracts/state";
import { modalitiesFor, suggestionsFor } from "../activities/modalities";
import { RecordForm } from "../activities/RecordForm";
import { FIELD_LABEL, recordText } from "../activities/steps";

export interface NotebookViewProps {
  room: string;
  config: LaboratorioConfig;
  records: NotebookRecord[];
  /** Quien tiene el turno (y la sala está en curso o terminó) puede corregir; los demás solo leen. */
  canEdit: boolean;
  busy: boolean;
  send: (action: AdventureAction) => Promise<CommandResult>;
}

/** Texto de un registro en el cuaderno: la pregunta final oral usa la frase del inventor, no la genérica. */
function textOf(r: NotebookRecord, config: LaboratorioConfig): string {
  if (r.field === "finalQuestion" && r.modality === "oral") return config.inventor.oralQuestionText;
  return recordText(r, config.ui.labels);
}

/**
 * Cuaderno compartido (SPECS 2.1, 3.1): lo ya confirmado, agrupado por mesa, con su autor. La primera idea de Sombras se distingue
 * siempre; una edición añade una versión (el historial queda a la vista) y el autor original no cambia. Nunca muestra borradores.
 */
export function NotebookView({ room, config, records, canEdit, busy, send }: NotebookViewProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const groups = [...config.route, INVENTOR_ID].map((id) => ({ id, title: id === INVENTOR_ID ? "El inventor" : (config.activities[id]?.title ?? id), rows: records.filter((r) => r.activityId === id) }));
  if (records.length === 0) return <p className="hint">Todavía no hay nada en el cuaderno. Las ideas, observaciones y preguntas que el grupo confirme aparecerán aquí.</p>;

  return (
    <div className="notebook">
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <section key={g.id} className="notebook__group" aria-labelledby={`nb-${g.id}`}>
            <h3 id={`nb-${g.id}`}>{g.title}</h3>
            <ul className="records">
              {g.rows.map((r) => (
                <li key={r.id} className={`record${r.field === "firstIdea" ? " record--first" : ""}`}>
                  <div className="record__head">
                    <strong>{FIELD_LABEL[r.field]}</strong>
                    <span className="hint">· {r.authorName}</span>
                    {r.revision > 1 ? <span className="chip">editada{r.lastEditor ? ` por ${r.lastEditor.name}` : ""}</span> : null}
                  </div>
                  {editing === r.id ? (
                    <EditRecord
                      room={room}
                      config={config}
                      record={r}
                      busy={busy}
                      send={send}
                      onClose={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <p className="record__text">{textOf(r, config)}</p>
                      {r.history.length > 0 ? (
                        <details className="record__history">
                          <summary>Versiones anteriores ({r.history.length})</summary>
                          <ol>
                            {r.history.map((h) => (
                              <li key={h.revision}>
                                <span className="hint">Versión {h.revision} · {h.authorName}:</span> {recordText(h, config.ui.labels)}
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                      {canEdit && r.field !== "finalQuestion" ? (
                        <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => setEditing(r.id)}>
                          Corregir
                        </button>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

/**
 * Corrige un registro. Envía la revisión que se estaba viendo (`expectedRevision`): si alguien lo cambió antes, el servidor lo rechaza
 * y aquí se muestra la versión vigente SIN perder lo escrito; la siguiente confirmación ya es sobre esa versión, a propósito.
 */
function EditRecord({ room, config, record, busy, send, onClose }: { room: string; config: LaboratorioConfig; record: NotebookRecord; busy: boolean; send: NotebookViewProps["send"]; onClose: () => void }) {
  const cfg = config.activities[record.activityId];
  const [openedAt] = useState(record.revision);
  const [conflicted, setConflicted] = useState(false);
  if (!cfg) return null;
  return (
    <>
      {conflicted ? (
        <p className="error" role="alert">
          Alguien cambió esta idea mientras la editabas. La versión vigente es: «{recordText(record, config.ui.labels)}». Tu texto se conserva: revísalo y vuelve a compartirlo si todavía quieres cambiarla.
        </p>
      ) : null}
      <RecordForm
        room={room}
        activityId={record.activityId}
        field={record.field}
        draftField={`edit:${record.id}`}
        prompt={`Corregir: ${FIELD_LABEL[record.field]}`}
        modalities={modalitiesFor(cfg.type, record.field)}
        suggestions={suggestionsFor(cfg, record.field)}
        suggestionsLabel={record.field === "firstIdea" ? "Elegir una idea" : "Elegir una pregunta"}
        labels={config.ui.labels}
        maxChars={config.ui.maxRecordCharacters}
        busy={busy}
        initial={{ modality: record.modality, text: record.text, ...(record.optionId ? { optionId: record.optionId } : {}) }}
        submitLabel="Guardar la corrección"
        onCancel={onClose}
        onSubmit={async (value) => {
          const result = await send({ type: "record.edit", recordId: record.id, expectedRevision: conflicted ? record.revision : openedAt, value });
          if (result.ok) onClose();
          else if (result.code === "REVISION_CONFLICT") setConflicted(true);
          return result;
        }}
      />
    </>
  );
}
