// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAudioPlayer, createHolder } from "./player";

/** Un `AudioContext` mínimo que registra lo que se le pide. */
function fakeContext(opts: { state?: string; failDecode?: boolean; failStart?: boolean } = {}) {
  const log = { created: 0, resumed: 0, started: [] as unknown[], connected: 0, decoded: 0, gain: { gain: { value: 1 }, connect: vi.fn(() => void log.connected++) } };
  const ctx = {
    state: "suspended",
    destination: {},
    createGain: () => log.gain,
    createBufferSource: () => ({ buffer: null as unknown, connect: vi.fn(() => void log.connected++), start: vi.fn(function (this: { buffer: unknown }) { if (opts.failStart) throw new Error("InvalidStateError"); log.started.push(this.buffer); }) }),
    decodeAudioData: vi.fn(async () => {
      log.decoded++;
      if (opts.failDecode) throw new Error("no decodifica");
      return { id: `b${log.decoded}` };
    }),
    resume: vi.fn(async () => {
      log.resumed++;
      ctx.state = opts.state ?? "running";
    }),
  };
  return { ctx: ctx as unknown as AudioContext, log };
}
const bytes = async () => new ArrayBuffer(8);

describe("reproductor de efectos (SPECS 10.4)", () => {
  it("empieza en silencio: no crea el contexto ni suena nada hasta que un gesto lo activa", async () => {
    const f = fakeContext();
    const create = vi.fn(() => f.ctx);
    const p = createAudioPlayer({ holder: createHolder(), createContext: create, fetchBytes: bytes });
    expect(p.getStatus()).toBe("off");
    expect(p.play("piece.earned")).toBe(false); // antes de activar no suena, y no lanza
    expect(create).not.toHaveBeenCalled();
    expect(await p.enable({ "piece.earned": "http://x/piece.wav" })).toBe("on");
    expect(create).toHaveBeenCalledTimes(1);
    expect(f.log.resumed).toBe(1);
    expect(p.play("piece.earned")).toBe(true);
    expect(f.log.started).toHaveLength(1);
  });

  it("un solo contexto y una sola descarga por archivo aunque se monten varios reproductores (StrictMode, cambios de turno)", async () => {
    const f = fakeContext();
    const create = vi.fn(() => f.ctx);
    const fetchBytes = vi.fn(bytes);
    const holder = createHolder();
    const a = createAudioPlayer({ holder, createContext: create, fetchBytes });
    const b = createAudioPlayer({ holder, createContext: create, fetchBytes });
    await a.enable({ "piece.earned": "http://x/piece.wav" });
    a.dispose();
    await b.enable({ "piece.earned": "http://x/piece.wav", "shadows.click": "http://x/click.wav" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(fetchBytes).toHaveBeenCalledTimes(2); // piece una vez y click una vez
    expect(b.play("piece.earned")).toBe(true);
    expect(f.log.started).toHaveLength(1); // suena una sola vez
  });

  it("un evento sin sonido asignado, o sin decodificar, se omite sin molestar", async () => {
    const f = fakeContext();
    const p = createAudioPlayer({ holder: createHolder(), createContext: () => f.ctx, fetchBytes: bytes });
    await p.enable({ "piece.earned": "http://x/piece.wav" });
    expect(p.play("inventor.activated")).toBe(false);
    expect(f.log.started).toHaveLength(0);
  });

  it("un fallo de audio nunca bloquea: sin soporte, contexto que no arranca, archivo que no baja o que no decodifica", async () => {
    const none = createAudioPlayer({ holder: createHolder(), createContext: () => { throw new Error("sin Web Audio"); }, fetchBytes: bytes });
    expect(await none.enable({ a: "http://x/a.wav" })).toBe("unavailable");
    expect(none.play("a")).toBe(false);

    const blocked = fakeContext({ state: "suspended" }); // el navegador no deja activar el audio
    const p2 = createAudioPlayer({ holder: createHolder(), createContext: () => blocked.ctx, fetchBytes: bytes });
    expect(await p2.enable({ a: "http://x/a.wav" })).toBe("unavailable");

    const bad = fakeContext({ failDecode: true });
    const p3 = createAudioPlayer({ holder: createHolder(), createContext: () => bad.ctx, fetchBytes: bytes });
    expect(await p3.enable({ a: "http://x/a.wav" })).toBe("on"); // el audio funciona…
    expect(p3.play("a")).toBe(false); // …pero ese archivo no: se omite

    const offline = fakeContext();
    const p4 = createAudioPlayer({ holder: createHolder(), createContext: () => offline.ctx, fetchBytes: async () => { throw new Error("HTTP 404"); } });
    expect(await p4.enable({ a: "http://x/a.wav" })).toBe("on");
    expect(p4.play("a")).toBe(false);
  });

  it("si el navegador rechaza lanzar un sonido, no lanza ni avisa de que sonó", async () => {
    const f = fakeContext({ failStart: true });
    const played: string[] = [];
    const p = createAudioPlayer({ holder: createHolder(), createContext: () => f.ctx, fetchBytes: bytes, onPlay: (e) => played.push(e) });
    await p.enable({ a: "http://x/a.wav" });
    expect(() => p.play("a")).not.toThrow();
    expect(p.play("a")).toBe(false);
    expect(played).toEqual([]);
    expect(p.getStatus()).toBe("on"); // el audio sigue activo para los demás sonidos
  });

  it("un archivo que falló se puede reintentar en la siguiente activación", async () => {
    const f = fakeContext();
    let fail = true;
    const holder = createHolder();
    const p = createAudioPlayer({ holder, createContext: () => f.ctx, fetchBytes: async () => { if (fail) throw new Error("sin red"); return new ArrayBuffer(8); } });
    await p.enable({ a: "http://x/a.wav" });
    expect(p.play("a")).toBe(false);
    p.disable();
    fail = false;
    await p.enable({ a: "http://x/a.wav" });
    expect(p.play("a")).toBe(true);
  });

  it("silenciar apaga sin destruir el contexto, y el volumen se aplica y se acota a 0–1", async () => {
    const f = fakeContext();
    const p = createAudioPlayer({ holder: createHolder(), createContext: () => f.ctx, fetchBytes: bytes });
    await p.enable({ a: "http://x/a.wav" });
    p.setVolume(0.3);
    expect(f.log.gain.gain.value).toBe(0.3);
    p.setVolume(7);
    expect(f.log.gain.gain.value).toBe(1);
    p.setVolume(Number.NaN);
    expect(f.log.gain.gain.value).toBe(0.8);
    p.disable();
    expect(p.getStatus()).toBe("off");
    expect(p.play("a")).toBe(false);
  });

  it("avisa a quien escucha el estado y deja de hacerlo al desmontar; tras `dispose` ya no activa nada", async () => {
    const f = fakeContext();
    const create = vi.fn(() => f.ctx);
    const p = createAudioPlayer({ holder: createHolder(), createContext: create, fetchBytes: bytes });
    const seen: string[] = [];
    p.subscribe(() => seen.push(p.getStatus()));
    await p.enable({ a: "http://x/a.wav" });
    p.disable();
    expect(seen).toEqual(["on", "off"]);
    p.dispose();
    expect(await p.enable({ a: "http://x/a.wav" })).toBe("off");
    expect(seen).toEqual(["on", "off"]);
  });

  it("`attach` vuelve a poner en uso un reproductor ya soltado (StrictMode desmonta y monta con la misma instancia)", async () => {
    const f = fakeContext();
    const p = createAudioPlayer({ holder: createHolder(), createContext: () => f.ctx, fetchBytes: bytes });
    p.dispose();
    expect(await p.enable({ a: "http://x/a.wav" })).toBe("off"); // soltado: no hace nada
    p.attach();
    expect(await p.enable({ a: "http://x/a.wav" })).toBe("on");
    expect(p.play("a")).toBe(true);
  });

  it("onPlay avisa de cada sonido lanzado de verdad (y solo de esos)", async () => {
    const f = fakeContext();
    const played: string[] = [];
    const p = createAudioPlayer({ holder: createHolder(), createContext: () => f.ctx, fetchBytes: bytes, onPlay: (e) => played.push(e) });
    await p.enable({ "piece.earned": "http://x/p.wav" });
    p.play("piece.earned");
    p.play("shadows.click"); // sin sonido asignado
    expect(played).toEqual(["piece.earned"]);
  });
});
