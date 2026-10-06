/** Cubo de fichas en memoria: ráfaga `capacity`, reposición `refillPerSecond`. El reloj es inyectable para las pruebas. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number,
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSecond);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Un cubo por clave (IP, identidad…) con limpieza de las claves inactivas para no crecer sin límite. */
export class KeyedLimiter {
  private buckets = new Map<string, { bucket: TokenBucket; touched: number }>();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 10_000,
  ) {}

  allow(key: string, cost = 1): boolean {
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= this.maxKeys) this.sweep();
      entry = { bucket: new TokenBucket(this.capacity, this.refillPerSecond, this.now), touched: this.now() };
      this.buckets.set(key, entry);
    }
    entry.touched = this.now();
    return entry.bucket.take(cost);
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(): void {
    const cutoff = this.now() - 10 * 60_000;
    for (const [k, v] of this.buckets) if (v.touched < cutoff) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.clear(); // último recurso: mejor perdonar un límite que crecer sin tope
  }
}
