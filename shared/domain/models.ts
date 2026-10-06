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

/** Descripción textual del cambio de la sombra, a partir del mismo valor calculado. */
export function describeShadow(sourceDistanceCm: number, shadowCm: number, objectHeightCm: number): string {
  const times = shadowCm / objectHeightCm;
  return `La linterna está a ${formatNumber(sourceDistanceCm)} cm del objeto. La sombra mide ${formatNumber(shadowCm)} cm: ${formatNumber(times, 1)} veces la altura del objeto.`;
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
