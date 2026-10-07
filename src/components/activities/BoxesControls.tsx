import { useState } from "react";
import type { BoxesActivityConfig } from "../../../shared/contracts/config";
import type { BoxesState } from "../../../shared/contracts/state";
import type { PersonalActions } from "./types";

/**
 * La caja de las sorpresas (propuesta de rondas, sección 7): una sola escena con una caja compartida y una caja personal. Se elige un
 * objeto para conocer su descripción; pedir permiso para la caja personal es posible, nunca obligatorio. Quien pide permiso recibe la
 * negativa completa en la escena y la caja sigue cerrada: no existe ninguna acción para abrirla.
 */
export function BoxesControls({ cfg, st, a }: { cfg: BoxesActivityConfig; st: BoxesState; a: PersonalActions }) {
  const [touched, setTouched] = useState(false);
  const dialogues = a.config.dialogues;
  const selected = cfg.sharedObjects.find((o) => o.id === st.selectedObjectId);
  return (
    <div className="experiment">
      <ul className="objects" aria-label="Objetos de la caja compartida">
        {cfg.sharedObjects.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className={`btn object${st.selectedObjectId === o.id ? " is-selected" : ""}`}
              disabled={!a.interactive || a.busy}
              aria-pressed={st.selectedObjectId === o.id}
              onClick={() => void a.act({ type: "boxes.object.inspect", objectId: o.id })}
            >
              {st.inspected.includes(o.id) ? "✓ " : ""}
              {o.label}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <p className="object__desc" role="status">
          {selected.description}
        </p>
      ) : null}

      <div className="personal-box">
        <p className="hint">
          {cfg.personalBox.label}: {cfg.personalBox.ownerLabel.toLowerCase()}. Está cerrada.
        </p>
        {!st.askedPermission ? (
          <button type="button" className="btn" disabled={!a.interactive || a.busy} onClick={() => void a.act({ type: "boxes.permission.ask" })}>
            Pedir permiso para abrir la caja personal
          </button>
        ) : (
          <>
            <blockquote className="refusal" role="status">
              <strong>{cfg.personalBox.ownerLabel.replace(/^Pertenece a /i, "").replace(/^./, (c) => c.toUpperCase())}</strong>: «{dialogues[cfg.refusalDialogueId]}»
            </blockquote>
            <p className="hint">La caja personal sigue cerrada. Puedes seguir investigando con los objetos compartidos.</p>
            <button type="button" className="btn btn--ghost" onClick={() => setTouched(true)}>
              {cfg.personalBox.label} (cerrada)
            </button>
            {touched ? <p role="status">{dialogues[cfg.personalTouchDialogueId]}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
