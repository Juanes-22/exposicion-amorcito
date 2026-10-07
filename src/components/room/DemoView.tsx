import { useEffect, useState, useSyncExternalStore } from "react";
import { DemoController } from "../../app/DemoController";
import type { RoomClientState } from "../../app/RoomController";
import { homePath, roomPath } from "../../app/useRoute";
import type { LoadedProject } from "../../config/loadProject";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AdminConsole } from "./AdminConsole";

const noopSubscribe = () => () => undefined;
const EMPTY: RoomClientState = { status: "connecting", summary: null, group: null, me: null, characters: {}, presence: null, pending: 0, notice: null };
const emptyState = () => EMPTY;

/**
 * Demostración local (SPECS 6.4, CA-32, CT-14): la misma aventura, con las mismas reglas y escenas, sin servidor ni red. Vanessa conduce
 * la ronda y explora desde aquí con su propio personaje. Siempre muestra el rótulo «Demostración». Su estado es independiente de cualquier
 * sala: volver a la sala no mezcla nada. `from` (código de la sala de la que se vino) solo sirve para ofrecer el regreso.
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
  useEffect(() => {
    if (!notice || !controller) return;
    const t = setTimeout(() => controller.clearNotice(notice.id), 5000);
    return () => clearTimeout(t);
  }, [notice, controller]);

  if (!controller || !state.summary) return <main className="screen screen--center"><p role="status">Preparando la demostración…</p></main>;

  return (
    <>
      <div className="demo-bar" role="status">
        <strong>Demostración</strong>
        <span>Copia local de la aventura: lo que se haga aquí no se guarda en ninguna sala ni se envía por la red.</span>
      </div>
      <AdminConsole
        project={project}
        state={state}
        controller={controller}
        standalone
        barExtra={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(true)}>Reiniciar la demostración</button>
            {fromCode ? <button type="button" className="btn" onClick={() => navigate(roomPath(fromCode))}>Volver a la sala {fromCode}</button> : null}
            <button type="button" className="btn btn--ghost" onClick={() => navigate(homePath())}>Salir</button>
          </>
        }
      />
      {confirm ? (
        <ConfirmDialog title="¿Reiniciar la demostración?" confirmLabel="Sí, reiniciar" danger onCancel={() => setConfirm(false)} onConfirm={() => void controller.restart().then(() => setConfirm(false))}>
          <p>Se borrará el avance de la demostración. No cambia nada de ninguna sala.</p>
        </ConfirmDialog>
      ) : null}

      <div aria-live="polite" role="status" className="visually-hidden">{notice?.text ?? ""}</div>
      {notice ? <div className={`notice${notice.kind === "error" ? " notice--error" : ""}`} aria-hidden="true">{notice.text}</div> : null}
    </>
  );
}
