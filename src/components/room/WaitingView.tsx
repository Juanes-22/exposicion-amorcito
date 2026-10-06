import { useEffect } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState } from "../../app/RoomController";
import { colorLabel, Silhouette } from "../ui/Silhouette";

const PHASE_TEXT: Record<string, string> = {
  welcome: "La aventura todavía no comienza.",
  running: "La aventura está en curso.",
  paused: "La aventura está en pausa.",
  finished: "La aventura terminó. Todavía puedes seguir la conversación.",
};

/**
 * Espera: silueta propia, nombre y estado de conexión. Nunca monta el canvas del mapa ni recibe el estado de la aventura:
 * la experiencia se sigue en la proyección (SPECS 2.1, CA-04).
 */
export function WaitingView({ project, state }: { project: LoadedProject; state: RoomClientState }) {
  const summary = state.summary!;
  const label = project.bundle.config.ui.labels.waiting ?? "Estás en la sala. Sigue la aventura en la proyección";
  const online = state.status === "connected";

  // Precarga discreta del módulo del mapa mientras se espera: NO crea Phaser ni canvas ni pide datos de la aventura (SPECS 5.5, 11.2).
  // Así, cuando llegue el turno, el mapa aparece sin esperar la descarga del motor.
  useEffect(() => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const t = idle ? idle(() => void import("./AdventureHost")) : window.setTimeout(() => void import("./AdventureHost"), 1500);
    return () => (idle ? undefined : window.clearTimeout(t));
  }, []);

  return (
    <main className="screen screen--center">
      <div className="card stack" style={{ textAlign: "center" }}>
        <div className="row" style={{ justifyContent: "center" }}>
          <Silhouette color={summary.self.color} size={96} title={`Tu silueta, color ${colorLabel(summary.self.color)}`} />
        </div>
        <h1>{summary.self.displayName}</h1>
        <p>{label}</p>
        <p className="muted">{PHASE_TEXT[summary.phase] ?? ""}</p>
        {summary.controller ? (
          <p>
            <span className="chip chip--ok">★ Explora: {summary.controller.displayName}</span>
          </p>
        ) : null}
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
