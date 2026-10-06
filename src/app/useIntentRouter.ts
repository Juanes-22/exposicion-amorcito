import { useEffect } from "react";
import type { LoadedProject } from "../config/loadProject";
import type { GameBridge } from "../game/bridge/GameBridge";
import { startIntentRouter } from "./mapIntents";
import type { RoomController } from "./RoomController";

/** Mantiene vivo el enrutador de intenciones del mapa mientras la vista del juego esté montada. */
export function useIntentRouter(bridge: GameBridge, controller: RoomController | null, project: LoadedProject): void {
  useEffect(() => {
    if (!controller) return;
    return startIntentRouter({ bridge, controller, project });
  }, [bridge, controller, project]);
}
