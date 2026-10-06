import { describe, expect, it } from "vitest";
import { realBundle } from "../testing/project";
import { buildNavGrid, findPath, isFootprintFree, segmentFree, type Obstacles } from "./navigation";
import { createPlan, planDurationMs, samplePlan } from "./movement";

const bundle = realBundle();
const { map, nav, config } = bundle;
const fp = config.world.player.footprint;
const spawn = map.spawns[config.world.initialSpawnId]!;

/** Comprobación independiente de la prueba exacta del planificador: muestrea cada 0,5 px con la prueba de punto. */
const pathIsClear = (points: { x: number; y: number }[], obstacles: Obstacles = map, footprint = fp) =>
  points.slice(1).every((b, i) => {
    const a = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
    for (let k = 0; k <= n; k++) if (!isFootprintFree(obstacles, footprint, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
    return true;
  });

describe("navegación sobre el mapa real (CT-03)", () => {
  it("el spawn, las estaciones y el inventor son suelo libre y alcanzables", () => {
    expect(isFootprintFree(map, fp, spawn)).toBe(true);
    for (const target of [...map.stations.map((s) => s.point), map.inventor!.point]) {
      expect(isFootprintFree(map, fp, target)).toBe(true);
      const path = findPath(map, fp, nav, spawn, target);
      expect(path, JSON.stringify(target)).not.toBeNull();
      expect(path![0]).toEqual(spawn);
      expect(path![path!.length - 1]).toEqual(target);
      expect(pathIsClear(path!)).toBe(true);
    }
  });

  it("ningún trayecto entre puntos aleatorios atraviesa obstáculos (comprobación independiente cada 0,5 px)", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let planned = 0;
    let refused = 0;
    for (let i = 0; i < 150; i++) {
      const a = { x: rnd() * map.widthPx, y: rnd() * map.heightPx };
      const b = { x: rnd() * map.widthPx, y: rnd() * map.heightPx };
      if (!isFootprintFree(map, fp, a)) continue;
      const path = findPath(map, fp, nav, a, b);
      if (path) {
        planned++;
        expect(isFootprintFree(map, fp, b)).toBe(true);
        expect(pathIsClear(path), `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
      } else refused++;
    }
    expect(planned).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(0); // hay destinos dentro de paredes o mesas
  });

  it("tocar dentro de una pared, una mesa o fuera del mapa se rechaza; tocar tras la mesa rodea la mesa", () => {
    expect(findPath(map, fp, nav, spawn, { x: 640, y: 100 })).toBeNull(); // pared superior
    expect(findPath(map, fp, nav, spawn, { x: 640, y: 270 })).toBeNull(); // sobre la mesa de rampas
    expect(findPath(map, fp, nav, spawn, { x: -5, y: 300 })).toBeNull();
    expect(findPath(map, fp, nav, spawn, { x: Number.NaN, y: 300 })).toBeNull();
    expect(findPath(map, fp, nav, spawn, { x: 5000, y: 300 })).toBeNull();
    const behind = findPath(map, fp, nav, { x: 640, y: 330 }, { x: 640, y: 190 });
    expect(behind).not.toBeNull();
    expect(behind!.length).toBeGreaterThan(2); // no cruza la mesa: la rodea
    expect(pathIsClear(behind!)).toBe(true);
  });

  it("la huella usa pies como origen: x ± width/2 e y-height…y", () => {
    // La pared inferior empieza en y=736: los pies pueden llegar a 768 (borde del mapa) si no hay pared; con pared, hasta 736.
    expect(isFootprintFree(map, fp, { x: 300, y: 736 })).toBe(true); // la huella ocupa 711…736: roza la pared sin solaparla
    expect(isFootprintFree(map, fp, { x: 300, y: 737 })).toBe(false);
    // Lateral: la pared izquierda ocupa hasta x=32; los pies deben estar a ≥ 32 + 21.
    expect(isFootprintFree(map, fp, { x: 53, y: 400 })).toBe(true);
    expect(isFootprintFree(map, fp, { x: 52.9, y: 400 })).toBe(false);
  });
});

describe("esquinas bloqueadas", () => {
  // Dos cuadrantes libres que solo se tocan en el vértice (100,100): una huella de 10×10 no puede pasar por ahí.
  const corner: Obstacles = {
    widthPx: 200,
    heightPx: 200,
    collisions: [
      { x: 0, y: 100, width: 100, height: 100 },
      { x: 100, y: 0, width: 100, height: 100 },
    ],
  };
  const small = { width: 10, height: 10 };
  it("no atraviesa la unión en diagonal de dos obstáculos", () => {
    const grid = buildNavGrid(corner, small, 4);
    expect(isFootprintFree(corner, small, { x: 50, y: 50 })).toBe(true);
    expect(isFootprintFree(corner, small, { x: 150, y: 160 })).toBe(true);
    expect(findPath(corner, small, grid, { x: 50, y: 50 }, { x: 150, y: 160 })).toBeNull();
  });
  it("detecta un roce de esquina de ~0,15 px que un muestreo de 0,5 px no ve (prueba exacta)", () => {
    const wall: Obstacles = { widthPx: 100, heightPx: 100, collisions: [{ x: 50, y: 40, width: 20, height: 20 }] };
    const f = { width: 10, height: 10 };
    // Para esta huella, los pies solapan el obstáculo dentro de (45,75)×(40,70). La recta y = 130,3 − 2x entra en ese rectángulo
    // solo para x ∈ (45; 45,15): un roce de la esquina superior izquierda.
    const clip = { a: { x: 35, y: 60.3 }, b: { x: 55, y: 20.3 } };
    const clear = { a: { x: 35, y: 59.8 }, b: { x: 55, y: 19.8 } }; // la misma recta desplazada 0,5 px: no la toca
    const sampled = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5);
      for (let k = 0; k <= n; k++) if (!isFootprintFree(wall, f, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
      return true;
    };
    expect(sampled(clip.a, clip.b)).toBe(true); // el muestreo grueso lo daría por bueno…
    expect(segmentFree(wall, f, clip.a, clip.b)).toBe(false); // …la prueba exacta no
    expect(segmentFree(wall, f, clear.a, clear.b)).toBe(true);
  });

  it("rozar un borde no es chocar, pero entrar en el obstáculo sí", () => {
    const wall: Obstacles = { widthPx: 100, heightPx: 100, collisions: [{ x: 50, y: 40, width: 20, height: 20 }] };
    const f = { width: 10, height: 10 };
    expect(segmentFree(wall, f, { x: 20, y: 40 }, { x: 80, y: 40 })).toBe(true); // la base de la huella (y=40) apenas roza el lado superior
    expect(segmentFree(wall, f, { x: 20, y: 41 }, { x: 80, y: 41 })).toBe(false);
    expect(segmentFree(wall, f, { x: 20, y: 52 }, { x: 80, y: 52 })).toBe(false); // de frente
    expect(segmentFree(wall, f, { x: 60, y: 50 }, { x: 60, y: 50 })).toBe(false); // parado dentro
    expect(segmentFree(wall, f, { x: 3, y: 50 }, { x: 40, y: 50 })).toBe(false); // sale por la izquierda del mapa (x−5 < 0)
  });

  it("sí rodea cuando hay paso libre", () => {
    const open: Obstacles = { widthPx: 200, heightPx: 200, collisions: [{ x: 0, y: 100, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 70 }] };
    const grid = buildNavGrid(open, small, 4);
    const path = findPath(open, small, grid, { x: 50, y: 50 }, { x: 150, y: 160 });
    expect(path).not.toBeNull();
    expect(pathIsClear(path!, open, small)).toBe(true);
  });
});

describe("plan de movimiento", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ];
  const plan = createPlan("m1", points, 50, 1000);
  it("mide la longitud y la duración con la velocidad del plan", () => {
    expect(plan.lengthTotal).toBe(150);
    expect(planDurationMs(plan)).toBe(3000);
  });
  it("interpola de forma determinista y monótona por el reloj activo", () => {
    expect(samplePlan(plan, 1000)).toMatchObject({ feet: { x: 0, y: 0 }, done: false });
    expect(samplePlan(plan, 2000)).toMatchObject({ feet: { x: 50, y: 0 }, facing: "right", done: false });
    expect(samplePlan(plan, 3500)).toMatchObject({ feet: { x: 100, y: 25 }, facing: "down", done: false });
    expect(samplePlan(plan, 4000)).toMatchObject({ feet: { x: 100, y: 50 }, done: true });
    expect(samplePlan(plan, 99999)).toMatchObject({ feet: { x: 100, y: 50 }, done: true });
    expect(samplePlan(plan, 0).feet).toEqual({ x: 0, y: 0 }); // antes del inicio no se adelanta
    let prev = -1;
    for (let t = 1000; t <= 4000; t += 50) {
      const s = samplePlan(plan, t);
      const d = s.feet.x + s.feet.y;
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
  it("con el reloj congelado (pausa) la posición no avanza", () => {
    const a = samplePlan(plan, 2500);
    const b = samplePlan(plan, 2500);
    expect(a).toEqual(b);
  });
});
