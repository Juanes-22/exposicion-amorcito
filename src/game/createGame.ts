import Phaser from "phaser";
import type { LoadedProject } from "../config/loadProject";
import type { GameBridge } from "./bridge/GameBridge";
import { BoxesScene } from "./scenes/BoxesScene";
import { InventorScene } from "./scenes/InventorScene";
import { SceneDirector } from "./scenes/director";
import { LaboratoryScene } from "./scenes/LaboratoryScene";
import { RampsScene } from "./scenes/RampsScene";
import { ShadowsScene } from "./scenes/ShadowsScene";

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
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    backgroundColor: "#2b1f14",
    scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
    // Sin audio hasta P7-02: Phaser destruye el juego de forma diferida y, con StrictMode, cerraba un AudioContext que aún
    // arrancaba (errores «Cannot suspend/resume a closed AudioContext»). Al incorporar sonido hay que crearlo bajo un gesto.
    audio: { noAudio: true },
    // El teclado escucha solo en el contenedor del mapa: sin foco no se capturan las flechas (SPECS 11.1).
    input: { keyboard: { target: parent } },
    // Sin física: la trayectoria compartida procede del dominio y las colisiones las decide el servidor (SPECS 5.6).
    loader: { maxParallelDownloads: 6, imageLoadType: "HTMLImageElement" },
    callbacks: { preBoot: (g) => g.registry.set(DEPS_KEY, deps) },
    // Solo la primera arranca sola; el director cambia a la de la mesa abierta y de vuelta (un solo juego, un solo canvas).
    scene: [LaboratoryScene, ShadowsScene, RampsScene, BoxesScene, InventorScene],
  });
  const director = new SceneDirector(game, deps);
  game.events.once(Phaser.Core.Events.DESTROY, () => director.dispose());

  // Solo en desarrollo o con `?debug` (que ya activa la superposición de colisiones): permite inspeccionar escenas y el puente.
  if (import.meta.env.DEV || deps.hooks) {
    const w = window as unknown as { __PHASER_GAME__?: Phaser.Game; __PHASER_GAMES__?: Phaser.Game[] };
    w.__PHASER_GAME__ = game;
    (w.__PHASER_GAMES__ ??= []).push(game);
  }
  return game;
}
