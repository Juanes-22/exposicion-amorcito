import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { drafts } from "../components/activities/drafts";
import { clearCredential, loadCredential, saveCredential, type StoredCredential } from "./credentials";
import { RoomController, type RoomClientState } from "./RoomController";

const EMPTY: RoomClientState = { status: "connecting", summary: null, presence: null, snapshot: null, pending: 0, notice: null };
const noopSubscribe = () => () => undefined;
const emptyState = () => EMPTY;

const socketUrl = () => window.location.origin;
const socketPath = () => `${import.meta.env.BASE_URL}socket.io`.replace(/\/{2,}/g, "/");

export interface RoomSession {
  credential: StoredCredential | null;
  controller: RoomController | null;
  state: RoomClientState;
  /** Guarda la credencial recién obtenida y abre la conexión. */
  adopt: (credential: StoredCredential) => void;
  /** Olvida la credencial de esta sala en este navegador. */
  leave: () => void;
}

/**
 * Sesión de una sala en este navegador. El controlador se crea dentro del efecto: con StrictMode el primero se descarta y el
 * segundo conecta de verdad (un controlador desechado no puede reutilizarse).
 */
export function useRoomSession(code: string): RoomSession {
  const [credential, setCredential] = useState<StoredCredential | null>(() => loadCredential(code));
  const [controller, setController] = useState<RoomController | null>(null);

  useEffect(() => {
    setCredential(loadCredential(code));
  }, [code]);

  useEffect(() => {
    if (!credential) return;
    const c = new RoomController(socketUrl(), credential.token, { path: socketPath() });
    c.onUnauthorized = () => {
      drafts.forgetRoom(code);
      clearCredential(code);
      setCredential(null);
    };
    // Perder el turno con texto sin compartir en este dispositivo: el borrador se conserva localmente y se avisa (SPECS 3.1).
    c.turnLossHint = () => (drafts.hasUnshared(code) ? "Quedó un texto sin compartir en tu borrador; no se envió al grupo." : null);
    // Tras «Reiniciar la aventura» los borradores de la aventura anterior no deben reaparecer en los formularios nuevos.
    c.onGenerationChange = () => drafts.forgetRoom(code);
    c.connect();
    setController(c);
    return () => {
      c.dispose();
      setController((cur) => (cur === c ? null : cur));
    };
  }, [credential, code]);

  const state = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getState ?? emptyState);
  const adopt = useCallback(
    (c: StoredCredential) => {
      saveCredential(code, c);
      setCredential(c);
    },
    [code],
  );
  const leave = useCallback(() => {
    drafts.forgetRoom(code);
    clearCredential(code);
    setCredential(null);
  }, [code]);
  return { credential, controller, state, adopt, leave };
}
