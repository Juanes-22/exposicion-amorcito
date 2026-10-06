import type { RoomClientState, RoomPort } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";
import { NotebookView } from "../notebook/NotebookView";
import { PieceTray } from "../notebook/PieceTray";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  controller: RoomPort;
  canAct: boolean;
  /** El teléfono del controlador abre el cuaderno desde aquí; la consola de Vanessa tiene su propio panel. */
  notebookMenu: boolean;
}

/** Esquina superior derecha del mapa: piezas conseguidas y, para quien tiene el turno, el cuaderno. Solo lee el snapshot. */
export function MapHud({ project, state, controller, canAct, notebookMenu }: Props) {
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const adv = snapshot.state.adventure;
  const { config } = project.bundle;
  return (
    <div className="map-hud">
      <PieceTray pieces={config.inventor.pieces} have={adv.pieces} compact />
      {notebookMenu ? (
        <details className="notebook-menu">
          <summary>Cuaderno ({adv.notebook.length})</summary>
          <div className="notebook-menu__body">
            <NotebookView room={snapshot.state.code} config={config} records={adv.notebook} canEdit={canAct} busy={state.pending > 0} send={(a) => controller.adventure(a)} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
