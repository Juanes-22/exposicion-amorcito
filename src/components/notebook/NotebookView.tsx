import { INVENTOR_ID, type LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState, GroupNote, ParticipantState } from "../../../shared/contracts/state";
import { isShownNote, NOTE_LABEL, noteText, personalLines } from "./notes";

export interface NotebookViewProps {
  config: LaboratorioConfig;
  /** Mis resultados, tal como el juego los registró. `null` para quien acompaña o para la proyección. */
  me: ParticipantState | null;
  adv: AdventureState;
}

/**
 * Cuaderno (propuesta de rondas, sección 8), en dos partes y solo de lectura: «Mis resultados», registrados por el juego a medida que
 * se explora, y «Lo que anotó el grupo», lo que Vanessa guardó (la idea inicial se conserva aparte de la síntesis). Nunca hay formularios
 * ni borradores: nadie escribe aquí.
 */
export function NotebookView({ config, me, adv }: NotebookViewProps) {
  const own = config.route
    .map((id) => ({ id, title: config.activities[id]!.title, lines: personalLines(me?.activities[id], config.activities[id]) }))
    .filter((g) => g.lines.length > 0);
  const byTable = [...config.route, INVENTOR_ID]
    .map((id) => ({ id, title: id === INVENTOR_ID ? "El inventor" : config.activities[id]!.title, rows: adv.notebook.filter((n) => n.activityId === id && isShownNote(n)) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="notebook">
      {me ? (
        <section className="notebook__group" aria-labelledby="nb-mine">
          <h3 id="nb-mine">Mis resultados</h3>
          {own.length === 0 ? (
            <p className="hint">Todavía no hay resultados tuyos. Se anotan solos mientras exploras.</p>
          ) : (
            own.map((g) => (
              <div key={g.id}>
                <h4>{g.title}</h4>
                <ul className="records">
                  {g.lines.map((l, i) => (
                    <li key={i} className="record">
                      <p className="record__text">{l}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      ) : null}
      <section className="notebook__group" aria-labelledby="nb-group">
        <h3 id="nb-group">Lo que anotó el grupo</h3>
        {byTable.length === 0 ? (
          <p className="hint">Todavía no hay notas del grupo. Lo que Vanessa guarde de la conversación aparecerá aquí.</p>
        ) : (
          byTable.map((g) => (
            <div key={g.id}>
              <h4>{g.title}</h4>
              <ul className="records">
                {g.rows.map((n) => (
                  <GroupNoteRow key={n.id} note={n} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/** Una nota del grupo, con su etiqueta; si fue corregida, sus versiones anteriores quedan a la vista. */
export function GroupNoteRow({ note }: { note: GroupNote }) {
  return (
    <li className={`record${note.kind === "initialIdea" ? " record--first" : ""}`}>
      <div className="record__head">
        <strong>{NOTE_LABEL[note.kind]}</strong>
        {note.revision > 1 ? <span className="chip">corregida</span> : null}
      </div>
      <p className="record__text">{noteText(note)}</p>
      {note.history.length > 0 ? (
        <details className="record__history">
          <summary>Versiones anteriores ({note.history.length})</summary>
          <ol>
            {note.history.map((h) => (
              <li key={h.revision}>
                <span className="hint">Versión {h.revision}:</span> {h.text}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}
