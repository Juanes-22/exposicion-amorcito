import Phaser from "phaser";
import { animKey } from "../../../shared/config/frameDefinitions";
import type { Direction, Point } from "../../../shared/contracts/geometry";
import { restFrameOf } from "../sheets";

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
    this.sprite = scene.add.sprite(feet.x, feet.y, assetId, restFrameOf(assetId, "vanessa-idle") ?? "down-1").setScale(scale);
    this.sprite.setDepth(feet.y);
  }

  /** Coloca al personaje y elige la pose. Se llama desde `update`, con el plan interpolado por el reloj. */
  place(feet: Point, facing: Direction, moving: boolean): void {
    this.sprite.setPosition(feet.x, feet.y);
    this.sprite.setDepth(feet.y);
    if (facing === this.facing && moving === this.moving) return;
    this.facing = facing;
    this.moving = moving;
    if (moving && !this.reducedMotion) {
      this.sprite.anims.play(animKey(this.assetId, `vanessa-walk-${facing}`), true);
    } else {
      this.sprite.anims.stop();
      this.sprite.setFrame(restFrameOf(this.assetId, `vanessa-walk-${facing}`) ?? "down-1");
    }
  }

  get feet(): Point {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
