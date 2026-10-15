import Phaser from "phaser";
import { animKey } from "../../../shared/config/frameDefinitions";
import type { Direction, Point } from "../../../shared/contracts/geometry";
import { crispText } from "../crispText";
import { restFrameOf, stillFrameOf } from "../sheets";

/** Vanessa con Jerry. Siempre es el personaje controlable, sea quien sea quien tenga el turno (SPECS 1). */
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  private facing: Direction = "down";
  private moving = false;
  private marks: Phaser.GameObjects.Text[] = [];

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

  /**
   * Un «?» sobre Vanessa y otro sobre Jerry, que se preguntan qué pasó (al tocar la flor de la esquina). Se apaga solo; tocar de nuevo
   * lo reinicia. Con movimiento reducido aparece y desaparece sin saltar.
   */
  wonder(durationMs = 1600): void {
    const scene = this.sprite.scene;
    for (const m of this.marks) m.destroy();
    const b = this.sprite.getBounds();
    // Posiciones dentro de la hoja «de frente»: la cabeza de Vanessa arriba a la izquierda, la de Jerry abajo a la derecha.
    const spots = [
      { x: b.left + b.width * 0.4, y: b.top - 2, size: 42 },
      { x: b.left + b.width * 0.86, y: b.top + b.height * 0.48, size: 32 },
    ];
    this.marks = spots.map((p) =>
      crispText(scene.add.text(p.x, p.y, "?", { fontFamily: "Nunito Variable, Nunito, sans-serif", fontSize: `${p.size}px`, fontStyle: "bold", color: "#ffd84a", stroke: "#3b2a1a", strokeThickness: 5 }))
        .setOrigin(0.5, 1)
        .setDepth(this.sprite.depth + 1),
    );
    for (const m of this.marks) {
      if (!this.reducedMotion) scene.tweens.add({ targets: m, y: m.y - 10, duration: 220, yoyo: true, repeat: 2, ease: "Sine.easeOut" });
    }
    const marks = this.marks;
    scene.time.delayedCall(durationMs, () => {
      for (const m of marks) m.destroy();
      if (this.marks === marks) this.marks = [];
    });
  }

  get feet(): Point {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  destroy(): void {
    for (const m of this.marks) m.destroy();
    this.sprite.destroy();
  }
}
