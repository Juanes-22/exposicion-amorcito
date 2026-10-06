import type { RoomClientState, RoomController } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";

/**
 * Panel provisional de la mesa abierta. Las escenas y los formularios de cada mesa son la fase 4 del plan: aquí solo se
 * muestra cuál está abierta y se puede volver al mapa conservando su avance (SPECS 5.2: `adventure.returnToMap`).
 */
export function ActivityPanel({ project, state, controller, canAct }: { project: LoadedProject; state: RoomClientState; controller: RoomController; canAct: boolean }) {
  const adv = state.snapshot?.state.adventure;
  if (!adv || adv.view.kind === "map") return null;
  const { config } = project.bundle;
  const title = adv.view.kind === "activity" ? config.activities[adv.view.activityId]?.title ?? adv.view.activityId : "El inventor";
  return (
    <section className="activity-panel" aria-labelledby="activity-title">
      <h2 id="activity-title">{title}</h2>
      <p>Esta mesa se abre aquí; su experimento llega en la fase 4 del plan.</p>
      {canAct ? (
        <button type="button" className="btn btn--primary" disabled={state.pending > 0} onClick={() => void controller.adventure({ type: "adventure.returnToMap" })}>
          Volver al mapa
        </button>
      ) : (
        <p className="hint">Quien tiene el turno puede volver al mapa.</p>
      )}
    </section>
  );
}
