import type { TelescopeExperiment } from "../contracts/config";
import type { TelescopeTarget } from "../contracts/state";

/**
 * El observatorio (SPECS 3.4): geometría del panorama nocturno que se mira por el telescopio. Es una escena 2D ilustrada, no un cielo
 * astronómico real. Vive en el dominio compartido porque la usan las tres partes: la escena la dibuja, los controles describen lo que
 * se ve y el servidor valida qué está centrado. Todas las medidas están en unidades del panorama.
 */

export const PANORAMA = { width: 2400, height: 1200 } as const;

/** Donde empiezan los tejados: por debajo de esta altura está el horizonte con las casas. */
export const HORIZON_Y = 760;

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

/**
 * Lo que se puede observar. La ventana es parte de la exploración libre, nunca un objetivo anunciado ni necesario. Los objetivos del cielo
 * quedan dentro de la zona donde el visor puede centrarse con el aumento general (a más de `fieldRadius` de los bordes del panorama).
 */
export const TELESCOPE_TARGETS: Record<TelescopeTarget | "window", Circle> = {
  moon: { x: 560, y: 430, radius: 80 },
  stars: { x: 1760, y: 410, radius: 130 },
  window: { x: 1330, y: 930, radius: 30 },
};

/** Vista general del cielo: donde empieza el visor y a donde lleva «Volver al cielo». La Luna se ve, sin estar centrada. */
export const SKY_VIEW = { x: 800, y: 420 } as const;

/** Navegación por zonas (accesible): ninguna lleva a la ventana; el horizonte la deja a la vista, sin centrarla. */
export const TELESCOPE_ZONES = {
  moon: { x: TELESCOPE_TARGETS.moon.x, y: TELESCOPE_TARGETS.moon.y },
  stars: { x: TELESCOPE_TARGETS.stars.x, y: TELESCOPE_TARGETS.stars.y },
  horizon: { x: 1050, y: 900 },
} as const;

export interface TelescopeView {
  x: number;
  y: number;
  /** Índice en `zoomLevels`: 0 general, 1 cercano. */
  zoom: number;
}

/** Índice del aumento cercano. */
export const CLOSE_ZOOM = 1;

/** Radio de lo que se ve por el visor con un aumento, en unidades del panorama. */
export const fieldRadius = (exp: TelescopeExperiment, zoom: number): number => exp.fieldRadius / exp.zoomLevels[Math.min(Math.max(0, zoom), exp.zoomLevels.length - 1)]!;

/** El visor nunca muestra fuera del panorama: su centro se limita según el aumento. */
export function clampView(view: TelescopeView, exp: TelescopeExperiment): TelescopeView {
  const zoom = Math.min(Math.max(0, Math.round(view.zoom)), exp.zoomLevels.length - 1);
  const r = fieldRadius(exp, zoom);
  const clamp = (v: number, size: number) => Math.min(Math.max(v, r), size - r);
  return { x: clamp(view.x, PANORAMA.width), y: clamp(view.y, PANORAMA.height), zoom };
}

/** Vista inicial: el cielo, con aumento general. */
export const startView = (exp: TelescopeExperiment): TelescopeView => clampView({ ...SKY_VIEW, zoom: 0 }, exp);

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Qué queda centrado en el visor. La Luna y la ventana piden el aumento cercano; el grupo de estrellas se puede observar con cualquiera.
 * «Centrado» es estar dentro de la zona central del visor (`centerTolerance` del radio que se ve con ese aumento).
 */
export function centeredTargets(view: TelescopeView, exp: TelescopeExperiment): { moon: boolean; stars: boolean; window: boolean } {
  const v = clampView(view, exp);
  const tolerance = exp.centerTolerance * fieldRadius(exp, v.zoom);
  const close = v.zoom >= CLOSE_ZOOM;
  return {
    moon: close && distance(v, TELESCOPE_TARGETS.moon) <= tolerance,
    stars: distance(v, TELESCOPE_TARGETS.stars) <= tolerance,
    window: close && distance(v, TELESCOPE_TARGETS.window) <= tolerance,
  };
}

/** ¿Se ve (aunque no esté centrado) un círculo del panorama por el visor? */
export function isVisible(view: TelescopeView, exp: TelescopeExperiment, c: Circle): boolean {
  const v = clampView(view, exp);
  return distance(v, c) <= fieldRadius(exp, v.zoom) + c.radius;
}
