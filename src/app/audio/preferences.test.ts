// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSoundPreference, saveSoundPreference } from "./preferences";

const KEY = "laboratorio-cosas-cotidianas:v2:sonido";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("preferencia local de sonido (SPECS 10.4)", () => {
  it("sin nada guardado: activado; en el celular de quien juega, al máximo", () => {
    expect(loadSoundPreference("phone")).toEqual({ on: true, volume: 1 });
    expect(loadSoundPreference("computer")).toEqual({ on: true, volume: 0.8 });
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.8 });
  });

  it("lo guardado con la versión anterior (0,8 o silenciado en los ensayos) se ignora: el celular vuelve a empezar activado y al máximo", () => {
    window.localStorage.setItem("laboratorio-cosas-cotidianas:v1:sonido", JSON.stringify({ on: false, volume: 0.8 }));
    expect(loadSoundPreference("phone")).toEqual({ on: true, volume: 1 });
  });

  it("guarda y recupera «activado» y el volumen", () => {
    saveSoundPreference({ on: true, volume: 0.4 });
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.4 });
  });

  it("un volumen fuera de 0–1 o que no es número se descarta, y solo queda silenciado si se guardó exactamente false", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ on: "yes", volume: 5 }));
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.8 });
    window.localStorage.setItem(KEY, JSON.stringify({ on: false, volume: 0.5 }));
    expect(loadSoundPreference()).toEqual({ on: false, volume: 0.5 });
    window.localStorage.setItem(KEY, JSON.stringify({ on: true, volume: -0.1 }));
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.8 });
    window.localStorage.setItem(KEY, JSON.stringify({ on: true, volume: "alto" }));
    expect(loadSoundPreference().volume).toBe(0.8);
  });

  it("un valor guardado corrupto no rompe nada", () => {
    window.localStorage.setItem(KEY, "{no es json");
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.8 });
  });

  it("sin almacenamiento (modo privado, bloqueado) ni lee ni guarda con error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("lleno");
    });
    expect(loadSoundPreference()).toEqual({ on: true, volume: 0.8 });
    expect(() => saveSoundPreference({ on: true, volume: 0.5 })).not.toThrow();
  });
});
