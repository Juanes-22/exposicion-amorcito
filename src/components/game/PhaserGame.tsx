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
  hooks?: boolean;
  camera?: "fit" | "follow";
  label?: string;
}

/**
 * Aloja la única instancia de `Phaser.Game` de este host. Solo se recrea si cambian el proyecto o el puente (es decir, tras
 * una recarga), nunca por progreso, formularios ni registros (SPECS 10.1). Al destruir retira listeners, canvas y suscripciones.
 */
export function PhaserGame({ project, bridge, debug = false, hooks = false, camera = "fit", label = "Mapa del laboratorio" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState<number | null>(0);
  const [failures, setFailures] = useState<AssetFailure[]>([]);

  useEffect(() => {
    const offProgress = bridge.on("game:load-progress", ({ value }) => // Una vez listo no se vuelve a mostrar el aviso de carga: cambiar de escena (mesa ↔ mapa) no es «cargar de nuevo».
    setLoading((prev) => (prev === null ? null : Math.max(prev, value))));
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
    const game: Phaser.Game = createGame(container, { project, bridge, reducedMotion, debug, hooks: hooks || debug, camera });
    // Un toque en el mapa le da el foco: el teclado del juego solo escucha ahí.
    const focus = () => container.focus({ preventScroll: true });
    container.addEventListener("pointerdown", focus);
    // Phaser solo se entera de que cambió la ventana, no de que cambió el hueco del escenario (p. ej. al aparecer la pregunta de la
    // conversación junto al laboratorio): sin esto el lienzo conservaba el tamaño anterior y el mapa quedaba descentrado y recortado.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => game.isBooted && game.scale.getParentBounds() && game.scale.refresh());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      container.removeEventListener("pointerdown", focus);
      game.destroy(true);
    };
  }, [project, bridge, debug, hooks, camera]);

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
