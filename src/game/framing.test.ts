import { describe, expect, it } from "vitest";
import { easeCenter, fitFraming, followFraming, MAX_ZOOM, screenToWorld, worldToScreen } from "./framing";

const map = { width: 1280, height: 768 };

describe("encuadre de cámara", () => {
  it("la proyección ve el mapa entero centrado, sea cual sea la forma de la pantalla", () => {
    for (const view of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 2000, height: 500 }]) {
      const f = fitFraming(view, map);
      expect(f.centerX).toBe(640);
      expect(f.centerY).toBe(384);
      expect(map.width * f.zoom).toBeLessThanOrEqual(view.width + 1e-9);
      expect(map.height * f.zoom).toBeLessThanOrEqual(view.height + 1e-9);
      expect(Math.max(map.width * f.zoom - view.width, map.height * f.zoom - view.height)).toBeCloseTo(0, 6); // una dimensión justa
    }
  });

  it("el teléfono vertical sigue a Vanessa con una ampliación mucho mayor que la del mapa entero", () => {
    const phone = { width: 390, height: 844 };
    const fit = fitFraming(phone, map);
    const f = followFraming(phone, map, { x: 640, y: 600 });
    expect(f.zoom).toBeGreaterThan(fit.zoom * 2);
    expect(phone.width / f.zoom).toBeCloseTo(520, 5); // se ven ~520 px de mundo de ancho
    expect(f.centerX).toBe(640);
  });

  it("nunca muestra fuera del mapa: el centro se acota en los bordes", () => {
    const phone = { width: 390, height: 844 };
    const left = followFraming(phone, map, { x: 20, y: 40 });
    const right = followFraming(phone, map, { x: 1270, y: 760 });
    for (const f of [left, right]) {
      const halfW = phone.width / f.zoom / 2;
      const halfH = phone.height / f.zoom / 2;
      expect(f.centerX - halfW).toBeGreaterThanOrEqual(-1e-9);
      expect(f.centerX + halfW).toBeLessThanOrEqual(map.width + 1e-9);
      if (halfH * 2 < map.height) {
        expect(f.centerY - halfH).toBeGreaterThanOrEqual(-1e-9);
        expect(f.centerY + halfH).toBeLessThanOrEqual(map.height + 1e-9);
      }
    }
  });

  it("si el mapa cabe en un eje lo centra en ese eje en lugar de acotarlo", () => {
    const tall = { width: 390, height: 844 };
    const f = followFraming(tall, map, { x: 640, y: 10 });
    expect(f.centerY).toBe(map.height / 2); // 844/zoom ≥ 768: cabe de arriba abajo
  });

  it("en horizontal usa un mundo más ancho y respeta el zoom máximo", () => {
    const laptop = { width: 1440, height: 800 };
    const f = followFraming(laptop, map, { x: 300, y: 300 });
    expect(laptop.width / f.zoom).toBeCloseTo(Math.min(900, laptop.width / fitFraming(laptop, map).zoom), 3);
    expect(followFraming({ width: 5000, height: 4000 }, map, { x: 0, y: 0 }).zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("pantalla ↔ mundo son inversas y el centro de la vista cae en el centro del encuadre", () => {
    const view = { width: 390, height: 844 };
    const f = followFraming(view, map, { x: 700, y: 500 });
    expect(screenToWorld(view, f, { x: view.width / 2, y: view.height / 2 })).toEqual({ x: f.centerX, y: f.centerY });
    for (const p of [{ x: 0, y: 0 }, { x: 390, y: 844 }, { x: 123, y: 456 }]) {
      const w = screenToWorld(view, f, p);
      const back = worldToScreen(view, f, w);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("tocar la esquina del mapa en la vista completa da la esquina del mundo", () => {
    const view = { width: 1280, height: 720 };
    const f = fitFraming(view, map);
    const topLeft = worldToScreen(view, f, { x: 0, y: 0 });
    expect(screenToWorld(view, f, topLeft)).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(view, f, worldToScreen(view, f, { x: 1280, y: 768 }))).toEqual({ x: 1280, y: 768 });
  });

  it("entradas degeneradas (vista de 0 px) no producen NaN", () => {
    const f = followFraming({ width: 0, height: 0 }, map, { x: 1, y: 1 });
    expect(Number.isFinite(f.zoom) && Number.isFinite(f.centerX) && Number.isFinite(f.centerY)).toBe(true);
  });

  it("el suavizado converge, no depende de los FPS y se desactiva con movimiento reducido", () => {
    const a = { zoom: 1, centerX: 0, centerY: 0 };
    const b = { zoom: 2, centerX: 100, centerY: 50 };
    let fast = a;
    for (let i = 0; i < 120; i++) fast = easeCenter(fast, b, 8, false); // 120 pasos de 8 ms ≈ 1 s
    let slow = a;
    for (let i = 0; i < 20; i++) slow = easeCenter(slow, b, 48, false); // 20 pasos de 48 ms ≈ 1 s
    expect(fast.centerX).toBeCloseTo(slow.centerX, 1);
    expect(fast.centerX).toBeGreaterThan(95);
    expect(easeCenter(a, b, 16, true)).toEqual(b);
    expect(easeCenter(a, b, 0, false)).toEqual(a);
  });
});
