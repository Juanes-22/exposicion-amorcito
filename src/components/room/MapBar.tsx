import { useState } from "react";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";
import { NotebookView } from "../notebook/NotebookView";
import { PieceTray } from "../notebook/PieceTray";
import { TablesMenu } from "./TablesMenu";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  port: Pick<RoomPort, "act">;
}

type Menu = "tables" | "notebook" | null;

/**
 * Barra superior del mapa: «Mesas», las piezas del inventor y el cuaderno, en UNA fila. Los paneles se abren debajo de la barra y de uno
 * en uno, así que nunca se tapan entre sí ni tapan sus propios botones (en un iPhone SE real, cuando eran piezas sueltas en dos
 * esquinas, el cuaderno cubría los botones de las mesas). Los huecos de la barra no capturan toques: el mapa debajo sigue siendo tocable.
 *
 * Cerrar un menú porque se abrió otro dispara también SU evento de cierre: por eso cada menú solo se «cierra» a sí mismo (si el menú
 * abierto ya es otro, no se toca).
 */
export function MapBar({ project, state, port }: Props) {
  const [open, setOpen] = useState<Menu>(null);
  const adv = state.group?.adventure;
  if (!adv) return null;
  const { config } = project.bundle;
  return (
    <div className="map-bar">
      <TablesMenu project={project} state={state} port={port} open={open === "tables"} onOpenChange={(o) => setOpen((cur) => (o ? "tables" : cur === "tables" ? null : cur))} />
      <PieceTray pieces={config.inventor.pieces} have={adv.pieces} compact />
      <details
        className="notebook-menu"
        open={open === "notebook"}
        onToggle={(e) => {
          const o = e.currentTarget.open;
          setOpen((cur) => (o ? "notebook" : cur === "notebook" ? null : cur));
        }}
      >
        <summary>Cuaderno</summary>
        <div className="map-panel map-panel--right">
          <NotebookView config={config} me={state.me?.participant ?? null} adv={adv} />
        </div>
      </details>
    </div>
  );
}
