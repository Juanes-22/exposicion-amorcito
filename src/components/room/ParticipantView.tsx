import { lazy, Suspense } from "react";
import { useAudioSignals } from "../../app/audio/useAudioSignals";
import type { RoomClientState, RoomController } from "../../app/RoomController";
import { phoneCaption } from "../../app/view";
import type { LoadedProject } from "../../config/loadProject";
import { PersonalPanel } from "../activities/PersonalPanel";
import { SignalText, SoundControl } from "./SoundControl";

const AdventureHost = lazy(() => import("./AdventureHost").then((m) => ({ default: m.AdventureHost })));

/**
 * Celular de quien juega: su personaje en el laboratorio compartido y, al abrir la mesa habilitada, los controles de su experimento
 * (propuesta de rondas, sección 3). El texto de arriba dice qué toca en cada momento y, durante la conversación, manda a mirar la
 * proyección.
 */
export function ParticipantView({ project, state, controller }: { project: LoadedProject; state: RoomClientState; controller: RoomController }) {
  const summary = state.summary!;
  const { config } = project.bundle;
  // El teléfono empieza en silencio (config.audio.phoneInitiallyMuted); el texto de cada señal aparece igual.
  const audio = useAudioSignals({ project, state, device: "phone" });
  const caption = phoneCaption(state, config);
  const stage = state.group?.adventure.round.stage;
  const exploring = stage === "exploration" && summary.phase === "running";
  return (
    <div className="adventure">
      <div className="banner banner--with-sound">
        <span role="status">{summary.self.displayName}</span>
        <SoundControl audio={audio} compact />
      </div>
      <SignalText audio={audio} />
      {caption ? <p className="phone-caption" role="status">{caption}</p> : null}
      <Suspense fallback={<div className="adventure__map"><p role="status" style={{ padding: 16 }}>Cargando el mapa…</p></div>}>
        <AdventureHost
          project={project}
          state={state}
          port={controller}
          camera="follow"
          label="Mapa del laboratorio"
          panel={(bridge) =>
            state.me && state.group && state.me.participant.view.kind === "activity" && (stage === "exploration" || stage === "preparation") ? (
              <PersonalPanel config={config} adv={state.group.adventure} participant={state.me.participant} act={(a) => controller.act(a)} setLocal={(p) => bridge.setLocal(p)} busy={state.pending > 0} interactive={exploring} />
            ) : null
          }
        />
      </Suspense>
    </div>
  );
}
