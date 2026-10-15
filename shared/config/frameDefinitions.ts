// Definiciones de frames de la hoja de poses de Vanessa y Jerry (SPECS 9.4). NO forman parte de assets.json y no lo modifican:
// referencian el assetId real del catálogo y se comprueban contra la imagen en `npm run validate:project` y en
// scripts/frameDefinitions.test.ts (CT-15): una pose-sheet con `requiresFrameDefinition` no es un spritesheet hasta que sus frames se
// validan.
//
// La hoja v5 (15 de octubre de 2026) tiene a Vanessa y Jerry DE PIE en cuatro direcciones (filas) y tres columnas: ojos abiertos,
// parpadeo y ojos abiertos. No es una cuadrícula regular: hay poses que cruzan los límites nominales de 362 px. Cada frame es la caja
// real de su pose con 4 px de margen transparente.
// `feetX`/`feetY` son el punto de apoyo (el suelo bajo los zapatos de Vanessa) dentro del recorte, en píxeles de la textura; sirven de
// pivote para que el personaje no «salte» al cambiar de pose. Jerry queda un poco más abajo: está delante de ella.

export interface FrameSpec {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  feetX: number;
  feetY: number;
}

export interface AnimationSpec {
  frames: readonly string[];
  frameRate: number;
  /** -1 = bucle. */
  repeat: number;
  /** Pose con la que se queda el personaje al detenerse. */
  restFrame?: string;
  /** Pose estática que se muestra en lugar de animar cuando se pide movimiento reducido. */
  stillFrame?: string;
}

export interface SheetDefinition {
  assetId: string;
  frames: readonly FrameSpec[];
  animations: Readonly<Record<string, AnimationSpec>>;
}

export const WALK_SHEET_ID = "character.vanessa-jerry.stand.poses-v5";

const walkFrames: readonly FrameSpec[] = [
  { name: "down-0", x: 65, y: 20, width: 270, height: 330, feetX: 114, feetY: 319 },
  { name: "down-1", x: 428, y: 20, width: 264, height: 330, feetX: 112, feetY: 319 },
  { name: "down-2", x: 790, y: 20, width: 267, height: 330, feetX: 112, feetY: 319 },
  { name: "left-0", x: 74, y: 369, width: 288, height: 333, feetX: 88, feetY: 327 },
  { name: "left-1", x: 433, y: 369, width: 291, height: 333, feetX: 90, feetY: 327 },
  { name: "left-2", x: 797, y: 369, width: 283, height: 333, feetX: 91, feetY: 327 },
  { name: "right-0", x: 72, y: 722, width: 293, height: 336, feetX: 114, feetY: 331 },
  { name: "right-1", x: 432, y: 723, width: 292, height: 336, feetX: 112, feetY: 330 },
  { name: "right-2", x: 795, y: 723, width: 285, height: 336, feetX: 114, feetY: 330 },
  { name: "up-0", x: 60, y: 1073, width: 298, height: 340, feetX: 112, feetY: 333 },
  { name: "up-1", x: 422, y: 1073, width: 295, height: 339, feetX: 114, feetY: 333 },
  { name: "up-2", x: 785, y: 1073, width: 283, height: 340, feetX: 114, feetY: 333 },
];

/**
 * De pie en una dirección, con un parpadeo cada tanto (la columna central). La hoja no tiene pasos: si el personaje se desplaza,
 * se mueve con esta misma animación. `restFrame` (ojos abiertos) es la pose sin animar y `stillFrame` la de movimiento reducido.
 */
const standAnimation = (dir: string): AnimationSpec => ({
  frames: [`${dir}-0`, `${dir}-0`, `${dir}-0`, `${dir}-0`, `${dir}-0`, `${dir}-0`, `${dir}-0`, `${dir}-0`, `${dir}-1`, `${dir}-2`, `${dir}-2`, `${dir}-2`, `${dir}-2`, `${dir}-2`, `${dir}-2`, `${dir}-2`, `${dir}-1`, `${dir}-0`],
  frameRate: 6,
  repeat: -1,
  restFrame: `${dir}-0`,
  stillFrame: `${dir}-0`,
});

export const frameDefinitions: Readonly<Record<string, SheetDefinition>> = {
  [WALK_SHEET_ID]: {
    assetId: WALK_SHEET_ID,
    frames: walkFrames,
    animations: {
      "vanessa-idle": standAnimation("down"),
      "vanessa-idle-down": standAnimation("down"),
      "vanessa-idle-left": standAnimation("left"),
      "vanessa-idle-right": standAnimation("right"),
      "vanessa-idle-up": standAnimation("up"),
      "vanessa-walk-down": standAnimation("down"),
      "vanessa-walk-left": standAnimation("left"),
      "vanessa-walk-right": standAnimation("right"),
      "vanessa-walk-up": standAnimation("up"),
    },
  },
};

/** Clave global de una animación: incluye el assetId para que dos hojas puedan repetir nombres. */
export const animKey = (assetId: string, animId: string) => `${assetId}:${animId}`;
