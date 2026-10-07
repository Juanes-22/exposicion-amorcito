import { useEffect, useMemo } from "react";
import type { ParticipantState } from "../../shared/contracts/state";
import { GameBridge } from "../game/bridge/GameBridge";
import type { BridgePermissions, VisualState, Viewer } from "../game/bridge/events";
import type { RoomClientState, RoomPort } from "./RoomController";

/**
 * Quién mira la escena (SPECS 10.2). Quien tiene personaje ve su estado personal; la proyección de una sala real (Vanessa) ve el
 * laboratorio y, si ella lo pide, su demostración local (`demo`); quien acompaña solo ve el grupo.
 */
function viewerOf(state: RoomClientState, demo: ParticipantState | null): Viewer | null {
  const self = state.summary?.self;
  if (!self) return null;
  if (self.observer) return { kind: "observer" };
  if (state.me) return { kind: "participant", principalId: self.principalId, me: state.me.participant };
  return self.role === "admin" ? { kind: "projection", demo } : null;
}

/**
 * Entrega al puente el último estado visual autorizado, los permisos y las muestras del reloj. La aplicación decide; Phaser solo
 * pinta. El puente retiene el último valor para escenas que arrancan después de que se emitió (SPECS 10.2).
 * Las muestras del reloj llegan por suscripción directa y no por el estado de React: no se renderiza el árbol a cada una (CT-06).
 */
export function useBridgeFeed(state: RoomClientState, port: RoomPort | null, permissions: BridgePermissions, demo: ParticipantState | null = null, clock: Pick<RoomPort, "subscribeClock"> | null = port): GameBridge {
  const bridge = useMemo(() => new GameBridge(), []);
  useEffect(() => () => bridge.dispose(), [bridge]);

  const group = state.group;
  const viewer = viewerOf(state, demo);
  const characters = state.characters;
  const phase = state.summary?.phase;
  useEffect(() => {
    if (!group || !viewer || !phase) return;
    const visual: VisualState = { phase, group: group.adventure, viewer, characters: Object.values(characters) };
    bridge.emit("app:visual", visual);
    // `viewer` se reconstruye en cada render: lo que cuenta es el contenido que cambió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, group, phase, characters, state.me, demo, state.summary?.self.role, state.summary?.self.observer]);

  useEffect(() => {
    bridge.emit("app:permissions", permissions);
  }, [bridge, permissions.canMove, permissions.canExplore, permissions.reason]); // eslint-disable-line react-hooks/exhaustive-deps

  // Durante la demostración local de Vanessa el reloj es el de ESA demostración, no el de la sala.
  useEffect(() => (clock ? clock.subscribeClock((s) => bridge.emit("app:clock", s)) : undefined), [bridge, clock]);

  // Sin conexión no se sigue «adivinando» el tiempo: el reloj se queda donde estaba hasta recibir el estado de la conexión nueva.
  useEffect(() => {
    if (state.status !== "connected") bridge.clock.freeze();
  }, [bridge, state.status]);

  return bridge;
}
