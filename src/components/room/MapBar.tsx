import { useState } from "react";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";
import { NotebookView } from "../notebook/NotebookView";
import { PieceTray } from "../notebook/PieceTray";
import { StationsMenu } from "./StationsMenu";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  controller: RoomPort;
  canAct: boolean;
  /** El teléfono del controlador abre el cuaderno desde aquí; la consola de Vanessa tiene su propio panel. */
  notebookMenu: boolean;
}

type Menu = "stations" | "notebook" | null;

/**
 * Barra superior del mapa: «Mesas», las piezas conseguidas y, para quien tiene el turno, el cuaderno, en UNA fila. Los paneles se abren
 * debajo de la barra y de uno en uno, así que nunca se tapan entre sí ni tapan sus propios botones (en un iPhone SE real, cuando eran
 * piezas sueltas en dos esquinas, el cuaderno cubría los botones de las mesas). Los huecos de la barra no capturan toques: el mapa
 * debajo sigue siendo tocable.
 *
 * Cerrar un menú porque se abrió otro dispara también SU evento de cierre: por eso cada menú solo se «cierra» a sí mismo (si el menú
 * abierto ya es otro, no se toca).
 */
export function MapBar({ project, state, controller, canAct, notebookMenu }: Props) {
  const [open, setOpen] = useState<Menu>(null);
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const adv = snapshot.state.adventure;
  const { config } = project.bundle;
  return (
    <div className="map-bar">
      <StationsMenu project={project} state={state} controller={controller} canAct={canAct} open={open === "stations"} onOpenChange={(o) => setOpen((cur) => (o ? "stations" : cur === "stations" ? null : cur))} />
      <PieceTray pieces={config.inventor.pieces} have={adv.pieces} compact />
      {notebookMenu ? (
        <details className="notebook-menu" open={open === "notebook"} onToggle={(e) => {
            const o = e.currentTarget.open;
            setOpen((cur) => (o ? "notebook" : cur === "notebook" ? null : cur));
          }}>
          <summary>Cuaderno ({adv.notebook.length})</summary>
          <div className="map-panel map-panel--right">
            <NotebookView room={snapshot.state.code} config={config} records={adv.notebook} canEdit={canAct} busy={state.pending > 0} send={(a) => controller.adventure(a)} />
          </div>
        </details>
      ) : (
        <span className="map-bar__spacer" aria-hidden="true" />
      )}
    </div>
  );
}
