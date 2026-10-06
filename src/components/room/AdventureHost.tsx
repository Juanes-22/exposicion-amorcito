import { useMemo } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState, RoomController } from "../../app/RoomController";
import { useBridgeFeed } from "../../app/useBridgeFeed";
import { useIntentRouter } from "../../app/useIntentRouter";
import { readGameFlags } from "../../game/flags";
import { PhaserGame } from "../game/PhaserGame";
import { ActivityPanel } from "./ActivityPanel";
import { MapHud } from "./MapHud";
import { NearbyPrompt } from "./NearbyPrompt";
import { StationsMenu } from "./StationsMenu";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  controller: RoomController;
  canAct: boolean;
  reason: string | null;
  label: string;
  /** `fit`: el laboratorio entero (proyección). `follow`: sigue a Vanessa (teléfono del controlador). */
  camera: "fit" | "follow";
  /** Mostrar el cuaderno como menú sobre el mapa (teléfono del controlador). */
  notebookMenu?: boolean;
}

/**
 * Mapa de la aventura. Un solo host de Phaser por vista: no se recrea por turnos, formularios ni registros. Mientras no llegue el
 * primer snapshot se muestra un aviso en lugar de un mapa vacío.
 */
export function AdventureHost({ project, state, controller, canAct, reason, label, camera, notebookMenu = false }: Props) {
  const bridge = useBridgeFeed(state, controller, canAct, reason);
  useIntentRouter(bridge, controller, project);
  const flags = useMemo(() => readGameFlags(), []);
  const inMap = !state.snapshot || state.snapshot.state.adventure.view.kind === "map";
  return (
    <div className={`adventure__map${inMap ? "" : " has-activity"}`}>
      {/* El escenario ocupa siempre el mismo lugar del árbol: abrir o cerrar una mesa NO recrea el canvas de Phaser. */}
      <div className="adventure__stage">
        <PhaserGame project={project} bridge={bridge} debug={flags.debug} hooks={flags.hooks} camera={camera} label={label} />
        {!state.snapshot ? <div className="overlay" role="status"><p>Cargando el estado de la aventura…</p></div> : null}
        {inMap ? <StationsMenu project={project} state={state} controller={controller} canAct={canAct} /> : null}
        {inMap ? <NearbyPrompt project={project} state={state} controller={controller} canAct={canAct} /> : null}
        {inMap ? <MapHud project={project} state={state} controller={controller} canAct={canAct} notebookMenu={notebookMenu} /> : null}
        {state.snapshot?.state.phase === "paused" ? (
          <div className="overlay" role="status">
            <h2>En pausa</h2>
            <p>{state.summary?.controller ? `Cuando se reanude, explora ${state.summary.controller.displayName}.` : "Falta elegir quién tiene el turno."}</p>
          </div>
        ) : null}
        {state.snapshot?.state.phase === "finished" && state.snapshot.state.adventure.view.kind !== "final" ? (
          <div className="banner" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 4 }}>{project.bundle.config.inventor.finalMessage}</div>
        ) : null}
      </div>
      <ActivityPanel project={project} state={state} controller={controller} canAct={canAct} />
    </div>
  );
}
