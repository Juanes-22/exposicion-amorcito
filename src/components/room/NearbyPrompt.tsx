import { INVENTOR_ID } from "../../../shared/contracts/config";
import { allRouteCompleted, unlockedActivityIds } from "../../../shared/domain/adventure";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import { stationTarget } from "../../app/mapIntents";
import type { LoadedProject } from "../../config/loadProject";

/**
 * «Abrir [mesa]» cuando Vanessa está parada junto a una mesa disponible. Se deriva del snapshot (posición en reposo), no de cada
 * fotograma: mientras camina no se vuelve a renderizar React por su posición (CT-06).
 */
export function NearbyPrompt({ project, state, controller, canAct }: { project: LoadedProject; state: RoomClientState; controller: RoomPort; canAct: boolean }) {
  const adv = state.snapshot?.state.adventure;
  if (!adv || !canAct || adv.view.kind !== "map" || adv.player.plan !== null) return null;
  const { config } = project.bundle;
  const unlocked = unlockedActivityIds(adv, config);
  const ids = [...config.route.filter((id) => unlocked.includes(id)), ...(allRouteCompleted(adv, config) ? [INVENTOR_ID] : [])];
  const near = ids.find((id) => {
    const t = stationTarget(project, id);
    return t !== null && Math.hypot(adv.player.feet.x - t.point.x, adv.player.feet.y - t.point.y) <= t.radius;
  });
  if (!near) return null;
  const title = near === INVENTOR_ID ? "al inventor" : config.activities[near]!.title;
  return (
    <div className="nearby-prompt">
      <button type="button" className="btn btn--primary" disabled={state.pending > 0} onClick={() => void controller.adventure({ type: "station.open", stationId: near, origin: "map" })}>
        {near === INVENTOR_ID ? "Abrir al inventor" : `Abrir ${title}`}
      </button>
    </div>
  );
}
