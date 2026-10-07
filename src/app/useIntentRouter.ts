import { useEffect } from "react";
import type { LoadedProject } from "../config/loadProject";
import type { GameBridge } from "../game/bridge/GameBridge";
import { startIntentRouter } from "./mapIntents";
import type { RoomPort } from "./RoomController";

/** Mantiene vivo el enrutador de intenciones del mapa mientras la vista del juego esté montada. */
export function useIntentRouter(bridge: GameBridge, port: RoomPort | null, project: LoadedProject): void {
  useEffect(() => {
    if (!port) return;
    return startIntentRouter({ bridge, port, project });
  }, [bridge, port, project]);
}
