import type { Point } from "../../shared/contracts/geometry";

/**
 * Encuadre de cámara (SPECS 2.4): los píxeles del teléfono no se sincronizan; cada dispositivo adapta cámara y composición a su
 * tamaño. La proyección muestra el laboratorio entero; el teléfono del controlador sigue a Vanessa con una ampliación legible.
 * Funciones puras: se prueban sin Phaser.
 */
export interface Viewport {
  width: number;
  height: number;
}
export interface MapSize {
  width: number;
  height: number;
}
export interface Framing {
  zoom: number;
  /** Punto del mundo que queda en el centro de la vista. */
  centerX: number;
  centerY: number;
}

/** Ancho de mundo que se desea ver con la cámara de seguimiento: vertical (teléfono) y horizontal (portátil). */
export const FOLLOW_WORLD_WIDTH = { portrait: 520, landscape: 900 } as const;
export const MAX_ZOOM = 2.5;

/** Mapa completo, centrado. Es lo que ve la proyección. */
export function fitFraming(view: Viewport, map: MapSize): Framing {
  const zoom = Math.min(view.width / map.width, view.height / map.height);
  return { zoom: zoom > 0 && Number.isFinite(zoom) ? zoom : 1, centerX: map.width / 2, centerY: map.height / 2 };
}

const clampAxis = (target: number, half: number, size: number): number => (half * 2 >= size ? size / 2 : Math.min(Math.max(target, half), size - half));

/**
 * Sigue a `target` con una ampliación que depende de la forma de la pantalla y nunca es menor que la del mapa entero ni mayor que
 * `MAX_ZOOM`. El centro se acota para no mostrar fuera del mapa; si el mapa cabe en un eje, se centra en ese eje.
 */
export function followFraming(view: Viewport, map: MapSize, target: Point): Framing {
  const fit = fitFraming(view, map);
  if (!(view.width > 0 && view.height > 0)) return fit;
  const wanted = view.width / (view.width < view.height ? FOLLOW_WORLD_WIDTH.portrait : FOLLOW_WORLD_WIDTH.landscape);
  const zoom = Math.min(Math.max(wanted, fit.zoom), MAX_ZOOM);
  return { zoom, centerX: clampAxis(target.x, view.width / zoom / 2, map.width), centerY: clampAxis(target.y, view.height / zoom / 2, map.height) };
}

/**
 * Pantalla → mundo, la misma cuenta que hace la cámara de Phaser (`getWorldPoint`): el zoom se aplica alrededor del centro de la
 * vista. Se usa para convertir un toque antes de enviar la intención y se contrasta con la cámara real en las pruebas.
 */
export function screenToWorld(view: Viewport, framing: Framing, screen: Point): Point {
  return { x: framing.centerX + (screen.x - view.width / 2) / framing.zoom, y: framing.centerY + (screen.y - view.height / 2) / framing.zoom };
}

export function worldToScreen(view: Viewport, framing: Framing, world: Point): Point {
  return { x: view.width / 2 + (world.x - framing.centerX) * framing.zoom, y: view.height / 2 + (world.y - framing.centerY) * framing.zoom };
}

/** Acerca el centro actual al deseado: exponencial en el tiempo (independiente de los FPS); con movimiento reducido, sin suavizado. */
export function easeCenter(current: Framing, wanted: Framing, deltaMs: number, reducedMotion: boolean): Framing {
  if (reducedMotion) return wanted;
  const k = 1 - Math.exp(-Math.max(0, deltaMs) / 140);
  return { zoom: current.zoom + (wanted.zoom - current.zoom) * k, centerX: current.centerX + (wanted.centerX - current.centerX) * k, centerY: current.centerY + (wanted.centerY - current.centerY) * k };
}
