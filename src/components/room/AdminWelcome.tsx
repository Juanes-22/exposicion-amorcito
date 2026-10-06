import { useState } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomController, RoomClientState } from "../../app/RoomController";
import { roomPath } from "../../app/useRoute";
import { QrCode } from "../ui/QrCode";
import { ParticipantList } from "./ParticipantList";

/** Bienvenida de Vanessa (se proyecta): QR, código, cantidad conectada, tarjetas de participantes, elegir turno y comenzar (SPECS 2.1). */
export function AdminWelcome({ project, state, controller }: { project: LoadedProject; state: RoomClientState; controller: RoomController }) {
  const summary = state.summary!;
  const { config } = project.bundle;
  const [busy, setBusy] = useState(false);
  const joinUrl = `${window.location.origin}${roomPath(summary.code)}`;
  const participants = state.presence?.participants ?? [];
  const connected = state.presence?.connectedCount ?? 0;
  const first = summary.controller;
  const online = state.status === "connected";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <header style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-title)", margin: 0 }}>{config.project.title}</h1>
        <p className="muted" style={{ margin: 0 }}>{config.project.subtitle}</p>
      </header>
      <div className="welcome">
        <section className="card join-panel stack" aria-labelledby="join-title">
          <h2 id="join-title">Entra con tu celular</h2>
          <div style={{ display: "grid", placeItems: "center" }}>
            <QrCode value={joinUrl} label={`Código QR para entrar a la sala ${summary.code}`} />
          </div>
          <div>
            <div className="hint">o escribe el código</div>
            <div className="join-code" aria-label={`Código de sala ${summary.code.split("").join(" ")}`}>{summary.code}</div>
            <div className="join-url hint">{joinUrl}</div>
          </div>
          <p>
            <span className={`chip ${online ? "chip--ok" : "chip--warn"}`}>{online ? "● Sala conectada" : "○ Reconectando…"}</span>
          </p>
        </section>
        <section className="card stack" aria-labelledby="who-title">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 id="who-title" style={{ margin: 0 }}>En la sala</h2>
            <span className="chip" role="status">{connected} {connected === 1 ? "conectada" : "conectadas"}</span>
          </div>
          <ParticipantList participants={participants} loading={state.presence === null} busy={busy || !online} onAssign={(principalId) => void run(() => controller.admin({ type: "control.assign", principalId }))} />
          <div className="row">
            <button type="button" className="btn btn--ghost" disabled={busy || !online} onClick={() => void run(() => controller.admin({ type: "control.take" }))}>
              Empiezo yo (tomar control)
            </button>
            <button type="button" className="btn btn--primary" disabled={busy || !online || !first} onClick={() => void run(() => controller.admin({ type: "room.start" }))}>
              {first ? `Comenzar con ${first.displayName}` : "Elige quién comienza"}
            </button>
          </div>
          <p className="hint">Solo la persona con el turno usa el mapa y los experimentos en su celular. Los demás siguen la proyección y participan en voz alta.</p>
        </section>
      </div>
    </main>
  );
}
