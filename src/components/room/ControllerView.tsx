import { lazy, Suspense } from "react";
import { useAudioSignals } from "../../app/audio/useAudioSignals";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState, RoomController } from "../../app/RoomController";
import { SignalText, SoundControl } from "./SoundControl";

const AdventureHost = lazy(() => import("./AdventureHost").then((m) => ({ default: m.AdventureHost })));

/**
 * Jugador activo: la misma escena y estado que la proyección, con «Es tu turno». Los controles se habilitan solo cuando el
 * snapshot ya llegó y la escena cargó (SPECS 2.1, 5.5).
 */
export function ControllerView({ project, state, controller }: { project: LoadedProject; state: RoomClientState; controller: RoomController }) {
  const summary = state.summary!;
  const canAct = summary.phase === "running" || summary.phase === "finished";
  // El teléfono empieza en silencio (config.audio.phoneInitiallyMuted); el texto de cada señal aparece igual.
  const audio = useAudioSignals({ project, state, device: "phone" });
  return (
    <div className="adventure">
      <div className="banner banner--with-sound">
        <span role="status">Es tu turno, {summary.self.displayName}</span>
        <SoundControl audio={audio} compact />
      </div>
      <SignalText audio={audio} />
      <Suspense fallback={<div className="adventure__map"><p role="status" style={{ padding: 16 }}>Cargando el mapa…</p></div>}>
        <AdventureHost project={project} state={state} controller={controller} camera="follow" notebookMenu canAct={canAct} reason={canAct ? null : "La aventura está en pausa."} label="Mapa del laboratorio" />
      </Suspense>
    </div>
  );
}
