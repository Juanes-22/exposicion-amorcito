import { useEffect, useState } from "react";
import { isTerminal } from "../../../shared/domain/room";
import type { LoadedProject } from "../../config/loadProject";
import { demoPath } from "../../app/useRoute";
import { useRoomSession } from "../../app/useRoomSession";
import { drafts } from "../activities/drafts";
import { AdminConsole } from "./AdminConsole";
import { AdminWelcome } from "./AdminWelcome";
import { ControllerView } from "./ControllerView";
import { JoinView } from "./JoinView";
import { TerminalView } from "./TerminalView";
import { WaitingView } from "./WaitingView";

/** Cuánto se espera con la conexión caída antes de ofrecerle la demostración a quien administra. */
const BACKUP_OFFER_MS = 5000;

/** Elige la vista según la credencial, el papel y la fase de la sala. El servidor autoriza; la vista solo refleja. */
export function RoomView({ project, code, navigate }: { project: LoadedProject; code: string; navigate: (to: string) => void }) {
  const session = useRoomSession(code);
  const { credential, controller, state } = session;
  const notice = state.notice;

  // El aviso se retira solo; el texto se anuncia a lectores de pantalla mediante la región `aria-live`.
  useEffect(() => {
    if (!notice || !controller) return;
    const t = setTimeout(() => controller.clearNotice(notice.id), 5000);
    return () => clearTimeout(t);
  }, [notice, controller]);

  // Si la conexión no vuelve, Vanessa puede decidir seguir con la demostración (SPECS 6.4). No es automático: ella elige.
  const connecting = state.status === "connecting" || state.status === "reconnecting";
  const [offerBackup, setOfferBackup] = useState(false);
  useEffect(() => {
    if (!connecting) return setOfferBackup(false);
    const t = setTimeout(() => setOfferBackup(true), BACKUP_OFFER_MS);
    return () => clearTimeout(t);
  }, [connecting]);

  // Una sala que terminó ya no admite más registros: no quedan borradores que conservar para ella.
  const terminal = state.summary ? isTerminal(state.summary.phase) : false;
  useEffect(() => {
    if (terminal) drafts.forgetRoom(code);
  }, [terminal, code]);

  if (!credential) return <JoinView code={code} onJoined={session.adopt} navigate={navigate} />;
  const goHome = () => {
    session.leave();
    navigate("/");
  };

  let body: React.ReactNode;
  const summary = state.summary;
  if (state.status === "replaced") body = <TerminalView reason="replaced" onHome={goHome} />;
  else if (summary && isTerminal(summary.phase)) body = <TerminalView reason={summary.phase as "closed" | "expired"} onHome={goHome} />;
  else if (!summary || !controller) body = <main className="screen screen--center"><p role="status">Conectando con la sala…</p></main>;
  else if (summary.self.role === "admin") body = summary.phase === "welcome" ? <AdminWelcome project={project} state={state} controller={controller} /> : <AdminConsole project={project} state={state} controller={controller} />;
  else body = summary.self.isController ? <ControllerView project={project} state={state} controller={controller} /> : <WaitingView project={project} state={state} />;

  return (
    <>
      {body}
      {offerBackup && credential.role === "admin" ? (
        <div className="backup-offer" role="alert">
          <p>
            <strong>La conexión con la sala no vuelve.</strong> Si hace falta, puedes continuar con la demostración: es una copia aparte y lo que hagas ahí no se guarda en la sala. Cuando regrese la conexión, la sala sigue como estaba.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => navigate(demoPath(code))}>Usar la demostración</button>
        </div>
      ) : null}
      {state.status === "reconnecting" ? <div className="notice notice--error" role="status">Reconectando con la sala…</div> : null}
      <div aria-live="polite" role="status" className="visually-hidden">{notice?.text ?? ""}</div>
      {notice && state.status !== "reconnecting" ? <div className={`notice${notice.kind === "error" ? " notice--error" : ""}`} aria-hidden="true">{notice.text}</div> : null}
    </>
  );
}
