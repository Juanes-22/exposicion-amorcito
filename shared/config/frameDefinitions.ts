// Definiciones de frames de la hoja de poses de Vanessa y Jerry (SPECS 9.4). NO forman parte de assets.json y no lo modifican:
// referencian el assetId real del catálogo. Copiadas de Bitácora Amorcito @041d326 y vueltas a comprobar contra la imagen en
// `npm run validate:project` y en scripts/frameDefinitions.test.ts (CT-15): una pose-sheet con `requiresFrameDefinition` no es un
// spritesheet hasta que sus frames se validan.
//
// La hoja NO es una cuadrícula regular: hay poses que cruzan los límites nominales de 362 px (el cabello de la fila «up», la
// cola de Jerry en «left»). Cada frame es la caja real de su pose con 4 px de margen transparente.
// `feetX`/`feetY` son el punto de apoyo (suelo bajo Vanessa) dentro del recorte, en píxeles de la textura; sirven de pivote
// para que el personaje no «salte» al cambiar de pose.

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

export const WALK_SHEET_ID = "character.vanessa-jerry.walk.poses-v4";

const walkFrames: readonly FrameSpec[] = [
  { name: "down-0", x: 66, y: 20, width: 261, height: 328, feetX: 115, feetY: 324 },
  { name: "down-1", x: 433, y: 20, width: 257, height: 328, feetX: 106, feetY: 324 },
  { name: "down-2", x: 794, y: 20, width: 259, height: 328, feetX: 110, feetY: 324 },
  { name: "left-0", x: 75, y: 374, width: 298, height: 329, feetX: 85, feetY: 325 },
  { name: "left-1", x: 434, y: 374, width: 296, height: 330, feetX: 88, feetY: 326 },
  { name: "left-2", x: 800, y: 374, width: 284, height: 330, feetX: 87, feetY: 326 },
  { name: "right-0", x: 74, y: 727, width: 293, height: 335, feetX: 108, feetY: 331 },
  { name: "right-1", x: 422, y: 727, width: 304, height: 335, feetX: 111, feetY: 331 },
  { name: "right-2", x: 792, y: 727, width: 290, height: 335, feetX: 105, feetY: 331 },
  { name: "up-0", x: 60, y: 1080, width: 289, height: 344, feetX: 109, feetY: 340 },
  { name: "up-1", x: 422, y: 1078, width: 289, height: 346, feetX: 113, feetY: 342 },
  { name: "up-2", x: 786, y: 1077, width: 281, height: 347, feetX: 114, feetY: 343 },
];

/** Cada fila es una dirección (`rowDirections` del manifiesto); la columna central es la pose de pie. */
const walkAnimation = (dir: string): AnimationSpec => ({ frames: [`${dir}-0`, `${dir}-1`, `${dir}-2`, `${dir}-1`], frameRate: 8, repeat: -1, restFrame: `${dir}-1` });

export const frameDefinitions: Readonly<Record<string, SheetDefinition>> = {
  [WALK_SHEET_ID]: {
    assetId: WALK_SHEET_ID,
    frames: walkFrames,
    animations: {
      "vanessa-idle": { frames: ["down-1"], frameRate: 1, repeat: -1, restFrame: "down-1" },
      "vanessa-walk-down": walkAnimation("down"),
      "vanessa-walk-left": walkAnimation("left"),
      "vanessa-walk-right": walkAnimation("right"),
      "vanessa-walk-up": walkAnimation("up"),
    },
  },
};

/** Clave global de una animación: incluye el assetId para que dos hojas puedan repetir nombres. */
export const animKey = (assetId: string, animId: string) => `${assetId}:${animId}`;
