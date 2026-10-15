import type { RampsExperiment, ShadowsExperiment } from "../contracts/config";

/**
 * Modelos matemáticos de las mesas (SPECS 3.2 y 3.3). Se implementan una sola vez: servidor, proyección y teléfono
 * usan estas mismas funciones, y la descripción textual deriva del mismo valor que el dibujo.
 */

const G = 9.81;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Sombras: fuente puntual ideal. `d` linterna–objeto, `b` objeto–pantalla, `h` altura del objeto (cm). */
export function shadowHeightCm(sourceDistanceCm: number, screenDistanceCm: number, objectHeightCm: number): number {
  return (objectHeightCm * (sourceDistanceCm + screenDistanceCm)) / sourceDistanceCm;
}

/**
 * Sombras sin medidas: dónde está la linterna y qué tan grande es la sombra, con palabras. La mesa compara tamaños; no muestra
 * centímetros. Las palabras salen del mismo modelo que el dibujo, relativas al rango de la mesa (de la sombra más pequeña posible a la
 * más grande).
 */
export function shadowWords(e: ShadowsExperiment, sourceDistanceCm: number): { lantern: string; shadow: string } {
  const { sourceDistanceMinCm: min, sourceDistanceMaxCm: max, screenDistanceCm: b, objectHeightCm: h } = e;
  const t = (sourceDistanceCm - min) / (max - min);
  const smallest = shadowHeightCm(max, b, h);
  const u = (shadowHeightCm(sourceDistanceCm, b, h) - smallest) / (shadowHeightCm(min, b, h) - smallest);
  const lantern = t < 0.2 ? "muy cerca" : t < 0.45 ? "cerca" : t < 0.75 ? "lejos" : "muy lejos";
  const shadow = u >= 0.66 ? "muy grande" : u >= 0.33 ? "grande" : u >= 0.12 ? "mediana" : "pequeña";
  return { lantern, shadow };
}

/** Descripción textual de la sombra, para lectores de pantalla y para quien no ve la escena. */
export function describeShadow(e: ShadowsExperiment, sourceDistanceCm: number): string {
  const w = shadowWords(e, sourceDistanceCm);
  return `La linterna está ${w.lantern} del objeto. La sombra es ${w.shadow}.`;
}

/** Rampas sin grados: el nombre de una inclinación (configurable), de la menos a la más empinada. */
export function angleLabel(e: RampsExperiment, angleDeg: number): string {
  const i = Math.round((angleDeg - e.minAngleDeg) / e.angleStepDeg);
  return e.angleLabels[Math.min(Math.max(0, i), e.angleLabels.length - 1)] ?? "";
}

/** Rampas: esfera homogénea ideal rodando sin deslizar y sin pérdidas. `a = (5/7) · g · sin θ`. */
export function rampAcceleration(angleDeg: number): number {
  return (5 / 7) * G * Math.sin(toRad(angleDeg));
}

/** Duración visual en segundos: `T = escala · sqrt(2L / a)`. Es el tiempo de la simulación visual, no una medición de laboratorio. */
export function rampDurationSeconds(angleDeg: number, lengthMeters: number, visualTimeScale: number): number {
  return visualTimeScale * Math.sqrt((2 * lengthMeters) / rampAcceleration(angleDeg));
}

/** Duración en ms enteros de reloj activo: es el valor que el servidor congela en la prueba. */
export function rampDurationMs(angleDeg: number, lengthMeters: number, visualTimeScale: number): number {
  return Math.round(rampDurationSeconds(angleDeg, lengthMeters, visualTimeScale) * 1000);
}

/** Fracción recorrida de la rampa: `s/L = min(1, (t/T)²)`. */
export function rampProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  const t = Math.max(0, elapsedMs) / durationMs;
  return Math.min(1, t * t);
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
