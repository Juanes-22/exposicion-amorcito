import { useEffect, useMemo } from "react";
import { GameBridge } from "../game/bridge/GameBridge";
import type { RoomClientState } from "./RoomController";

/**
 * Entrega al puente el último snapshot autorizado y los permisos. La aplicación decide; Phaser solo pinta. El puente retiene
 * el último valor para escenas que arrancan después de que se emitió (SPECS 10.2).
 */
export function useBridgeFeed(state: RoomClientState, canAct: boolean, reason: string | null): GameBridge {
  const bridge = useMemo(() => new GameBridge(), []);
  useEffect(() => () => bridge.dispose(), [bridge]);
  const snap = state.snapshot;
  useEffect(() => {
    if (snap) bridge.emit("app:snapshot", { state: snap.state, controller: snap.controller });
  }, [bridge, snap]);
  useEffect(() => {
    bridge.emit("app:permissions", { canAct, reason });
  }, [bridge, canAct, reason]);
  return bridge;
}
