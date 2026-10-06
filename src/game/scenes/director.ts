import Phaser from "phaser";
import type { GameDeps } from "../createGame";
import { ALL_SCENES, desiredScene, LABORATORY_SCENE } from "./sceneKeys";

/**
 * Cambia de escena DENTRO del mismo `Phaser.Game` cuando cambia la vista del snapshot: no se crea otro juego ni otro canvas al abrir
 * o cerrar una mesa (SPECS 10.1). Cada escena que entra obtiene su propio token del puente y la anterior se detiene y limpia.
 */
export class SceneDirector {
  private target: string = LABORATORY_SCENE; // el laboratorio es la primera escena y arranca sola
  /** El laboratorio ya ejecutó su `create`. Antes de eso no hay nada que cambiar: Phaser aún está arrancando sus escenas. */
  private labReady = false;
  private offs: Array<() => void> = [];

  constructor(
    private readonly game: Phaser.Game,
    private readonly deps: GameDeps,
  ) {
    const { bridge } = deps;
    // `game:ready` cubre el caso de arrancar con una mesa ya abierta (recarga o reconexión): se cambia en cuanto el laboratorio existe.
    this.offs.push(
      bridge.on("app:snapshot", () => this.reconcile()),
      bridge.on("game:ready", () => {
        this.labReady = true;
        this.reconcile();
      }),
    );
  }

  reconcile(): void {
    const snap = this.deps.bridge.snapshot;
    if (!this.game.isBooted || !snap || !this.labReady) return;
    // `game:ready` se emite DENTRO del `create` de la escena, y una escena en `create` no se puede parar con fiabilidad (Phaser la
    // deja en marcha al terminar). Se espera al final del fotograma, cuando ya está en marcha.
    const settling = this.game.scene.getScenes(false).some((s) => s.sys.settings.status === Phaser.Scenes.CREATING || s.sys.settings.status === Phaser.Scenes.LOADING);
    if (settling) {
      this.game.events.once(Phaser.Core.Events.POST_STEP, () => this.reconcile());
      return;
    }
    const want = desiredScene(snap.state.adventure.view, this.deps.project.bundle.config.activities);
    if (want === this.target) return; // ya pedida (arrancando o en marcha)
    const sm = this.game.scene;
    for (const key of ALL_SCENES) if (key !== want && (sm.isActive(key) || sm.isPaused(key) || sm.isSleeping(key))) sm.stop(key);
    sm.start(want);
    this.target = want;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }
}
