import Phaser from "phaser";
import type { LoadedProject } from "../config/loadProject";
import type { GameBridge } from "./bridge/GameBridge";
import { canvasSize, trackCanvasSize } from "./pixelRatio";
import { InventorScene } from "./scenes/InventorScene";
import { SceneDirector } from "./scenes/director";
import { LaboratoryScene } from "./scenes/LaboratoryScene";
import { RampsScene } from "./scenes/RampsScene";
import { ShadowsScene } from "./scenes/ShadowsScene";
import { TelescopeScene } from "./scenes/TelescopeScene";

export interface GameDeps {
  project: LoadedProject;
  bridge: GameBridge;
  /** prefers-reduced-motion: sin animación de caminar ni sacudidas (SPECS 11.1). */
  reducedMotion: boolean;
  /** Superposición de colisiones, radios y huella: solo para depurar el mapa. */
  debug: boolean;
  /** Expone `window.__PHASER_GAME__` (pruebas e2e y depuración). */
  hooks: boolean;
  /** `fit`: el laboratorio entero (proyección). `follow`: sigue a Vanessa con ampliación legible (teléfono del controlador). */
  camera: "fit" | "follow";
}

/** Clave del DataManager global de Phaser donde las escenas encuentran sus dependencias. */
export const DEPS_KEY = "deps";

export const getDeps = (scene: Phaser.Scene): GameDeps => scene.registry.get(DEPS_KEY) as GameDeps;

export function createGame(parent: HTMLElement, deps: GameDeps): Phaser.Game {
  // El lienzo se dibuja a la densidad de la pantalla y se muestra al tamaño del contenedor (ver `pixelRatio.ts`); el tamaño lo mantiene
  // `trackCanvasSize`, no el modo RESIZE de Phaser, que solo conoce píxeles CSS.
  const initial = canvasSize(parent);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    backgroundColor: "#2b1f14",
    scale: { mode: Phaser.Scale.NONE, width: initial.width, height: initial.height, zoom: 1 / initial.ratio },
    // Sin audio hasta P7-02: Phaser destruye el juego de forma diferida y, con StrictMode, cerraba un AudioContext que aún
    // arrancaba (errores «Cannot suspend/resume a closed AudioContext»). Al incorporar sonido hay que crearlo bajo un gesto.
    audio: { noAudio: true },
    // El teclado escucha solo en el contenedor del mapa: sin foco no se capturan las flechas (SPECS 11.1).
    input: { keyboard: { target: parent } },
    // Sin física: la trayectoria compartida procede del dominio y las colisiones las decide el servidor (SPECS 5.6).
    loader: { maxParallelDownloads: 6, imageLoadType: "HTMLImageElement" },
    callbacks: { preBoot: (g) => g.registry.set(DEPS_KEY, deps) },
    // Solo la primera arranca sola; el director cambia a la de la mesa abierta y de vuelta (un solo juego, un solo canvas).
    scene: [LaboratoryScene, ShadowsScene, RampsScene, TelescopeScene, InventorScene],
  });
  const director = new SceneDirector(game, deps);
  game.events.once(Phaser.Core.Events.DESTROY, () => director.dispose());
  // El tamaño se ajusta al arrancar el juego (antes no hay lienzo) y desde ahí sigue al contenedor.
  let stopTracking: (() => void) | null = null;
  game.events.once(Phaser.Core.Events.READY, () => void (stopTracking = trackCanvasSize(game, parent)));
  game.events.once(Phaser.Core.Events.DESTROY, () => stopTracking?.());

  // Solo en desarrollo o con `?debug` (que ya activa la superposición de colisiones): permite inspeccionar escenas y el puente.
  if (import.meta.env.DEV || deps.hooks) {
    const w = window as unknown as { __PHASER_GAME__?: Phaser.Game; __PHASER_GAMES__?: Phaser.Game[] };
    w.__PHASER_GAME__ = game;
    (w.__PHASER_GAMES__ ??= []).push(game);
  }
  return game;
}
