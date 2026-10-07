import { INVENTOR_ID } from "../../../shared/contracts/config";
import { allRouteCompleted, isCompleted, unlockedActivityIds } from "../../../shared/domain/adventure";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  controller: RoomPort;
  canAct: boolean;
  /** Lo gobierna `MapBar`: solo un menú del mapa abierto a la vez, para que ninguno tape a otro. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Row = { id: string; title: string; status: "locked" | "available" | "completed" };

/**
 * Lista de mesas accesible (SPECS 2.4, 11.1): llegar y abrir una mesa sin manejar el personaje. Conserva el orden del recorrido y
 * los permisos, pero no exige proximidad. Equivalente de teclado y lectores de pantalla del mapa táctil.
 */
export function StationsMenu({ project, state, controller, canAct, open, onOpenChange }: Props) {
  const adv = state.snapshot?.state.adventure;
  if (!adv) return null;
  const { config } = project.bundle;
  const unlocked = new Set(unlockedActivityIds(adv, config));
  const rows: Row[] = config.route.map((id) => ({ id, title: config.activities[id]!.title, status: isCompleted(adv, id) ? "completed" : unlocked.has(id) ? "available" : "locked" }));
  rows.push({ id: INVENTOR_ID, title: "El inventor", status: adv.inventor.finalQuestionId ? "completed" : allRouteCompleted(adv, config) ? "available" : "locked" });
  const onMap = adv.view.kind === "map";
  const STATUS = { locked: "Bloqueada: primero la anterior", available: "Disponible", completed: "Completada" } as const;

  return (
    <details className="stations-menu" open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)}>
      <summary>Mesas</summary>
      <div className="map-panel map-panel--left">
      <ul className="stations-menu__list" aria-label="Mesas del laboratorio">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="btn"
              disabled={!canAct || !onMap || r.status === "locked" || state.pending > 0}
              onClick={() => {
                // El panel flota sobre el mapa: se cierra al elegir para no tapar lo que se va a tocar después.
                onOpenChange(false);
                void controller.adventure({ type: "station.open", stationId: r.id, origin: "quickNav" });
              }}
              aria-describedby={`station-status-${r.id}`}
            >
              {r.status === "completed" ? "✓ " : ""}
              {r.title}
            </button>
            <span id={`station-status-${r.id}`} className="hint">{STATUS[r.status]}</span>
          </li>
        ))}
      </ul>
      {!canAct ? <p className="hint">Para abrir una mesa hace falta tener el turno.</p> : !onMap ? <p className="hint">Vuelve al mapa para abrir otra mesa.</p> : null}
      </div>
    </details>
  );
}
