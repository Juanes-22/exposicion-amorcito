import { lazy, Suspense } from "react";
import { useAudioSignals } from "../../app/audio/useAudioSignals";
import type { RoomClientState, RoomController } from "../../app/RoomController";
import { isInventorOpen, phoneCaption } from "../../app/view";
import type { LoadedProject } from "../../config/loadProject";
import { PersonalPanel } from "../activities/PersonalPanel";
import { InventorPanel } from "../inventor/InventorPanel";
import { SignalText, SoundControl } from "./SoundControl";

const AdventureHost = lazy(() => import("./AdventureHost").then((m) => ({ default: m.AdventureHost })));

/**
 * Celular de quien juega: su personaje en el laboratorio compartido y, al abrir la mesa habilitada, los controles de su experimento
 * (propuesta de rondas, sección 3); en el cierre, al entrar al inventor, las preguntas para registrar la suya. El texto de arriba dice qué
 * toca en cada momento y, durante la conversación, manda a mirar la proyección.
 */
export function ParticipantView({ project, state, controller }: { project: LoadedProject; state: RoomClientState; controller: RoomController }) {
  const summary = state.summary!;
  const { config } = project.bundle;
  // El sonido está activado por defecto y empieza con el primer toque (salvo `config.audio.phoneInitiallyMuted`); el texto de cada señal aparece igual.
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
          onDecorationTap={audio.play}
          panel={(bridge) =>
            state.me && state.group && state.me.participant.view.kind === "activity" && (stage === "exploration" || stage === "preparation") ? (
              <PersonalPanel config={config} adv={state.group.adventure} participant={state.me.participant} act={(a) => controller.act(a)} setLocal={(p) => bridge.setLocal(p)} onLocal={(cb) => bridge.on("app:local", cb)} busy={state.pending > 0} interactive={exploring} />
            ) : state.me && state.group && state.me.participant.view.kind === "inventor" && stage === "closing" ? (
              <InventorPanel
                config={config}
                participant={state.me.participant}
                act={(a) => controller.act(a)}
                busy={state.pending > 0}
                interactive={summary.phase === "running" && isInventorOpen(state.group.adventure)}
                finished={summary.phase === "finished"}
              />
            ) : null
          }
        />
      </Suspense>
    </div>
  );
}
