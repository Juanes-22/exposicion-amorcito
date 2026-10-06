import { lazy, Suspense, useState } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomController, RoomClientState } from "../../app/RoomController";
import { roomPath } from "../../app/useRoute";
import { NotebookView } from "../notebook/NotebookView";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { QrCode } from "../ui/QrCode";
import { ParticipantList } from "./ParticipantList";

// El módulo del mapa (con Phaser) se carga bajo demanda: quien solo espera nunca lo descarga ni crea un canvas.
const AdventureHost = lazy(() => import("./AdventureHost").then((m) => ({ default: m.AdventureHost })));

const PHASE_LABEL: Record<string, string> = { welcome: "Bienvenida", running: "En curso", paused: "En pausa", finished: "Terminó la aventura" };

type Confirm = "reset" | "close" | null;

/**
 * Aventura de Vanessa: la escena compartida que se proyecta, con la moderación en paneles plegables que no cubren los resultados
 * (SPECS 2.1, 11.1). Quien observa no manipula el experimento sin «Tomar control» (SPECS 2.2).
 */
export function AdminConsole({ project, state, controller }: { project: LoadedProject; state: RoomClientState; controller: RoomController }) {
  const summary = state.summary!;
  const { config } = project.bundle;
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const online = state.status === "connected";
  const owner = summary.controller;
  const isOwner = summary.self.isController;
  const participants = state.presence?.participants ?? [];
  const view = state.snapshot?.state.adventure.view;
  const noteKey = view?.kind === "activity" ? view.activityId : view?.kind === "final" ? "cierre" : "bienvenida";
  const notes = config.facilitatorNotes[noteKey] ?? [];
  const joinUrl = `${window.location.origin}${roomPath(summary.code)}`;

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
        <span className="adventure__who">{owner ? `Explora: ${owner.displayName}` : "Nadie tiene el turno"}</span>
        <span className="chip" role="status">{PHASE_LABEL[summary.phase] ?? summary.phase}</span>
        {summary.phase === "paused" ? (
          <button type="button" className="btn btn--primary" disabled={disabled || !owner} onClick={() => void run(() => controller.admin({ type: "room.resume" }))}>Reanudar</button>
        ) : (
          <button type="button" className="btn" disabled={disabled} onClick={() => void run(() => controller.admin({ type: "room.pause" }))}>Pausar</button>
        )}
        {!isOwner ? <button type="button" className="btn" disabled={disabled} onClick={() => void run(() => controller.admin({ type: "control.take" }))}>Tomar control</button> : null}
        {owner ? <button type="button" className="btn" disabled={disabled} onClick={() => void run(() => controller.admin({ type: "control.revoke" }))}>Retirar control</button> : null}
        <button type="button" className="btn" disabled={disabled} onClick={() => setConfirm("reset")}>Reiniciar</button>
        <button type="button" className="btn btn--danger" disabled={disabled} onClick={() => setConfirm("close")}>Cerrar</button>
      </div>

      <Suspense fallback={<div className="adventure__map"><p role="status" style={{ padding: 16 }}>Cargando el mapa…</p></div>}>
        <AdventureHost project={project} state={state} controller={controller} camera="fit" canAct={isOwner && (summary.phase === "running" || summary.phase === "finished")} reason={summary.phase === "paused" ? "La aventura está en pausa." : isOwner ? null : "Usa «Tomar control» para participar."} label="Escena de la aventura" />
      </Suspense>

      <div className="adventure__panels">
        <details className="panel">
          <summary>Participantes ({state.presence?.connectedCount ?? 0} conectadas)</summary>
          <ParticipantList participants={participants} loading={state.presence === null} busy={disabled} onAssign={(principalId) => void run(() => controller.admin({ type: "control.assign", principalId }))} />
        </details>
        <details className="panel">
          <summary>Cuaderno ({state.snapshot?.state.adventure.notebook.length ?? 0})</summary>
          {/* Panel local de Vanessa: leer o corregir aquí no cambia la escena ni el turno de quien explora. */}
          {state.snapshot ? (
            <NotebookView room={summary.code} config={config} records={state.snapshot.state.adventure.notebook} canEdit={isOwner && (summary.phase === "running" || summary.phase === "finished")} busy={state.pending > 0} send={(a) => controller.adventure(a)} />
          ) : (
            <p className="hint" role="status">Cargando…</p>
          )}
        </details>
        <details className="panel">
          <summary>Guía para conversar</summary>
          <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
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
          <p>Se borrará el avance: las ideas, las pruebas y las piezas conseguidas. Se conservan las personas que ya están en la sala, y volverán a la bienvenida para elegir quién comienza.</p>
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
