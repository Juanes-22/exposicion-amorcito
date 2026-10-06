/**
 * Emisor con límite de frecuencia para controles continuos (el arrastre del slider): como mucho una vez cada `intervalMs`
 * (≈ 12 Hz con 83 ms, SPECS 5.6), y el ÚLTIMO valor siempre se envía (tendencia final), de modo que la posición final nunca se pierde.
 * `flush` envía ya lo pendiente (al soltar el gesto).
 */
export function createThrottledSender<T>(send: (value: T) => void, intervalMs = 83, clock: () => number = () => performance.now(), schedule = setTimeout, cancel = clearTimeout) {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    last = clock();
    send(value);
  };

  return {
    push(value: T): void {
      pending = { value };
      const wait = last + intervalMs - clock();
      if (wait <= 0) {
        if (timer) cancel(timer);
        fire();
      } else if (!timer) timer = schedule(fire, wait);
    },
    /** Envía ya el valor pendiente (si lo hay) y cancela la espera. */
    flush(): void {
      if (timer) cancel(timer);
      fire();
    },
    dispose(): void {
      if (timer) cancel(timer);
      timer = null;
      pending = null;
    },
  };
}
