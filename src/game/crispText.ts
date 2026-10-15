import Phaser from "phaser";

/** Resolución con la que se dibuja el texto del mapa: la cámara lo amplía o reduce, así que se rasteriza con margen. */
export const textResolution = (): number => Math.min(4, Math.max(2, Math.ceil(window.devicePixelRatio || 1) * 2));

/**
 * Texto nítido en el mapa. Un texto de Phaser se rasteriza a resolución 1 y, con `pixelArt`, se amplía sin suavizar: se ve borroso. Se
 * rasteriza a mayor resolución y su textura se filtra de forma lineal (el resto del juego conserva el filtro de píxeles).
 */
export function crispText<T extends Phaser.GameObjects.Text>(text: T): T {
  text.setResolution(textResolution());
  text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return text;
}
