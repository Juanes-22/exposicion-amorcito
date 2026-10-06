import { rampProgress } from "../../../shared/domain/models";

/** Rampa vista de lado: la parte baja queda fija a la derecha y la inclinación levanta el extremo de la izquierda. */
export const RAMP_LENGTH_PX = 540;
export const GROUND_Y = 420;
export const RAMP_BOTTOM_X = 800;
export const BALL_RADIUS_PX = 16;

export interface RampLayout {
  top: { x: number; y: number };
  bottom: { x: number; y: number };
  /** Centro de la pelota, apoyada sobre la superficie. */
  ball: { x: number; y: number };
  /** Fracción recorrida usada para colocar la pelota. */
  progress: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** `progress` ∈ [0,1] (0 = arriba, 1 = en la meta). Viene de `rampProgress`, el modelo compartido: `s/L = min(1, (t/T)²)`. */
export function rampLayout(angleDeg: number, progress: number): RampLayout {
  const a = rad(angleDeg);
  const bottom = { x: RAMP_BOTTOM_X, y: GROUND_Y };
  const top = { x: bottom.x - RAMP_LENGTH_PX * Math.cos(a), y: bottom.y - RAMP_LENGTH_PX * Math.sin(a) };
  const p = Math.min(1, Math.max(0, progress));
  const along = { x: top.x + (bottom.x - top.x) * p, y: top.y + (bottom.y - top.y) * p };
  // La normal de la superficie apunta hacia arriba y a la derecha en una rampa que baja hacia la derecha.
  const ball = { x: along.x + BALL_RADIUS_PX * Math.sin(a), y: along.y - BALL_RADIUS_PX * Math.cos(a) };
  return { top, bottom, ball, progress: p };
}

/** Posición de la pelota en un instante: el tiempo transcurrido de la simulación visual lo decide el reloj, no el dispositivo. */
export const rampLayoutAt = (angleDeg: number, elapsedMs: number, durationMs: number): RampLayout => rampLayout(angleDeg, rampProgress(elapsedMs, durationMs));
