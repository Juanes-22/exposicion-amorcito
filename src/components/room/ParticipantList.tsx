import type { ParticipantInfo } from "../../../shared/contracts/events";
import { colorLabel, Silhouette } from "../ui/Silhouette";

interface Props {
  participants: ParticipantInfo[];
  /** Si se pasa, cada tarjeta ofrece «Dar turno». */
  onAssign?: (principalId: string) => void;
  busy?: boolean;
  /** Aún no llegó la presencia de esta conexión: no se afirma que «no hay nadie». */
  loading?: boolean;
}

/** Tarjetas simples de quienes están en la sala: silueta, nombre, estado por texto e icono (no solo por color) y turno. */
export function ParticipantList({ participants, onAssign, busy, loading }: Props) {
  if (loading) return <p className="muted" role="status">Cargando a las personas de la sala…</p>;
  if (participants.length === 0) return <p className="muted">Todavía no hay nadie en la sala. Pide que escaneen el código QR.</p>;
  return (
    <ul className="participants" aria-label="Participantes">
      {participants.map((p) => (
        <li key={p.principalId} className={`participant${p.isController ? " is-controller" : ""}${p.connected ? "" : " is-offline"}`}>
          <Silhouette color={p.color} size={48} />
          <div>
            <div className="participant__name">{p.displayName}</div>
            <div className="hint">{colorLabel(p.color)}</div>
          </div>
          <div className="participant__status">
            <span className={`chip ${p.connected ? "chip--ok" : "chip--warn"}`}>{p.connected ? "● Conectada" : "○ Desconectada"}</span>
            {p.isController ? (
              <span className="chip chip--ok">★ Tiene el turno</span>
            ) : onAssign ? (
              <button type="button" className="btn btn--ghost" disabled={!p.connected || busy} onClick={() => onAssign(p.principalId)} aria-label={`Dar el turno a ${p.displayName}`}>
                Dar turno
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
