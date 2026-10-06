import { describe, expect, it } from "vitest";
import { ClientClock } from "./ClientClock";

const make = () => {
  let t = 1000;
  const clock = new ClientClock(() => t);
  return { clock, advance: (ms: number) => void (t += ms) };
};

describe("ClientClock", () => {
  it("avanza con el reloj local solo si la sala corre", () => {
    const { clock, advance } = make();
    clock.setSnapshot(5000, true);
    advance(700);
    expect(clock.now()).toBe(5700);
    clock.setSnapshot(5700, false); // pausa
    advance(60_000);
    expect(clock.now()).toBe(5700); // congelado exactamente donde dijo el servidor: la conversación no se suma
    clock.setSnapshot(5700, true); // reanuda
    advance(300);
    expect(clock.now()).toBe(6000);
  });

  it("no acumula delta: al volver de una pestaña oculta aplica el tiempo actual, sin saltos propios", () => {
    const { clock, advance } = make();
    clock.setSnapshot(0, true);
    advance(120_000); // dos minutos con la pestaña oculta y sin ningún update()
    expect(clock.now()).toBe(120_000);
    clock.setFrame(121_000); // el servidor dice que en realidad van 121 s
    expect(clock.now()).toBe(121_000); // corrección grande: se fija de golpe
  });

  it("absorbe poco a poco una deriva pequeña y nunca retrocede de golpe", () => {
    const { clock, advance } = make();
    clock.setSnapshot(1000, true);
    advance(100);
    const before = clock.now(); // 1100
    clock.setFrame(1050); // el servidor va 50 ms por detrás (latencia): corrige solo una parte
    const after = clock.now();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(1050);
    expect(before - after).toBeLessThan(50);
  });

  it("un frame arranca el reloj aunque no hubiera snapshot que lo pusiera en marcha", () => {
    const { clock, advance } = make();
    expect(clock.isRunning).toBe(false);
    clock.setFrame(2000);
    expect(clock.isRunning).toBe(true);
    advance(250);
    expect(clock.now()).toBe(2250);
  });

  it("converge al reloj del servidor con muestras ruidosas (± 40 ms) sin saltos mayores que el ruido", () => {
    const { clock, advance } = make();
    clock.setSnapshot(0, true);
    let server = 0;
    let prev = clock.now();
    let maxStep = 0;
    for (let i = 0; i < 200; i++) {
      advance(100);
      server += 100;
      clock.setFrame(server - 20 + ((i * 37) % 41)); // latencia y ruido
      const n = clock.now();
      maxStep = Math.max(maxStep, Math.abs(n - prev - 100));
      prev = n;
    }
    expect(Math.abs(clock.now() - server)).toBeLessThan(60);
    expect(maxStep).toBeLessThan(40);
  });

  it("freeze() deja el reloj quieto en su valor actual", () => {
    const { clock, advance } = make();
    clock.setSnapshot(100, true);
    advance(400);
    clock.freeze();
    advance(5000);
    expect(clock.now()).toBe(500);
    expect(clock.isRunning).toBe(false);
  });
});
