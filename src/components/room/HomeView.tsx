import { useState } from "react";
import type { LoadedProject } from "../../config/loadProject";
import { saveCredential } from "../../app/credentials";
import { createRoom, ApiFailure } from "../../network/api";
import { roomPath } from "../../app/useRoute";

/** Entrada: crear sala, unirse con un código y acceso a la demostración local para Vanessa (SPECS 2.1). */
export function HomeView({ project, navigate }: { project: LoadedProject; navigate: (to: string) => void }) {
  const { config } = project.bundle;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom(config.contentSetId);
      saveCredential(room.code, { token: room.adminToken, role: "admin", principalId: room.adminId, displayName: config.project.studentName, color: null, savedAt: new Date().toISOString() });
      navigate(roomPath(room.code));
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "No se pudo crear la sala.");
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(clean)) return setError("Escribe el código de la sala: letras y números.");
    navigate(roomPath(clean));
  };

  return (
    <main className="screen screen--center">
      <div className="card stack">
        <header>
          <h1>{config.project.title}</h1>
          <p className="muted">{config.project.subtitle}</p>
        </header>
        <button type="button" className="btn btn--primary" onClick={create} disabled={busy}>
          {busy ? "Creando la sala…" : "Crear sala"}
        </button>
        <form className="stack" onSubmit={join}>
          <div className="field">
            <label htmlFor="room-code">Unirse con un código</label>
            <input id="room-code" className="input input--code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" aria-describedby="room-code-hint" />
            <span id="room-code-hint" className="hint">También puedes escanear el código QR de la proyección.</span>
          </div>
          <button type="submit" className="btn">Unirme</button>
        </form>
        {error ? <div className="error" role="alert">{error}</div> : null}
        <hr />
        <button type="button" className="btn btn--ghost" onClick={() => navigate("/demo")}>Demostración (respaldo local para Vanessa)</button>
        <p className="hint">
          {config.project.studentName} · {config.project.courseName} · {config.project.university}
        </p>
      </div>
    </main>
  );
}
