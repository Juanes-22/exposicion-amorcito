/**
 * Reloj local de la simulación (SPECS 5.6, 10.2). La escena dibuja desde `update(time, delta)` con este reloj, que el servidor
 * ajusta con sus muestras: el tiempo del dispositivo NO decide ningún resultado, solo interpola entre muestras del servidor.
 *
 * - Un snapshot fija el valor autoritativo y si el reloj corre (la sala es jugable). En pausa o sin propietario se queda quieto
 *   exactamente en el valor del snapshot, así que reanudar no suma la conversación.
 * - Un frame confirma que corre y corrige la deriva: desfases pequeños se absorben poco a poco (sin saltos visibles) y los
 *   grandes —por ejemplo tras volver de una pestaña oculta— se fijan de golpe.
 * - No acumula `delta`: lee siempre `base + (ahora − anclaje)`, de modo que al volver de una pestaña oculta aplica el tiempo
 *   actual y no «adelanta» la simulación con un delta enorme.
 */
export class ClientClock {
  private base = 0;
  private anchor = 0;
  private running = false;

  constructor(private readonly clockNow: () => number = () => performance.now()) {}

  /** Desfase, en ms, a partir del cual se corrige de golpe en vez de absorberlo poco a poco. */
  static readonly HARD_SET_MS = 150;
  /** Fracción del error que se corrige con cada muestra. */
  static readonly SLEW = 0.35;

  get isRunning(): boolean {
    return this.running;
  }

  /** Reloj de simulación estimado en este instante (ms de tiempo activo). */
  now(): number {
    return this.running ? this.base + (this.clockNow() - this.anchor) : this.base;
  }

  /** Fija el valor del servidor y si el reloj corre. Si ya corría y la diferencia es pequeña se corrige suavemente. */
  setSnapshot(activeMs: number, running: boolean): void {
    if (running && this.running) return this.correct(activeMs);
    this.base = activeMs;
    this.anchor = this.clockNow();
    this.running = running;
  }

  /** Muestra del servidor: confirma que corre y ajusta la deriva. */
  setFrame(activeMs: number): void {
    if (!this.running) {
      this.base = activeMs;
      this.anchor = this.clockNow();
      this.running = true;
      return;
    }
    this.correct(activeMs);
  }

  private correct(activeMs: number): void {
    const estimate = this.now();
    const error = activeMs - estimate;
    const t = this.clockNow();
    this.base = Math.abs(error) > ClientClock.HARD_SET_MS ? activeMs : estimate + error * ClientClock.SLEW;
    this.anchor = t;
  }

  /** Congela el reloj en su valor actual (p. ej. al perder la conexión: no se sigue «adivinando»). */
  freeze(): void {
    this.base = this.now();
    this.anchor = this.clockNow();
    this.running = false;
  }
}
