import { useEffect, useMemo } from "react";
import { GameBridge } from "../game/bridge/GameBridge";
import type { RoomClientState, RoomController } from "./RoomController";

/**
 * Entrega al puente el último snapshot autorizado, los permisos y las muestras de simulación. La aplicación decide; Phaser solo
 * pinta. El puente retiene el último valor para escenas que arrancan después de que se emitió (SPECS 10.2).
 * Los frames llegan por suscripción directa y no por el estado de React: no se renderiza el árbol por cada posición (CT-06).
 */
export function useBridgeFeed(state: RoomClientState, controller: RoomController | null, canAct: boolean, reason: string | null): GameBridge {
  const bridge = useMemo(() => new GameBridge(), []);
  useEffect(() => () => bridge.dispose(), [bridge]);

  const snap = state.snapshot;
  useEffect(() => {
    if (snap) bridge.emit("app:snapshot", { state: snap.state, controller: snap.controller });
  }, [bridge, snap]);

  useEffect(() => {
    bridge.emit("app:permissions", { canAct, reason });
  }, [bridge, canAct, reason]);

  useEffect(() => (controller ? controller.subscribeFrames((f) => bridge.emit("app:frame", f)) : undefined), [bridge, controller]);

  // Sin conexión no se sigue «adivinando» el tiempo: el reloj se queda donde estaba hasta recibir el estado de la conexión nueva.
  useEffect(() => {
    if (state.status !== "connected") bridge.clock.freeze();
  }, [bridge, state.status]);

  return bridge;
}
