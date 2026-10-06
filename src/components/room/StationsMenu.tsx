import { useRef } from "react";
import { INVENTOR_ID } from "../../../shared/contracts/config";
import { allRouteCompleted, isCompleted, unlockedActivityIds } from "../../../shared/domain/adventure";
import type { RoomClientState, RoomController } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  controller: RoomController;
  canAct: boolean;
}

type Row = { id: string; title: string; status: "locked" | "available" | "completed" };

/**
 * Lista de mesas accesible (SPECS 2.4, 11.1): llegar y abrir una mesa sin manejar el personaje. Conserva el orden del recorrido y
 * los permisos, pero no exige proximidad. Equivalente de teclado y lectores de pantalla del mapa táctil.
 */
export function StationsMenu({ project, state, controller, canAct }: Props) {
  const menu = useRef<HTMLDetailsElement | null>(null);
  const adv = state.snapshot?.state.adventure;
  if (!adv) return null;
  const { config } = project.bundle;
  const unlocked = new Set(unlockedActivityIds(adv, config));
  const rows: Row[] = config.route.map((id) => ({ id, title: config.activities[id]!.title, status: isCompleted(adv, id) ? "completed" : unlocked.has(id) ? "available" : "locked" }));
  rows.push({ id: INVENTOR_ID, title: "El inventor", status: adv.inventor.finalQuestionId ? "completed" : allRouteCompleted(adv, config) ? "available" : "locked" });
  const onMap = adv.view.kind === "map";
  const STATUS = { locked: "Bloqueada: primero la anterior", available: "Disponible", completed: "Completada" } as const;

  return (
    <details className="stations-menu" ref={menu}>
      <summary>Mesas</summary>
      <ul className="stations-menu__list" aria-label="Mesas del laboratorio">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="btn"
              disabled={!canAct || !onMap || r.status === "locked" || state.pending > 0}
              onClick={() => {
                // El panel flota sobre el mapa: se cierra al elegir para no tapar lo que se va a tocar después.
                menu.current?.removeAttribute("open");
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
    </details>
  );
}
