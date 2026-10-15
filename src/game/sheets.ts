import type Phaser from "phaser";
import { animKey, frameDefinitions } from "../../shared/config/frameDefinitions";

/**
 * Registra los frames explícitos de una hoja de poses (pivote en los pies) y sus animaciones. Idempotente: se puede volver a
 * llamar al reiniciar la escena sin crear nada global duplicado. Sin definición de frames devuelve `false`: ese recurso no es un
 * spritesheet y solo puede usarse como imagen estática (CT-15).
 */
export function ensureSheet(scene: Phaser.Scene, assetId: string): boolean {
  const def = frameDefinitions[assetId];
  if (!def || !scene.textures.exists(assetId)) return false;
  const texture = scene.textures.get(assetId);
  for (const f of def.frames) {
    if (texture.has(f.name)) continue;
    const frame = texture.add(f.name, 0, f.x, f.y, f.width, f.height);
    if (!frame) continue;
    frame.customPivot = true;
    frame.pivotX = f.feetX / f.width;
    frame.pivotY = f.feetY / f.height;
  }
  for (const [animId, a] of Object.entries(def.animations)) {
    const key = animKey(assetId, animId);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({ key, frames: a.frames.map((frame) => ({ key: assetId, frame })), frameRate: a.frameRate, repeat: a.repeat });
  }
  return true;
}

export function restFrameOf(assetId: string, animId: string): string | undefined {
  return frameDefinitions[assetId]?.animations[animId]?.restFrame;
}

export function stillFrameOf(assetId: string, animId: string): string | undefined {
  return frameDefinitions[assetId]?.animations[animId]?.stillFrame;
}
