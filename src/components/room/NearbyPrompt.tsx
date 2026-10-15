import { INVENTOR_ID } from "../../../shared/contracts/config";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import { stationTarget } from "../../app/mapIntents";
import { currentActivity, isInventorOpen } from "../../app/view";
import type { LoadedProject } from "../../config/loadProject";

/**
 * «Abrir [mesa]» cuando el personaje está parado junto a la mesa habilitada (en el cierre, «Abrir el inventor» junto a la máquina). Se
 * deriva del estado personal (posición en reposo), no de cada fotograma: mientras camina no se vuelve a renderizar React por su
 * posición (CT-06).
 */
export function NearbyPrompt({ project, state, port }: { project: LoadedProject; state: RoomClientState; port: Pick<RoomPort, "act"> }) {
  const adv = state.group?.adventure;
  const me = state.me?.participant;
  if (!adv || !me || state.summary?.phase !== "running" || me.view.kind !== "map" || me.character.plan !== null) return null;
  const current = currentActivity(adv, project.bundle.config);
  const open = adv.round.stage === "exploration" && current ? { id: current.id, label: `Abrir ${current.config.title}` } : isInventorOpen(adv) ? { id: INVENTOR_ID, label: "Abrir el inventor" } : null;
  const t = open ? stationTarget(project, open.id) : null;
  if (!open || !t || Math.hypot(me.character.feet.x - t.point.x, me.character.feet.y - t.point.y) > t.radius) return null;
  return (
    <div className="nearby-prompt">
      <button type="button" className="btn btn--primary" disabled={state.pending > 0} onClick={() => void port.act({ type: "station.open", stationId: open.id, origin: "map" })}>
        {open.label}
      </button>
    </div>
  );
}
