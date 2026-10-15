import { lazy, Suspense, useState } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomClientState, RoomPort } from "../../app/RoomController";
import { useAudioSignals } from "../../app/audio/useAudioSignals";
import { useHouseDemo } from "../../app/useHouseDemo";
import { useVanessaTable } from "../../app/useVanessaTable";
import { roomPath } from "../../app/useRoute";
import { currentActivity } from "../../app/view";
import { GroupNotes } from "../admin/GroupNotes";
import { FinalQuestion } from "../admin/FinalQuestion";
import { hasProjection, ProjectionBadge, ProjectionPanel } from "../admin/ProjectionPanel";
import { RoundControls } from "../admin/RoundControls";
import { VanessaTablePanel } from "../admin/VanessaTablePanel";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { QrCode } from "../ui/QrCode";
import { ParticipantList } from "./ParticipantList";
import { SignalText, SoundControl } from "./SoundControl";

// El módulo del mapa (con Phaser) se carga bajo demanda: quien solo espera nunca lo descarga ni crea un canvas.
const AdventureHost = lazy(() => import("./AdventureHost").then((m) => ({ default: m.AdventureHost })));

const PHASE_LABEL: Record<string, string> = { welcome: "Bienvenida", running: "En curso", paused: "En pausa", finished: "Terminó la aventura" };
const STAGE_LABEL = { preparation: "Preparación", exploration: "Exploración", conversation: "Conversación", closing: "Cierre" } as const;

type Confirm = "reset" | "close" | null;

interface Props {
  project: LoadedProject;
  state: RoomClientState;
  controller: RoomPort;
}

/**
 * Aventura de Vanessa (propuesta de rondas, sección 4): el laboratorio compartido que se proyecta, con los pasos de cada ronda, el
 * contador de personas listas y el cuaderno del grupo. Las personas exploran en su celular; aquí solo se conduce.
 */
export function AdminConsole({ project, state, controller }: Props) {
  const summary = state.summary!;
  const group = state.group;
  const adv = group?.adventure ?? null;
  const { config } = project.bundle;
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const audio = useAudioSignals({ project, state, device: "computer" });
  const online = state.status === "connected";
  const participants = state.presence?.participants ?? [];
  const current = adv ? currentActivity(adv, config) : null;
  const stage = adv?.round.stage;
  const pending = participants.filter((p) => p.inRound && !p.observer && !p.ready).map((p) => p.displayName);
  const players = participants.filter((p) => !p.observer);
  // En el inventor abierto: cuántas personas ya registraron su pregunta (Vanessa las ve en «Preguntas del inventor»).
  const questions = { registered: players.filter((p) => p.question !== null).length, total: players.length };
  const connected = state.presence?.connectedCount ?? 0;
  const joinUrl = `${window.location.origin}${roomPath(summary.code)}`;
  const paused = summary.phase === "paused";
  const playing = summary.phase === "running";
  // En el observatorio Vanessa muestra la casa con una demostración propia (SPECS 3.4).
  const telescope = current?.config.type === "telescope" ? current : null;
  // La casa aparece con la frase de Freire: la idea se muestra directamente, y se queda en la proyección hasta pasar al inventor.
  const houseDemo = useHouseDemo(telescope && stage === "conversation" && adv?.round.freireShown ? telescope.id : null, telescope?.config.type === "telescope" ? telescope.config : null);
  // Mientras se explora, la proyección muestra la mesa abierta en lugar del mapa, y Vanessa también puede hacer la actividad (su propio
  // experimento, local a la consola: no cuenta para el grupo).
  const vanessa = useVanessaTable(adv, project.bundle);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || !online;

  return (
    <div className="adventure">
      <div className="adventure__bar">
        <span className="adventure__who">{current ? `Mesa ${adv!.round.index + 1} de ${config.route.length}: ${current.config.title}` : "El inventor"}</span>
        {stage ? <span className="chip" role="status">{STAGE_LABEL[stage]}</span> : null}
        <span className="chip" role="status">{PHASE_LABEL[summary.phase] ?? summary.phase}</span>
        {adv && (playing || stage === "exploration") ? (
          <RoundControls config={config} adv={adv} counter={state.presence?.round ?? null} pending={pending} questions={questions} disabled={disabled || !playing} admin={(a) => controller.admin(a)} />
        ) : null}
        {paused ? (
          <button type="button" className="btn btn--primary" disabled={disabled} onClick={() => void run(() => controller.admin({ type: "room.resume" }))}>Reanudar</button>
        ) : summary.phase === "running" || summary.phase === "finished" ? (
          <button type="button" className="btn" disabled={disabled} onClick={() => void run(() => controller.admin({ type: "room.pause" }))}>Pausar</button>
        ) : null}
        <button type="button" className="btn" disabled={disabled} onClick={() => setConfirm("reset")}>Reiniciar</button>
        <button type="button" className="btn btn--danger" disabled={disabled} onClick={() => setConfirm("close")}>Cerrar</button>
        <SoundControl audio={audio} />
      </div>
      <SignalText audio={audio} />

      <Suspense fallback={<div className="adventure__map"><p role="status" style={{ padding: 16 }}>Cargando el mapa…</p></div>}>
        <AdventureHost
          project={project}
          state={state}
          port={controller}
          camera="fit"
          label="Escena de la aventura"
          demo={houseDemo.participant ?? vanessa.participant}
          overlay={() => (adv ? <ProjectionBadge config={config} adv={adv} counter={state.presence?.round ?? null} /> : null)}
          // Las preguntas y la frase de Freire se proyectan junto al laboratorio, no encima de él; cuando no hay nada que proyectar, el
          // laboratorio ocupa toda la pantalla.
          panel={(bridge) =>
            adv && hasProjection(config, adv) ? (
              <>
                <ProjectionPanel config={config} adv={adv} />
                {stage === "exploration" ? <VanessaTablePanel config={config} adv={adv} table={vanessa} bridge={bridge} interactive={playing} /> : null}
              </>
            ) : null
          }
        />
      </Suspense>

      <div className="adventure__panels">
        <details className="panel">
          <summary>Participantes ({connected} {connected === 1 ? "conectado" : "conectados"})</summary>
          <ParticipantList
            participants={participants}
            loading={state.presence === null}
            busy={disabled}
            {...(stage ? { stage } : {})}
            questions={stage === "closing" && adv?.inventor.open === true && summary.phase !== "finished"}
            onInclude={(principalId) => void run(() => controller.admin({ type: "round.include", principalId }))}
          />
        </details>
        {(stage === "closing" && adv?.inventor.open) || summary.phase === "finished" ? (
          <details className="panel">
            <summary>Preguntas del inventor ({questions.registered} de {questions.total})</summary>
            {adv ? (
              <FinalQuestion
                config={config}
                adv={adv}
                participants={participants}
                busy={disabled}
                confirm={(value) => controller.admin({ type: "final.confirm", value })}
                correct={(expectedRevision, text) => controller.admin({ type: "final.correct", expectedRevision, text })}
              />
            ) : null}
          </details>
        ) : null}
        <details className="panel">
          <summary>Cuaderno del grupo ({adv?.notebook.length ?? 0})</summary>
          {adv ? (
            <GroupNotes
              config={config}
              adv={adv}
              busy={disabled}
              save={(kind, text) => controller.admin({ type: "note.save", activityId: current?.id ?? config.route.at(-1)!, kind, text })}
              edit={(noteId, expectedRevision, text) => controller.admin({ type: "note.edit", noteId, expectedRevision, text })}
            />
          ) : (
            <p className="hint" role="status">Cargando…</p>
          )}
        </details>
        <details className="panel">
          <summary>Código QR para entrar ({summary.code})</summary>
          <div className="row">
            <QrCode value={joinUrl} size={160} label={`Código QR para entrar a la sala ${summary.code}`} />
            <div>
              <div className="join-code" style={{ fontSize: "2rem" }}>{summary.code}</div>
              <div className="hint join-url">{joinUrl}</div>
            </div>
          </div>
        </details>
      </div>

      {confirm === "reset" ? (
        <ConfirmDialog title="¿Reiniciar la aventura?" confirmLabel="Sí, reiniciar" danger busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(async () => { await controller.admin({ type: "room.reset", confirm: true }); setConfirm(null); })}>
          <p>Se borrará el avance: las pruebas de todas las personas, las notas del grupo y las piezas conseguidas. Se conservan las personas que ya están en la sala, y volverán a la bienvenida para empezar de nuevo.</p>
        </ConfirmDialog>
      ) : null}
      {confirm === "close" ? (
        <ConfirmDialog title="¿Cerrar la sala?" confirmLabel="Sí, cerrar la sala" danger busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void run(async () => { await controller.admin({ type: "room.close", confirm: true }); setConfirm(null); })}>
          <p>La aventura terminará para todas las personas. Nadie podrá volver a entrar ni actuar en esta sala.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
