import { describe, expect, it } from "vitest";
import { describeShadow } from "../../../shared/domain/models";
import { BALL_RADIUS_PX, RAMP_LENGTH_PX, rampLayout, rampLayoutAt } from "./ramps";
import { fitsStage, shadowLayout, SHADOWS_SCALE_PX_PER_CM } from "./shadows";
import { STAGE } from "./stage";

// Parámetros de la configuración real (public/config/laboratorio.json).
const D_MIN = 10;
const D_MAX = 60;
const B = 25;
const H = 8;

describe("dibujo de Sombras = modelo (SPECS 3.2)", () => {
  it("los rayos del dibujo son colineales con la fórmula h·(d+b)/d en todo el rango (el dibujo no tiene tamaños propios)", () => {
    for (let d = D_MIN; d <= D_MAX; d += 0.5) {
      const l = shadowLayout(d, B, H);
      // Recta fuente → punta del objeto, prolongada hasta la pantalla.
      const slope = (l.objectTopY - l.tableY) / (l.objectX - l.sourceX);
      const yOnScreen = l.tableY + slope * (l.screenX - l.sourceX);
      expect(yOnScreen).toBeCloseTo(l.shadowTopY, 6);
      expect((l.tableY - l.shadowTopY) / SHADOWS_SCALE_PX_PER_CM).toBeCloseTo((H * (d + B)) / d, 6);
    }
  });

  it("acercar la linterna agranda la sombra y alejarla la reduce, de forma continua", () => {
    let prev = Infinity;
    for (let d = D_MIN; d <= D_MAX; d += 1) {
      const l = shadowLayout(d, B, H);
      expect(l.shadowHeightPx).toBeLessThan(prev);
      prev = l.shadowHeightPx;
      expect(l.shadowHeightPx).toBeGreaterThan(l.objectHeightPx); // siempre mayor que el objeto: «¿por qué su sombra se ve tan grande?»
    }
  });

  it("la distancia dibujada de la fuente es proporcional a d y la pantalla queda a b del objeto", () => {
    const a = shadowLayout(20, B, H);
    const b = shadowLayout(40, B, H);
    expect(a.objectX - a.sourceX).toBeCloseTo(20 * SHADOWS_SCALE_PX_PER_CM, 9);
    expect(b.objectX - b.sourceX).toBeCloseTo(40 * SHADOWS_SCALE_PX_PER_CM, 9);
    expect(a.screenX - a.objectX).toBeCloseTo(B * SHADOWS_SCALE_PX_PER_CM, 9);
    expect(a.screenX).toBe(b.screenX); // la pantalla y el objeto están fijos
  });

  it("con la configuración real todo cabe en el escenario y la sombra no se recorta", () => {
    expect(fitsStage(D_MAX, B)).toBe(true);
    const near = shadowLayout(D_MIN, B, H);
    expect(near.clipped).toBe(false);
    expect(near.shadowTopY).toBeGreaterThan(0);
    expect(near.screenX).toBeLessThan(STAGE.width);
  });

  it("si una configuración futura no cabe, la sombra se recorta al escenario en lugar de salirse", () => {
    const huge = shadowLayout(1, B, 20); // sombra de 520 cm
    expect(huge.clipped).toBe(true);
    expect(huge.shadowTopY).toBeGreaterThanOrEqual(0);
  });

  it("la descripción textual y el dibujo salen del mismo modelo: la sombra que se dibuja más grande se describe más grande", () => {
    const exp = { sourceDistanceMinCm: 10, sourceDistanceMaxCm: 60, screenDistanceCm: B, objectHeightCm: H, minDistinctDistanceCm: 5, requiredSamples: 2 };
    expect(shadowLayout(10, B, H).shadowHeightPx).toBeGreaterThan(shadowLayout(60, B, H).shadowHeightPx);
    expect(describeShadow(exp, 10)).toContain("muy grande");
    expect(describeShadow(exp, 60)).toContain("pequeña");
  });
});

describe("dibujo de Rampas = modelo (SPECS 3.3)", () => {
  it("la pelota va de arriba (0) a la meta (1) a lo largo de la rampa, apoyada sobre la superficie", () => {
    for (const deg of [15, 30, 45]) {
      const start = rampLayout(deg, 0);
      const end = rampLayout(deg, 1);
      expect(Math.hypot(end.bottom.x - start.top.x, end.bottom.y - start.top.y)).toBeCloseTo(RAMP_LENGTH_PX, 6);
      expect(start.top.y).toBeLessThan(start.bottom.y); // el extremo inclinado está arriba
      // Distancia de la pelota a la recta de la rampa = su radio, en cualquier punto del recorrido.
      for (const p of [0, 0.3, 0.77, 1]) {
        const l = rampLayout(deg, p);
        const ux = (l.bottom.x - l.top.x) / RAMP_LENGTH_PX;
        const uy = (l.bottom.y - l.top.y) / RAMP_LENGTH_PX;
        const dist = Math.abs((l.ball.x - l.top.x) * uy - (l.ball.y - l.top.y) * ux);
        expect(dist).toBeCloseTo(BALL_RADIUS_PX, 6);
      }
    }
  });

  it("mayor inclinación = rampa más alta; la base queda fija", () => {
    const low = rampLayout(15, 0);
    const high = rampLayout(45, 0);
    expect(high.top.y).toBeLessThan(low.top.y);
    expect(high.bottom).toEqual(low.bottom);
  });

  it("el recorrido sigue s/L = min(1, (t/T)²): a mitad de tiempo ha recorrido un cuarto, y al final llega a la meta", () => {
    const T = 3000;
    expect(rampLayoutAt(30, 0, T).progress).toBe(0);
    expect(rampLayoutAt(30, T / 2, T).progress).toBeCloseTo(0.25, 9);
    expect(rampLayoutAt(30, T, T).progress).toBe(1);
    expect(rampLayoutAt(30, T * 5, T).progress).toBe(1);
    let prev = -1;
    for (let t = 0; t <= T; t += 50) {
      const p = rampLayoutAt(30, t, T).progress;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("todo el dibujo cabe en el escenario con las inclinaciones configuradas", () => {
    for (const deg of [15, 20, 25, 30, 35, 40, 45]) {
      const l = rampLayout(deg, 0);
      expect(l.top.x).toBeGreaterThanOrEqual(0);
      expect(l.top.y).toBeGreaterThanOrEqual(0);
      expect(l.bottom.x).toBeLessThanOrEqual(STAGE.width);
      expect(l.bottom.y).toBeLessThanOrEqual(STAGE.height);
    }
  });
});
