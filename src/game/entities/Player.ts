import Phaser from "phaser";
import { animKey } from "../../../shared/config/frameDefinitions";
import type { Direction, Point } from "../../../shared/contracts/geometry";
import { restFrameOf, stillFrameOf } from "../sheets";

/** Vanessa con Jerry. Siempre es el personaje controlable, sea quien sea quien tenga el turno (SPECS 1). */
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  private facing: Direction = "down";
  private moving = false;

  constructor(
    scene: Phaser.Scene,
    private readonly assetId: string,
    feet: Point,
    scale: number,
    private readonly reducedMotion: boolean,
  ) {
    // El pivote de cada frame está en los pies (frameDefinitions): la posición del sprite ES la posición de los pies.
    this.sprite = scene.add.sprite(feet.x, feet.y, assetId, restFrameOf(assetId, "vanessa-idle") ?? "down-0").setScale(scale);
    this.sprite.setDepth(feet.y);
    this.pose();
  }

  /** Coloca al personaje y elige la pose. Se llama desde `update`, con el plan interpolado por el reloj. */
  place(feet: Point, facing: Direction, moving: boolean): void {
    this.sprite.setPosition(feet.x, feet.y);
    this.sprite.setDepth(feet.y);
    if (facing === this.facing && moving === this.moving) return;
    this.facing = facing;
    this.moving = moving;
    this.pose();
  }

  /**
   * Caminando o de pie, Vanessa y Jerry parpadean de vez en cuando (la hoja v5 está de pie en sus cuatro direcciones). Con movimiento
   * reducido se quedan quietos en su pose con los ojos abiertos.
   */
  private pose(): void {
    const animId = this.moving ? `vanessa-walk-${this.facing}` : `vanessa-idle-${this.facing}`;
    const key = animKey(this.assetId, animId);
    if (!this.reducedMotion && this.sprite.scene.anims.exists(key)) {
      this.sprite.anims.play(key, true);
    } else {
      this.sprite.anims.stop();
      this.sprite.setFrame(stillFrameOf(this.assetId, animId) ?? restFrameOf(this.assetId, animId) ?? `${this.facing}-0`);
    }
  }

  get feet(): Point {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
