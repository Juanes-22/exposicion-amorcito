import { useState } from "react";
import type { LoadedProject } from "../../config/loadProject";
import type { RoomController, RoomClientState } from "../../app/RoomController";
import { roomPath } from "../../app/useRoute";
import { QrCode } from "../ui/QrCode";
import { ParticipantList } from "./ParticipantList";

/** Bienvenida de Vanessa (se proyecta): QR, código, cuántas personas entraron y «Comenzar». Todas exploran a la vez: no se elige turno. */
export function AdminWelcome({ project, state, controller }: { project: LoadedProject; state: RoomClientState; controller: RoomController }) {
  const summary = state.summary!;
  const { config } = project.bundle;
  const [busy, setBusy] = useState(false);
  const joinUrl = `${window.location.origin}${roomPath(summary.code)}`;
  const participants = state.presence?.participants ?? [];
  const players = participants.filter((p) => !p.observer);
  const connectedPlayers = players.filter((p) => p.connected).length;
  const observers = participants.length - players.length;
  const online = state.status === "connected";

  const start = async () => {
    setBusy(true);
    try {
      await controller.admin({ type: "room.start" });
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
            <span className="chip" role="status">
              {connectedPlayers} {connectedPlayers === 1 ? "persona conectada" : "personas conectadas"}
              {observers > 0 ? ` · ${observers} ${observers === 1 ? "observa" : "observan"}` : ""}
            </span>
          </div>
          <ParticipantList participants={participants} loading={state.presence === null} busy={busy || !online} />
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={busy || !online || players.length === 0} onClick={() => void start()}>
              Comenzar la aventura
            </button>
          </div>
          <p className="hint">Todas las personas exploran a la vez desde su celular. Tú abres cada mesa, reúnes al grupo para conversar y decides cuándo seguir.</p>
        </section>
      </div>
    </main>
  );
}
