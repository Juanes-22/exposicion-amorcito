import { lazy, Suspense } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState } from "../../app/RoomController";

const AdventureHost = lazy(() => import("./AdventureHost").then((m) => ({ default: m.AdventureHost })));

/**
 * Jugador activo: la misma escena y estado que la proyección, con «Es tu turno». Los controles se habilitan solo cuando el
 * snapshot ya llegó y la escena cargó (SPECS 2.1, 5.5).
 */
export function ControllerView({ project, state }: { project: LoadedProject; state: RoomClientState }) {
  const summary = state.summary!;
  const canAct = summary.phase === "running" || summary.phase === "finished";
  return (
    <div className="adventure">
      <div className="banner" role="status">Es tu turno, {summary.self.displayName}</div>
      <Suspense fallback={<div className="adventure__map"><p role="status" style={{ padding: 16 }}>Cargando el mapa…</p></div>}>
        <AdventureHost project={project} state={state} canAct={canAct} reason={canAct ? null : "La aventura está en pausa."} label="Mapa del laboratorio" />
      </Suspense>
    </div>
  );
}
