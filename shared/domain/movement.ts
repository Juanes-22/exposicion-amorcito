import type { Direction, Point } from "../contracts/geometry";
import type { MovementPlan } from "../contracts/state";

/** Plan de movimiento: lo calcula el servidor; cliente y proyección lo interpolan sin enviar posiciones a 60 FPS (SPECS 5.6). */

export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

export function createPlan(planId: string, points: Point[], speed: number, startActiveMs: number): MovementPlan {
  return { planId, points, speed, startActiveMs, lengthTotal: pathLength(points) };
}

export function directionOf(from: Point, to: Point, fallback: Direction = "down"): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export interface PlanSample {
  feet: Point;
  facing: Direction;
  /** `true` cuando el plan ya llegó a su último punto. */
  done: boolean;
}

/** Duración total del plan en ms de reloj activo. */
export const planDurationMs = (plan: MovementPlan): number => (plan.speed > 0 ? (plan.lengthTotal / plan.speed) * 1000 : 0);

/** Posición del plan en un instante de reloj activo. Determinista: depende solo del plan y del reloj. */
export function samplePlan(plan: MovementPlan, activeMs: number, fallbackFacing: Direction = "down"): PlanSample {
  const pts = plan.points;
  const last = pts[pts.length - 1]!;
  const traveled = Math.max(0, ((activeMs - plan.startActiveMs) / 1000) * plan.speed);
  if (pts.length < 2 || traveled >= plan.lengthTotal) {
    const prev = pts.length >= 2 ? pts[pts.length - 2]! : last;
    return { feet: last, facing: directionOf(prev, last, fallbackFacing), done: true };
  }
  let remaining = traveled;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= len && len > 0) {
      const t = remaining / len;
      return { feet: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, facing: directionOf(a, b, fallbackFacing), done: false };
    }
    remaining -= len;
  }
  return { feet: last, facing: fallbackFacing, done: true };
}
