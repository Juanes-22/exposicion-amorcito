import { shadowHeightCm } from "../../../shared/domain/models";
import { STAGE } from "./stage";

/**
 * Geometría del dibujo de Sombras, vista de lado. Es el MISMO valor que usa la descripción textual (`shadowHeightCm`): el dibujo
 * no tiene tamaños propios ni imágenes fijas (SPECS 3.2). La fuente está a nivel de la mesa y el objeto sobre ella, de modo que la
 * recta fuente → punta del objeto llega a la pantalla exactamente a `h · (d + b) / d` de altura.
 */
export const SHADOWS_SCALE_PX_PER_CM = 6.5;
const OBJECT_X = 430;
export const TABLE_Y = 392;
const OBJECT_WIDTH_PX = 22;
/** Margen superior mínimo: la sombra no se sale del escenario aunque la configuración cambie. */
const TOP_MARGIN_PX = 54;

export interface ShadowLayout {
  scale: number;
  tableY: number;
  sourceX: number;
  objectX: number;
  screenX: number;
  objectWidthPx: number;
  objectHeightPx: number;
  objectTopY: number;
  shadowCm: number;
  /** Altura de la sombra en la pantalla, en px (ya acotada al escenario). */
  shadowHeightPx: number;
  shadowTopY: number;
  /** `true` si la sombra se recortó por no caber en el escenario. */
  clipped: boolean;
}

export function shadowLayout(distanceCm: number, screenDistanceCm: number, objectHeightCm: number): ShadowLayout {
  const k = SHADOWS_SCALE_PX_PER_CM;
  const shadowCm = shadowHeightCm(distanceCm, screenDistanceCm, objectHeightCm);
  const maxPx = TABLE_Y - TOP_MARGIN_PX;
  const rawPx = shadowCm * k;
  const shadowHeightPx = Math.min(rawPx, maxPx);
  return {
    scale: k,
    tableY: TABLE_Y,
    sourceX: OBJECT_X - distanceCm * k,
    objectX: OBJECT_X,
    screenX: OBJECT_X + screenDistanceCm * k,
    objectWidthPx: OBJECT_WIDTH_PX,
    objectHeightPx: objectHeightCm * k,
    objectTopY: TABLE_Y - objectHeightCm * k,
    shadowCm,
    shadowHeightPx,
    shadowTopY: TABLE_Y - shadowHeightPx,
    clipped: rawPx > maxPx,
  };
}

/** ¿Caben en el escenario la fuente más lejana y la pantalla? Lo comprueban las pruebas con la configuración real. */
export function fitsStage(maxDistanceCm: number, screenDistanceCm: number): boolean {
  const l = shadowLayout(maxDistanceCm, screenDistanceCm, 1);
  return l.sourceX >= 24 && l.screenX <= STAGE.width - 24;
}
