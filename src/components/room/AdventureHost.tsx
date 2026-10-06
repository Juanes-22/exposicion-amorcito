import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState } from "../../app/RoomController";
import { useBridgeFeed } from "../../app/useBridgeFeed";
import { PhaserGame } from "../game/PhaserGame";

/**
 * Mapa de la aventura. Un solo host de Phaser por vista: no se recrea por turnos ni por registros. Mientras no llegue el primer
 * snapshot se muestra un aviso en lugar de un mapa vacío.
 */
export function AdventureHost({ project, state, canAct, reason, label }: { project: LoadedProject; state: RoomClientState; canAct: boolean; reason: string | null; label: string }) {
  const bridge = useBridgeFeed(state, canAct, reason);
  return (
    <div className="adventure__map">
      <PhaserGame project={project} bridge={bridge} label={label} />
      {!state.snapshot ? <div className="overlay" role="status"><p>Cargando el estado de la aventura…</p></div> : null}
      {state.snapshot?.state.phase === "paused" ? (
        <div className="overlay" role="status">
          <h2>En pausa</h2>
          <p>{state.summary?.controller ? `Cuando se reanude, explora ${state.summary.controller.displayName}.` : "Falta elegir quién tiene el turno."}</p>
        </div>
      ) : null}
      {state.snapshot?.state.phase === "finished" ? (
        <div className="banner" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 4 }}>{project.bundle.config.inventor.finalMessage}</div>
      ) : null}
    </div>
  );
}
