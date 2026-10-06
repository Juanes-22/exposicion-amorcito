import type { NotebookRecord } from "../../../shared/contracts/state";
import { FIELD_LABEL, recordText } from "./steps";

/**
 * Registros confirmados de una mesa, con su autor. La primera idea de Sombras se distingue siempre: sigue visible aunque después se
 * añada una observación o una explicación revisada (SPECS 3.1, 3.2). Solo muestra lo confirmado: nunca borradores.
 */
export function RecordsList({ records, labels }: { records: NotebookRecord[]; labels: Record<string, string> }) {
  if (records.length === 0) return null;
  return (
    <ul className="records" aria-label="Lo que ya compartió el grupo en esta mesa">
      {records.map((r) => (
        <li key={r.id} className={`record${r.field === "firstIdea" ? " record--first" : ""}`}>
          <div className="record__head">
            <strong>{FIELD_LABEL[r.field]}</strong>
            <span className="hint">· {r.authorName}</span>
            {r.revision > 1 ? <span className="chip">editada</span> : null}
          </div>
          <p className="record__text">{recordText(r, labels)}</p>
        </li>
      ))}
    </ul>
  );
}
