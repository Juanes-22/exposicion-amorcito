import Phaser from "phaser";
import { PARTICIPANT_COLORS } from "../../../shared/contracts/limits";
import type { Point } from "../../../shared/contracts/geometry";
import { crispText } from "../crispText";
import { FONT } from "../scenes/activityShared";

/**
 * El personaje de cada persona en el laboratorio compartido: una silueta sencilla de un sistema común, coloreada con el color de la
 * persona (propuesta de rondas, sección 3). No hay retratos ni fotos. El propio se ve con más énfasis y los demás, con menos; el
 * nombre de cada persona está siempre encima de su avatar. Si dos personajes se cruzan, sus nombres simplemente se superponen: el de
 * quien mira queda por encima de todos, y entre los demás se ve por encima el del personaje que está más abajo en el mapa.
 */
/** Profundidad del rótulo propio: siempre por encima de los de los demás, que usan la coordenada y de sus pies. */
const OWN_LABEL_DEPTH = 1_000_000;
export const SILHOUETTE_W = 34;
export const SILHOUETTE_H = 56;
const textureKey = (colorId: string | null) => `silhouette.${colorId ?? "none"}`;
const hexNumber = (hex: string) => Number.parseInt(hex.replace("#", ""), 16);

/** Una textura por color, generada una vez por escena. Los pies quedan en la base de la imagen. */
export function ensureSilhouetteTextures(scene: Phaser.Scene): void {
  const colors: Array<{ id: string | null; hex: string }> = [...PARTICIPANT_COLORS.map((c) => ({ id: c.id as string | null, hex: c.hex as string })), { id: null, hex: "#8b7b66" }];
  for (const c of colors) {
    const key = textureKey(c.id);
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const fill = hexNumber(c.hex);
    const cx = SILHOUETTE_W / 2;
    g.fillStyle(0x000000, 0.28).fillEllipse(cx, SILHOUETTE_H - 3, SILHOUETTE_W * 0.9, 8); // sombra en el suelo
    g.fillStyle(fill, 1).fillRoundedRect(cx - 12, 26, 24, 26, { tl: 11, tr: 11, bl: 5, br: 5 }); // cuerpo
    g.fillStyle(fill, 1).fillCircle(cx, 16, 11); // cabeza
    g.lineStyle(2, 0x3b2a1a, 0.85).strokeRoundedRect(cx - 12, 26, 24, 26, { tl: 11, tr: 11, bl: 5, br: 5 }).strokeCircle(cx, 16, 11);
    g.generateTexture(key, SILHOUETTE_W, SILHOUETTE_H);
    g.destroy();
  }
}

export interface CharacterOptions {
  own: boolean;
  colorId: string | null;
  displayName: string;
}

export class CharacterView {
  readonly image: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Ellipse | null;
  private readonly label: Phaser.GameObjects.Text;
  private connected = true;

  constructor(
    scene: Phaser.Scene,
    feet: Point,
    private readonly options: CharacterOptions,
  ) {
    const scale = options.own ? 1.15 : 0.9;
    this.image = scene.add.image(feet.x, feet.y, textureKey(options.colorId)).setOrigin(0.5, 1).setScale(scale).setAlpha(options.own ? 1 : 0.8).setDepth(feet.y);
    this.ring = options.own ? scene.add.ellipse(feet.x, feet.y - 2, 44, 16).setStrokeStyle(3, 0xffffff, 0.95).setFillStyle(0xffffff, 0.12).setDepth(feet.y - 1) : null;
    this.label = crispText(scene.add.text(feet.x, feet.y - SILHOUETTE_H * scale - 6, options.displayName, { fontFamily: FONT, fontSize: "15px", fontStyle: "bold", color: "#fff8e6", backgroundColor: "#3b2a1acc", padding: { x: 5, y: 2 } })).setOrigin(0.5, 1);
  }

  /** `zoom`: el de la cámara. Con el laboratorio entero a la vista el rótulo crece un poco (hasta 1,3 veces) para que se siga leyendo; no más. */
  place(feet: Point, zoom = 1): void {
    const labelScale = Math.min(Math.max(0.75 / (zoom > 0 ? zoom : 1), 1), 1.3);
    this.image.setPosition(feet.x, feet.y).setDepth(feet.y);
    this.ring?.setPosition(feet.x, feet.y - 2).setDepth(feet.y - 1);
    this.label.setScale(labelScale).setPosition(feet.x, feet.y - this.image.displayHeight - 4).setDepth(this.options.own ? OWN_LABEL_DEPTH : feet.y + 1000);
  }

  /** El nombre siempre está a la vista; el propio lleva «(tú)» y quien perdió la conexión lo dice con texto además de verse más pálida. */
  update(displayName: string, connected: boolean): void {
    const text = this.options.own ? `${displayName} (tú)` : connected ? displayName : `${displayName} · sin conexión`;
    if (this.label.text !== text) this.label.setText(text);
    if (connected !== this.connected) {
      this.connected = connected;
      this.image.setAlpha(this.options.own ? 1 : connected ? 0.8 : 0.4);
    }
  }

  get feet(): Point {
    return { x: this.image.x, y: this.image.y };
  }

  destroy(): void {
    this.image.destroy();
    this.ring?.destroy();
    this.label.destroy();
  }
}

