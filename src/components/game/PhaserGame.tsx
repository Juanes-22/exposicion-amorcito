import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { LoadedProject } from "../../config/loadProject";
import { createGame } from "../../game/createGame";
import type { GameBridge } from "../../game/bridge/GameBridge";
import type { AssetFailure } from "../../game/bridge/events";

interface Props {
  project: LoadedProject;
  bridge: GameBridge;
  debug?: boolean;
  label?: string;
}

/**
 * Aloja la única instancia de `Phaser.Game` de este host. Solo se recrea si cambian el proyecto o el puente (es decir, tras
 * una recarga), nunca por progreso, formularios ni registros (SPECS 10.1). Al destruir retira listeners, canvas y suscripciones.
 */
export function PhaserGame({ project, bridge, debug = false, label = "Mapa del laboratorio" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState<number | null>(0);
  const [failures, setFailures] = useState<AssetFailure[]>([]);

  useEffect(() => {
    const offProgress = bridge.on("game:load-progress", ({ value }) => setLoading((prev) => (prev === null ? value : Math.max(prev, value))));
    const offReady = bridge.on("game:ready", () => setLoading(null));
    const offFail = bridge.on("game:asset-failures", ({ failures: f }) => setFailures(f));
    return () => {
      offProgress();
      offReady();
      offFail();
    };
  }, [bridge]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const game: Phaser.Game = createGame(container, { project, bridge, reducedMotion, debug });
    // Un toque en el mapa le da el foco: el teclado del juego solo escucha ahí.
    const focus = () => container.focus({ preventScroll: true });
    container.addEventListener("pointerdown", focus);
    return () => {
      container.removeEventListener("pointerdown", focus);
      game.destroy(true);
    };
  }, [project, bridge, debug]);

  const loadingText = project.bundle.config.ui.labels.loadingMap ?? "Cargando…";
  return (
    <div className="game-host" ref={containerRef} tabIndex={0} role="region" aria-label={label}>
      {loading !== null ? (
        <div className="map-loading" role="status">
          <p>{loadingText}</p>
          <div className="map-loading__bar" role="progressbar" aria-label={loadingText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loading * 100)}>
            <div className="map-loading__fill" style={{ width: `${Math.round(loading * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {failures.length > 0 ? (
        <div className="game-problem" role="alert">
          No se pudo cargar: {failures.map((f) => f.assetId).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
