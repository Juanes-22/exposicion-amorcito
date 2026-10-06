import { describe, expect, it } from "vitest";
import { describeShadow, rampAcceleration, rampDurationMs, rampDurationSeconds, rampProgress, shadowHeightCm } from "./models";

describe("Sombras: alturaSombra = h × (d + b) / d", () => {
  const h = 8;
  const b = 25;
  it("coincide con el modelo en los extremos del rango (d = 10…60 cm)", () => {
    expect(shadowHeightCm(10, b, h)).toBeCloseTo(28, 10); // 8 × 35 / 10
    expect(shadowHeightCm(60, b, h)).toBeCloseTo(11.3333, 4); // 8 × 85 / 60
  });
  it("es continua y estrictamente decreciente: acercar la linterna agranda la sombra", () => {
    let prev = Infinity;
    for (let d = 10; d <= 60; d += 0.5) {
      const s = shadowHeightCm(d, b, h);
      expect(s).toBeLessThan(prev);
      expect(s).toBeGreaterThan(h);
      prev = s;
    }
    // Sin saltos: pasos de 0,5 cm cambian la sombra poco.
    expect(Math.abs(shadowHeightCm(30, b, h) - shadowHeightCm(30.5, b, h))).toBeLessThan(0.2);
  });
  it("la descripción textual usa el mismo valor calculado", () => {
    const text = describeShadow(20, shadowHeightCm(20, b, h), h);
    expect(text).toContain("20 cm");
    expect(text).toContain("18 cm"); // 8 × 45 / 20
  });
});

describe("Rampas: a = (5/7) g sin θ, T = 2,4 · sqrt(2L/a)", () => {
  const L = 2;
  const scale = 2.4;
  it("reproduce los tiempos de referencia de SPECS 3.3 (≈3,56 s a 15° y ≈2,16 s a 45°)", () => {
    expect(rampDurationSeconds(15, L, scale)).toBeCloseTo(3.564, 2);
    expect(rampDurationSeconds(45, L, scale)).toBeCloseTo(2.156, 2);
  });
  it("la aceleración usa grados convertidos a radianes", () => {
    expect(rampAcceleration(30)).toBeCloseTo((5 / 7) * 9.81 * 0.5, 10);
  });
  it("más inclinación ⇒ menos tiempo, de forma monótona en todo el rango 15°–45° (paso de 5°)", () => {
    let prev = Infinity;
    for (let deg = 15; deg <= 45; deg += 5) {
      const t = rampDurationMs(deg, L, scale);
      expect(t).toBeLessThan(prev);
      expect(t).toBeGreaterThanOrEqual(2000);
      expect(t).toBeLessThanOrEqual(4000); // «2–4 segundos de animación activa»
      prev = t;
    }
  });
  it("la posición sigue s/L = min(1, (t/T)²): monótona, acotada y llega a la meta justo en T", () => {
    const T = rampDurationMs(30, L, scale);
    expect(rampProgress(0, T)).toBe(0);
    expect(rampProgress(T / 2, T)).toBeCloseTo(0.25, 10);
    expect(rampProgress(T, T)).toBe(1);
    expect(rampProgress(T * 3, T)).toBe(1);
    expect(rampProgress(-50, T)).toBe(0);
    let prev = -1;
    for (let t = 0; t <= T; t += 25) {
      const p = rampProgress(t, T);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});
