import { useEffect, useState } from "react";
import { PARTICIPANT_COLORS, NAME_MAX_CHARS } from "../../../shared/contracts/limits";
import type { RoomPublicInfo } from "../../../shared/contracts/events";
import { countChars, normalizeName } from "../../../shared/domain/text";
import type { StoredCredential } from "../../app/credentials";
import { ApiFailure, getRoomInfo, joinRoom } from "../../network/api";
import { ColorPicker } from "../ui/ColorPicker";
import { Silhouette } from "../ui/Silhouette";

interface Props {
  code: string;
  onJoined: (credential: StoredCredential) => void;
  navigate: (to: string) => void;
  /** Aviso previo, p. ej. «tu acceso ya no es válido». */
  intro?: string | null;
}

/**
 * Entrada a una sala: nombre de 1–20 caracteres Unicode, color de la paleta y silueta. Sin cuenta ni fotografía (SPECS 2.1). Todas las
 * personas que entran juegan: la pantalla no ofrece entrar solo a acompañar.
 */
export function JoinView({ code, onJoined, navigate, intro }: Props) {
  const [info, setInfo] = useState<RoomPublicInfo | "missing" | "loading">("loading");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PARTICIPANT_COLORS[0].id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRoomInfo(code).then(
      (i) => !cancelled && setInfo(i),
      () => !cancelled && setInfo("missing"),
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  const chars = countChars(name.trim());
  const valid = normalizeName(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid.ok) return setError(valid.message);
    setBusy(true);
    setError(null);
    try {
      const r = await joinRoom(code, valid.value, color);
      onJoined({ token: r.token, role: "participant", principalId: r.principalId, displayName: r.displayName, color: r.color, savedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "No se pudo entrar a la sala.");
      setBusy(false);
    }
  };

  if (info === "loading") return <main className="screen screen--center"><p role="status">Buscando la sala…</p></main>;
  if (info === "missing" || info.phase === "closed" || info.phase === "expired") {
    return (
      <main className="screen screen--center">
        <div className="card stack">
          <h1>{info === "missing" ? "No encontramos esa sala" : "Esta sala ya terminó"}</h1>
          <p>{info === "missing" ? `Revisa el código ${code} o pídele a la persona que presenta que te lo repita.` : "La aventura ya terminó o la sala ya no está disponible."}</p>
          <button type="button" className="btn" onClick={() => navigate("/")}>Volver al inicio</button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--center">
      <form className="card stack" onSubmit={submit} noValidate>
        <header>
          <h1>{info.title}</h1>
          <p className="muted">Sala <strong>{code}</strong></p>
          {intro ? <p role="status">{intro}</p> : null}
        </header>
        <div className="field">
          <label htmlFor="join-name">Tu nombre</label>
          <input id="join-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" autoFocus aria-describedby="join-name-hint" aria-invalid={name.length > 0 && !valid.ok} />
          <span id="join-name-hint" className={`hint${chars > NAME_MAX_CHARS ? " error" : ""}`}>
            {chars}/{NAME_MAX_CHARS} caracteres. Si alguien más tiene tu mismo nombre, se añadirá un número.
          </span>
        </div>
        <ColorPicker value={color} onChange={setColor} />
        <div className="row" aria-live="polite">
          <Silhouette color={color} size={64} title="Tu silueta" />
          <strong>{valid.ok ? valid.value : "Tu nombre"}</strong>
        </div>
        {error ? <div className="error" role="alert">{error}</div> : null}
        <button type="submit" className="btn btn--primary" disabled={busy || !valid.ok}>
          {busy ? "Entrando…" : "Entrar a la sala"}
        </button>
      </form>
    </main>
  );
}
