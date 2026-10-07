import { isCompleted } from "../../../shared/domain/adventure";
import { NotebookView } from "../notebook/NotebookView";
import { PieceTray } from "../notebook/PieceTray";
import { FinalQuestionForm } from "./FinalQuestionForm";
import type { ActivityViewProps } from "./ActivityView";

/**
 * La máquina del inventor y el final (SPECS 3.5). Tres momentos: colocar las piezas, elegir la pregunta y el cierre. Las piezas y la
 * fase final las deriva el servidor; aquí solo se piden las dos acciones del grupo. Quien no tiene el turno (proyección) solo lee.
 */
export function InventorPanel({ room, config, adv, interactive, canReturn, busy, ownerName, send }: ActivityViewProps) {
  const inv = config.inventor;
  const has = (id: string) => adv.pieces.includes(id);
  const allPieces = inv.requiredPieceIds.every(has);
  const final = adv.notebook.find((r) => r.id === adv.inventor.finalQuestionId);
  const done = config.route.filter((id) => isCompleted(adv, id));

  /** «Revisar» una mesa completada: volver al mapa y abrirla (dos comandos; si el segundo falla se queda en el mapa). */
  const revisit = async (activityId: string) => {
    const back = await send({ type: "adventure.returnToMap" });
    if (back.ok) await send({ type: "station.open", stationId: activityId, origin: "quickNav" });
  };

  return (
    <section className="activity inventor" aria-labelledby="activity-title-inventor">
      <header className="activity__head">
        <div>
          <h2 id="activity-title-inventor">El inventor</h2>
          <p className="hint">{final ? "Aventura completa" : adv.inventor.piecesPlaced ? "Paso 2 de 2: elegir la pregunta" : "Paso 1 de 2: colocar las piezas"}</p>
        </div>
        {canReturn ? (
          <div className="activity__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void send({ type: "adventure.returnToMap" })}>
              Volver al mapa
            </button>
          </div>
        ) : null}
      </header>

      <PieceTray pieces={inv.pieces} have={adv.pieces} />

      {!adv.inventor.piecesPlaced ? (
        <div className="activity__body">
          <p className="activity-prompt">{inv.placePrompt}</p>
          {interactive ? (
            <button type="button" className="btn btn--primary" disabled={busy || !allPieces} onClick={() => void send({ type: "inventor.placePieces" })}>
              {inv.placeButtonLabel}
            </button>
          ) : (
            <p className="activity-wait">{ownerName ? `${ownerName} puede colocar las piezas.` : ""}</p>
          )}
          {!allPieces ? <p className="hint">Todavía faltan piezas: hay que completar las tres mesas.</p> : null}
        </div>
      ) : (
        <ul className="piece-messages" aria-label="Qué nos dice cada pieza">
          {inv.pieces.map((p) => (
            <li key={p.id}>
              <strong>{p.label}</strong>: {p.message}
            </li>
          ))}
        </ul>
      )}

      {adv.inventor.piecesPlaced && !final ? (
        <div className="activity__body">
          {interactive ? <FinalQuestionForm room={room} config={config} adv={adv} busy={busy} send={send} /> : <p className="activity-prompt">{inv.prompt}</p>}
        </div>
      ) : null}

      {final ? (
        <div className="final-card">
          <p className="hint">Nuestra pregunta</p>
          <p className="final-card__question">{final.modality === "oral" ? inv.oralQuestionText : (final.text ?? "")}</p>
          <p className="banner banner--piece">{inv.finalMessage}</p>
          <ul className="reflection" aria-label="Para pensar">
            {inv.reflection.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {interactive && done.length > 0 ? (
            <div className="final-card__revisit">
              <p className="hint">Se puede volver a mirar lo que hicimos; no se conceden piezas otra vez.</p>
              <div className="row">
                {done.map((id) => (
                  <button key={id} type="button" className="btn" disabled={busy} onClick={() => void revisit(id)}>
                    Revisar: {config.activities[id]!.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="panel" open={!!final}>
        <summary>Cuaderno ({adv.notebook.length})</summary>
        <NotebookView room={room} config={config} records={adv.notebook} canEdit={interactive} busy={busy} send={send} />
      </details>
      {!interactive && ownerName && !final ? <p className="hint">Explora {ownerName}. Esta pantalla solo muestra lo que el grupo comparte.</p> : null}
    </section>
  );
}

