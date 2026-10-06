import type { RoomClientState, RoomPort } from "../../app/RoomController";
import type { LoadedProject } from "../../config/loadProject";
import { ActivityView, type ActivityViewProps } from "../activities/ActivityView";
import { InventorPanel } from "../activities/InventorPanel";

/**
 * Celda de la mesa abierta junto al escenario. Adapta el estado de la sala a `ActivityView`: solo quien tiene el turno (y con la
 * sala en curso o terminada) puede actuar; la proyección y los demás ven lo mismo en modo lectura. La vista `final` es la máquina del
 * inventor (fase 5).
 */
export function ActivityPanel({ project, state, controller, canAct }: { project: LoadedProject; state: RoomClientState; controller: RoomPort; canAct: boolean }) {
  const snapshot = state.snapshot;
  const adv = snapshot?.state.adventure;
  if (!snapshot || !adv || adv.view.kind === "map") return null;
  const props: ActivityViewProps = {
    room: snapshot.state.code,
    config: project.bundle.config,
    adv,
    // `canAct` ya implica sala en curso o terminada: en `finished` se pueden revisitar y explorar las mesas completadas (SPECS 3.5);
    // el servidor decide qué acciones siguen siendo válidas.
    interactive: canAct,
    canReturn: canAct,
    busy: state.pending > 0,
    ownerName: state.summary?.controller?.displayName ?? null,
    send: (action) => controller.adventure(action),
  };
  return <aside className="adventure__activity">{adv.view.kind === "final" ? <InventorPanel {...props} /> : <ActivityView {...props} />}</aside>;
}
