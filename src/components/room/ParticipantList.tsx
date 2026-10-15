import type { ParticipantInfo } from "../../../shared/contracts/events";
import type { RoundStage } from "../../../shared/contracts/state";
import { colorLabel, Silhouette } from "../ui/Silhouette";

interface Props {
  participants: ParticipantInfo[];
  /** Aún no llegó la presencia de esta conexión: no se afirma que «no hay nadie». */
  loading?: boolean;
  busy?: boolean;
  stage?: RoundStage;
  /** Durante la exploración: sumar a la ronda a quien llegó después de abrirla. */
  onInclude?: (principalId: string) => void;
  /** Con el inventor abierto: se muestra quién ya registró su pregunta. */
  questions?: boolean;
}

/**
 * Personas de la sala para Vanessa: silueta, nombre, conexión y, mientras se explora, cuánto lleva cada una y si ya quedó lista; con el
 * inventor abierto, si ya registró su pregunta. El estado se dice con texto e icono (no solo con color). Quien acompaña como observadora se
 * distingue y no cuenta en la ronda.
 */
export function ParticipantList({ participants, loading, busy, stage, onInclude, questions }: Props) {
  if (loading) return <p className="muted" role="status">Cargando a las personas de la sala…</p>;
  if (participants.length === 0) return <p className="muted">Todavía no hay nadie en la sala. Pide que escaneen el código QR.</p>;
  const exploring = stage === "exploration";
  return (
    <ul className="participants" aria-label="Participantes">
      {participants.map((p) => (
        <li key={p.principalId} className={`participant${p.connected ? "" : " is-offline"}`}>
          <Silhouette color={p.color} size={40} />
          <div>
            <div className="participant__name">{p.displayName}</div>
            <div className="hint">{colorLabel(p.color)}</div>
          </div>
          <div className="participant__status">
            <span className={`chip ${p.connected ? "chip--ok" : "chip--warn"}`}>{p.connected ? "● Conectado" : "○ Desconectado"}</span>
            {p.observer ? (
              <span className="chip">Observa</span>
            ) : p.inRound && p.progress ? (
              <span className={`chip ${p.ready ? "chip--ok" : ""}`}>{p.ready ? "✓ Listo" : `${p.progress.done} de ${p.progress.needed}`}</span>
            ) : questions ? (
              <span className={`chip ${p.question ? "chip--ok" : ""}`}>{p.question ? "✓ Registró su pregunta" : "Sin pregunta aún"}</span>
            ) : exploring && p.connected ? (
              <>
                <span className="chip">Acompaña</span>
                {onInclude ? (
                  <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => onInclude(p.principalId)} aria-label={`Incluir en la ronda a ${p.displayName}`}>
                    Incluir en la ronda
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
