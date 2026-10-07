import { useMemo, type ReactNode } from "react";
import type { ParticipantState } from "../../../shared/contracts/state";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import { useBridgeFeed } from "../../app/useBridgeFeed";
import { useIntentRouter } from "../../app/useIntentRouter";
import { permissionsFor } from "../../app/view";
import type { LoadedProject } from "../../config/loadProject";
import type { GameBridge } from "../../game/bridge/GameBridge";
import { readGameFlags } from "../../game/flags";
import { PhaserGame } from "../game/PhaserGame";
import { MapBar } from "./MapBar";
import { NearbyPrompt } from "./NearbyPrompt";

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  port: RoomPort;
  /** `fit`: el laboratorio entero (proyección). `follow`: sigue al personaje (celular). */
  camera: "fit" | "follow";
  label: string;
  /** Demostración local de Vanessa sobre la proyección de una sala real: nunca toca el estado de las personas. */
  demo?: ParticipantState | null;
  /** Fuente del reloj; por defecto, la sala. Durante la demostración local es la de esa demostración. */
  clock?: Pick<RoomPort, "subscribeClock"> | null;
  /** Lo que se dibuja sobre el escenario (proyección de la conversación, contadores…). */
  overlay?: (bridge: GameBridge) => ReactNode;
  /** Controles de la mesa abierta, junto al escenario. Devuelve `null` si no hay ninguna abierta. */
  panel?: (bridge: GameBridge) => ReactNode;
}

/**
 * Escenario de la aventura. Un solo host de Phaser por vista: no se recrea por rondas, resultados ni pantallas. Quien tiene personaje
 * (una persona que juega, o Vanessa en la demostración) ve además la barra del mapa; los controles de la mesa abierta los pone
 * quien llama, porque necesitan el puente para mostrar la linterna o la inclinación sin esperar al servidor.
 */
export function AdventureHost({ project, state, port, camera, label, demo = null, clock, overlay, panel }: Props) {
  const permissions = permissionsFor(state);
  const bridge = useBridgeFeed(state, port, permissions, demo, clock === undefined ? port : clock);
  useIntentRouter(bridge, port, project);
  const flags = useMemo(() => readGameFlags(), []);
  const panelNode = panel?.(bridge) ?? null;
  const playing = state.me !== null;
  const inMap = !state.me || state.me.participant.view.kind === "map";
  return (
    <div className={`adventure__map${panelNode ? " has-activity" : ""}`}>
      {/* El escenario ocupa siempre el mismo lugar del árbol: abrir o cerrar una mesa NO recrea el canvas de Phaser. */}
      <div className="adventure__stage">
        <PhaserGame project={project} bridge={bridge} debug={flags.debug} hooks={flags.hooks} camera={camera} label={label} />
        {!state.group ? <div className="overlay" role="status"><p>Cargando el estado de la aventura…</p></div> : null}
        {playing && inMap ? <NearbyPrompt project={project} state={state} port={port} /> : null}
        {playing && inMap ? <MapBar project={project} state={state} port={port} /> : null}
        {state.summary?.phase === "paused" ? (
          <div className="overlay" role="status">
            <h2>En pausa</h2>
            <p>Cuando Vanessa reanude, seguimos.</p>
          </div>
        ) : null}
        {overlay?.(bridge)}
      </div>
      {panelNode ? <aside className="adventure__activity">{panelNode}</aside> : null}
    </div>
  );
}
