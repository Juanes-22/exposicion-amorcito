export interface Point {
  x: number;
  y: number;
}

/** Rectángulo por su esquina superior izquierda (convención de las colisiones de Tiled). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Direction = "up" | "down" | "left" | "right";

/** Huella del personaje: ocupa `x ± width/2` e `y-height…y` respecto del punto de pies (SPECS 8.3). */
export interface Footprint {
  width: number;
  height: number;
}
