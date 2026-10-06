import type { MapIndex } from "../config/tmj";
import type { Footprint, Point, Rect } from "../contracts/geometry";

/**
 * Navegación pura compartida por servidor y navegador (SPECS 5.6, 8.3). Sin Phaser, DOM ni físicas.
 * La huella ocupa `x ± width/2` e `y-height…y` respecto del punto de pies, con la misma convención en cliente y servidor.
 * La rejilla es solo un índice de búsqueda: la verdad de «¿puede estar aquí?» es `isFootprintFree`, una intersección exacta.
 */

export const NAV_CELL = 8;

export type Obstacles = Pick<MapIndex, "widthPx" | "heightPx" | "collisions">;

export const footprintRect = (feet: Point, fp: Footprint): Rect => ({ x: feet.x - fp.width / 2, y: feet.y - fp.height, width: fp.width, height: fp.height });

/** Solapamiento estricto: rozar un borde no es chocar. */
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function isFootprintFree(map: Obstacles, fp: Footprint, feet: Point): boolean {
  if (!Number.isFinite(feet.x) || !Number.isFinite(feet.y)) return false;
  const r = footprintRect(feet, fp);
  if (r.x < 0 || r.y < 0 || r.x + r.width > map.widthPx || r.y + r.height > map.heightPx) return false;
  return !map.collisions.some((c) => overlaps(r, c));
}

/**
 * Prueba exacta de un trayecto recto. La huella (rectángulo fijo respecto de los pies) solapa un obstáculo B si y solo si los
 * pies caen dentro del rectángulo abierto `(B.x − w/2, B.x + B.width + w/2) × (B.y, B.y + B.height + h)`. Así que el segmento
 * es válido si no atraviesa ese rectángulo ampliado (recorte de segmento, sin muestreo: no se escapa ningún roce de esquina)
 * y ambos extremos quedan dentro de los límites del mapa (región convexa).
 */
export function segmentFree(map: Obstacles, fp: Footprint, a: Point, b: Point): boolean {
  if (!withinBounds(map, fp, a) || !withinBounds(map, fp, b)) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const c of map.collisions) {
    if (segmentCrossesOpenRect(a, dx, dy, c.x - fp.width / 2, c.x + c.width + fp.width / 2, c.y, c.y + c.height + fp.height)) return false;
  }
  return true;
}

function withinBounds(map: Obstacles, fp: Footprint, p: Point): boolean {
  const r = footprintRect(p, fp);
  return Number.isFinite(p.x) && Number.isFinite(p.y) && r.x >= 0 && r.y >= 0 && r.x + r.width <= map.widthPx && r.y + r.height <= map.heightPx;
}

/** ¿El segmento `a + t·(dx,dy)`, t ∈ [0,1], tiene algún punto en el interior del rectángulo abierto (x0,x1)×(y0,y1)? */
function segmentCrossesOpenRect(a: Point, dx: number, dy: number, x0: number, x1: number, y0: number, y1: number): boolean {
  let lo = -Infinity; // t debe ser estrictamente mayor
  let hi = Infinity; // t debe ser estrictamente menor
  for (const [origin, delta, min, max] of [[a.x, dx, x0, x1], [a.y, dy, y0, y1]] as const) {
    if (delta === 0) {
      if (!(origin > min && origin < max)) return false;
    } else {
      const t0 = (min - origin) / delta;
      const t1 = (max - origin) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  return lo < hi && lo < 1 && hi > 0;
}

export interface NavGrid {
  cols: number;
  rows: number;
  cell: number;
  /** 1 = la huella no cabe con los pies en el centro de esa celda. */
  blocked: Uint8Array;
}

export function buildNavGrid(map: Obstacles, fp: Footprint, cell = NAV_CELL): NavGrid {
  const cols = Math.ceil(map.widthPx / cell);
  const rows = Math.ceil(map.heightPx / cell);
  const blocked = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!isFootprintFree(map, fp, { x: cx * cell + cell / 2, y: cy * cell + cell / 2 })) blocked[cy * cols + cx] = 1;
    }
  }
  return { cols, rows, cell, blocked };
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const cellIndex = (g: NavGrid, p: Point) => Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / g.cell))) * g.cols + Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell)));
const cellCenter = (g: NavGrid, i: number): Point => ({ x: (i % g.cols) * g.cell + g.cell / 2, y: Math.floor(i / g.cols) * g.cell + g.cell / 2 });

/** Montículo binario mínimo para A*. */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    let i = this.items.length;
    this.items.push(item);
    this.keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

/** Celda libre cercana a `p` (por anillos) desde la que se llega a `p` en línea recta libre. */
function anchorCell(map: Obstacles, fp: Footprint, g: NavGrid, p: Point, maxRing = 4): number | null {
  const home = cellIndex(g, p);
  const homeFree = !g.blocked[home] && segmentFree(map, fp, p, cellCenter(g, home));
  if (homeFree) return home;
  const cx = home % g.cols;
  const cy = Math.floor(home / g.cols);
  let best: number | null = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= maxRing && best === null; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
        const i = y * g.cols + x;
        if (g.blocked[i]) continue;
        const c = cellCenter(g, i);
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bestD && segmentFree(map, fp, p, c)) {
          best = i;
          bestD = d;
        }
      }
    }
  }
  return best;
}

/**
 * Camino de `from` a `to` (A* de ocho vecinos sin cortar esquinas, alisado con la prueba exacta). Devuelve los puntos de
 * pies empezando en `from` y terminando en `to`, o `null` si el destino no cabe, no se alcanza o el trayecto no es válido.
 * Nunca devuelve un camino cuyo segmento no supere `segmentFree`.
 */
export function findPath(map: Obstacles, fp: Footprint, grid: NavGrid, from: Point, to: Point): Point[] | null {
  if (!isFootprintFree(map, fp, to)) return null;
  if (from.x === to.x && from.y === to.y) return [from];
  if (segmentFree(map, fp, from, to)) return [from, to];

  const start = anchorCell(map, fp, grid, from);
  const goal = anchorCell(map, fp, grid, to);
  if (start === null || goal === null) return null;

  const g = new Float32Array(grid.blocked.length).fill(Infinity);
  const parent = new Int32Array(grid.blocked.length).fill(-1);
  const closed = new Uint8Array(grid.blocked.length);
  const gx = goal % grid.cols;
  const gy = Math.floor(goal / grid.cols);
  const h = (i: number) => {
    const dx = Math.abs((i % grid.cols) - gx);
    const dy = Math.abs(Math.floor(i / grid.cols) - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); // distancia octil
  };
  const open = new MinHeap();
  g[start] = 0;
  open.push(start, h(start));
  let found = start === goal;
  while (open.size > 0 && !found) {
    const i = open.pop();
    if (closed[i]) continue;
    if (i === goal) {
      found = true;
      break;
    }
    closed[i] = 1;
    const cx = i % grid.cols;
    const cy = (i - cx) / grid.cols;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const n = ny * grid.cols + nx;
      if (grid.blocked[n] || closed[n]) continue;
      // Sin cortar esquinas: una diagonal exige libres las dos celdas contiguas.
      if (dx !== 0 && dy !== 0 && (grid.blocked[cy * grid.cols + nx] || grid.blocked[ny * grid.cols + cx])) continue;
      const tentative = g[i]! + cost;
      if (tentative < g[n]!) {
        g[n] = tentative;
        parent[n] = i;
        open.push(n, tentative + h(n));
      }
    }
  }
  if (!found) return null;

  const cells: number[] = [];
  for (let i = goal; i !== -1; i = parent[i]!) cells.push(i);
  cells.reverse();
  const raw: Point[] = [from, ...cells.map((c) => cellCenter(grid, c)), to];

  // Alisado: desde cada punto se salta al más lejano con segmento libre.
  const out: Point[] = [raw[0]!];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let next = anchor + 1;
    for (let j = raw.length - 1; j > anchor + 1; j--) {
      if (segmentFree(map, fp, raw[anchor]!, raw[j]!)) {
        next = j;
        break;
      }
    }
    out.push(raw[next]!);
    anchor = next;
  }
  for (let i = 0; i < out.length - 1; i++) if (!segmentFree(map, fp, out[i]!, out[i + 1]!)) return null;
  return out;
}

/** Celdas alcanzables desde un punto (relleno por anchura): sirve a la validación de alcanzabilidad del mapa. */
export function reachableCells(grid: NavGrid, startCell: number): Uint8Array {
  const seen = new Uint8Array(grid.blocked.length);
  const stack = [startCell];
  seen[startCell] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const cx = i % grid.cols;
    const cy = (i - cx) / grid.cols;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const n = ny * grid.cols + nx;
      if (seen[n] || grid.blocked[n]) continue;
      if (dx !== 0 && dy !== 0 && (grid.blocked[cy * grid.cols + nx] || grid.blocked[ny * grid.cols + cx])) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return seen;
}

export { cellIndex as navCellIndex };
