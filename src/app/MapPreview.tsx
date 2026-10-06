import { useEffect, useMemo } from "react";
import { createRoomState } from "../../shared/domain/room";
import type { LoadedProject } from "../config/loadProject";
import { PhaserGame } from "../components/game/PhaserGame";
import { GameBridge } from "../game/bridge/GameBridge";

/**
 * Vista provisional de `/demo` (P1-05): muestra el TMJ nativo con un estado local creado por el dominio compartido, que aquí se
 * ejecuta en el navegador. La demostración completa (DemoController, estado aislado, mesas) llega en la fase 6.
 */
export function MapPreview({ project }: { project: LoadedProject }) {
  const bridge = useMemo(() => new GameBridge(), []);
  const debug = useMemo(() => new URLSearchParams(window.location.search).has("debug"), []);
  useEffect(() => {
    const { config, map } = project.bundle;
    const state = createRoomState({ roomId: "demo", code: "DEMO", config, map, configHash: project.bundle.configHash, mapHash: project.bundle.mapHash, nowIso: new Date().toISOString() });
    bridge.emit("app:snapshot", { state, controller: null });
    return () => bridge.dispose();
  }, [bridge, project]);
  return (
    <main style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "8px 14px", background: "var(--wood-dark)", color: "var(--paper)", display: "flex", gap: 12, alignItems: "baseline" }}>
        <strong>Demostración</strong>
        <span>Vista del mapa (prototipo). Añade <code>?debug</code> para ver colisiones y radios.</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PhaserGame project={project} bridge={bridge} debug={debug} />
      </div>
    </main>
  );
}
