import { useEffect } from "react";
import { isTerminal } from "../../../shared/domain/room";
import type { LoadedProject } from "../../config/loadProject";
import { useRoomSession } from "../../app/useRoomSession";
import { AdminConsole } from "./AdminConsole";
import { AdminWelcome } from "./AdminWelcome";
import { ParticipantView } from "./ParticipantView";
import { JoinView } from "./JoinView";
import { TerminalView } from "./TerminalView";
import { WaitingView } from "./WaitingView";

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
  else body = summary.self.observer ? <WaitingView project={project} state={state} /> : <ParticipantView project={project} state={state} controller={controller} />;

  return (
    <>
      {body}
      {state.status === "reconnecting" ? <div className="notice notice--error" role="status">Reconectando con la sala…</div> : null}
      <div aria-live="polite" role="status" className="visually-hidden">{notice?.text ?? ""}</div>
      {notice && state.status !== "reconnecting" ? <div className={`notice${notice.kind === "error" ? " notice--error" : ""}`} aria-hidden="true">{notice.text}</div> : null}
    </>
  );
}
