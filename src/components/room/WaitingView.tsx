import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState } from "../../app/RoomController";
import { phoneCaption } from "../../app/view";
import { colorLabel, Silhouette } from "../ui/Silhouette";

/**
 * Quien acompaña como observadora: silueta, nombre y el texto de lo que pasa. No tiene personaje, no cuenta en la ronda y nunca monta
 * el canvas del mapa: sigue la proyección (propuesta de rondas, sección 10).
 */
export function WaitingView({ project, state }: { project: LoadedProject; state: RoomClientState }) {
  const summary = state.summary!;
  const { labels } = project.bundle.config.ui;
  const caption = phoneCaption(state, project.bundle.config);
  const online = state.status === "connected";
  return (
    <main className="screen screen--center">
      <div className="card stack" style={{ textAlign: "center" }}>
        <div className="row" style={{ justifyContent: "center" }}>
          <Silhouette color={summary.self.color} size={96} title={`Tu silueta, color ${colorLabel(summary.self.color)}`} />
        </div>
        <h1>{summary.self.displayName}</h1>
        <p>{labels.observerPhone ?? labels.waiting}</p>
        {caption ? <p className="muted" role="status">{caption}</p> : null}
        {!summary.adminConnected ? <p className="chip chip--warn">La persona que presenta no está conectada.</p> : null}
        <p>
          <span className={`chip ${online ? "chip--ok" : "chip--warn"}`} role="status">
            {online ? "● Conectada" : "○ Reconectando…"}
          </span>
        </p>
      </div>
    </main>
  );
}
