import { INVENTOR_ID } from "../../../shared/contracts/config";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import { currentActivity, isInventorOpen } from "../../app/view";
import type { LoadedProject } from "../../config/loadProject";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  port: Pick<RoomPort, "act">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * «Mesas»: el recorrido de hoy y a dónde llevar al personaje. Hay una sola mesa habilitada a la vez; las demás se ven como hechas o por
 * venir, y al final, el inventor. «Ir a la mesa actual» («Ir al inventor» en el cierre) es el equivalente accesible de caminar hasta ella
 * (SPECS 2.4, 11.1).
 */
export function TablesMenu({ project, state, port, open, onOpenChange }: Props) {
  const adv = state.group?.adventure;
  const me = state.me?.participant;
  if (!adv || !me) return null;
  const { config } = project.bundle;
  const current = currentActivity(adv, config);
  const exploring = adv.round.stage === "exploration" && state.summary?.phase === "running";
  const STATUS = { done: "Terminada", now: "Mesa de ahora", later: "Más adelante" } as const;
  const status = (id: string) => (adv.completed.includes(id) ? "done" : current?.id === id ? "now" : "later");
  const inActivity = me.view.kind !== "map";
  const closing = adv.round.stage === "closing";
  const inventorOpen = isInventorOpen(adv);
  // Terminada la aventura se puede volver a entrar al inventor a mirar la pregunta impresa.
  const playing = state.summary?.phase === "running" || state.summary?.phase === "finished";

  return (
    <details className="stations-menu" open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)}>
      <summary>Mesas</summary>
      <div className="map-panel map-panel--left">
        <ol className="stations-menu__list" aria-label="Mesas del laboratorio">
          {config.route.map((id) => (
            <li key={id}>
              <strong>{status(id) === "done" ? "✓ " : ""}{config.activities[id]!.title}</strong>
              <span className="hint"> · {STATUS[status(id)]}</span>
            </li>
          ))}
          <li>
            <strong>El inventor de preguntas</strong>
            <span className="hint"> · {inventorOpen ? "Abierto" : closing ? "Ahora" : "Al final"}</span>
          </li>
        </ol>
        {current ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!exploring || inActivity || state.pending > 0}
            onClick={() => {
              // El panel flota sobre el mapa: se cierra al elegir para no tapar lo que se va a tocar después.
              onOpenChange(false);
              void port.act({ type: "station.open", stationId: current.id, origin: "quickNav" });
            }}
          >
            Ir a la mesa actual
          </button>
        ) : null}
        {closing ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!inventorOpen || !playing || inActivity || state.pending > 0}
            onClick={() => {
              onOpenChange(false);
              void port.act({ type: "station.open", stationId: INVENTOR_ID, origin: "quickNav" });
            }}
          >
            Ir al inventor
          </button>
        ) : null}
        {closing ? (
          !inventorOpen ? <p className="hint">Camina hasta el inventor: Vanessa lo abrirá en un momento.</p> : inActivity ? <p className="hint">Ya estás en el inventor.</p> : null
        ) : !exploring ? (
          <p className="hint">La mesa se abre cuando Vanessa lo indique.</p>
        ) : inActivity ? (
          <p className="hint">Ya estás en la mesa.</p>
        ) : null}
      </div>
    </details>
  );
}
