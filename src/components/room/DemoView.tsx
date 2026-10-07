import { useEffect, useState, useSyncExternalStore } from "react";
import { useAudioSignals } from "../../app/audio/useAudioSignals";
import { DemoController } from "../../app/DemoController";
import type { RoomClientState } from "../../app/RoomController";
import { homePath, roomPath } from "../../app/useRoute";
import type { LoadedProject } from "../../config/loadProject";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AdventureHost } from "./AdventureHost";
import { SignalText, SoundControl } from "./SoundControl";

const noopSubscribe = () => () => undefined;
const EMPTY: RoomClientState = { status: "connecting", summary: null, presence: null, snapshot: null, pending: 0, notice: null };
const emptyState = () => EMPTY;

/**
 * Demostración local (SPECS 6.4, CA-32, CT-14): la misma aventura, con las mismas reglas y escenas, sin servidor ni red. Vanessa
 * explora y modera desde aquí. Siempre muestra el rótulo «Demostración». Su estado es independiente de cualquier sala: volver a la
 * sala no mezcla nada. `from` (código de la sala de la que se vino) solo sirve para ofrecer el regreso.
 */
export function DemoView({ project, navigate }: { project: LoadedProject; navigate: (to: string) => void }) {
  const [controller, setController] = useState<DemoController | null>(null);
  const [confirm, setConfirm] = useState(false);
  const from = new URLSearchParams(window.location.search).get("from")?.toUpperCase() ?? null;
  const fromCode = from && /^[A-Z0-9]{3,12}$/.test(from) ? from : null;

  // El controlador se crea dentro del efecto (StrictMode descarta el primero) y al desmontar guarda lo último que se vio.
  useEffect(() => {
    const c = new DemoController(project.bundle);
    c.connect();
    setController(c);
    return () => {
      c.dispose();
      setController((cur) => (cur === c ? null : cur));
    };
  }, [project]);

  const state = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getState ?? emptyState);
  const notice = state.notice;
  const audio = useAudioSignals({ project, state, device: "computer" });
  useEffect(() => {
    if (!notice || !controller) return;
    const t = setTimeout(() => controller.clearNotice(notice.id), 5000);
    return () => clearTimeout(t);
  }, [notice, controller]);

  if (!controller || !state.summary) return <main className="screen screen--center"><p role="status">Preparando la demostración…</p></main>;

  const { config } = project.bundle;
  const summary = state.summary;
  const view = state.snapshot?.state.adventure.view;
  const noteKey = view?.kind === "activity" ? view.activityId : view?.kind === "final" ? "cierre" : "bienvenida";
  const notes = config.facilitatorNotes[noteKey] ?? [];
  const playable = summary.phase === "running" || summary.phase === "finished";
  const paused = summary.phase === "paused";

  return (
    <div className="adventure">
      <div className="demo-bar" role="status">
        <strong>Demostración</strong>
        <span>Copia local de la aventura: lo que se haga aquí no se guarda en ninguna sala ni se envía por la red.</span>
      </div>
      <div className="adventure__bar">
        <span className="adventure__who">Explora: {summary.controller?.displayName ?? "Vanessa"}</span>
        {paused ? (
          <button type="button" className="btn btn--primary" onClick={() => void controller.admin({ type: "room.resume" })}>Reanudar</button>
        ) : (
          <button type="button" className="btn" onClick={() => void controller.admin({ type: "room.pause" })}>Pausar</button>
        )}
        <button type="button" className="btn" onClick={() => setConfirm(true)}>Reiniciar la demostración</button>
        {fromCode ? <button type="button" className="btn" onClick={() => navigate(roomPath(fromCode))}>Volver a la sala {fromCode}</button> : null}
        <button type="button" className="btn btn--ghost" onClick={() => navigate(homePath())}>Salir</button>
        <SoundControl audio={audio} />
      </div>
      <SignalText audio={audio} />

      <AdventureHost project={project} state={state} controller={controller} camera="fit" notebookMenu canAct={playable} reason={paused ? "La demostración está en pausa." : null} label="Escena de la demostración" />

      <div className="adventure__panels">
        <details className="panel">
          <summary>Guía para conversar</summary>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      </div>

      {confirm ? (
        <ConfirmDialog title="¿Reiniciar la demostración?" confirmLabel="Sí, reiniciar" danger onCancel={() => setConfirm(false)} onConfirm={() => void controller.restart().then(() => setConfirm(false))}>
          <p>Se borrará el avance de la demostración. No cambia nada de ninguna sala.</p>
        </ConfirmDialog>
      ) : null}

      <div aria-live="polite" role="status" className="visually-hidden">{notice?.text ?? ""}</div>
      {notice ? <div className={`notice${notice.kind === "error" ? " notice--error" : ""}`} aria-hidden="true">{notice.text}</div> : null}
    </div>
  );
}
