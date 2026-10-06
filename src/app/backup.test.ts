// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedProject } from "../config/loadProject";
import { prepareBackup, resetBackupForTests } from "./backup";

vi.mock("../components/room/DemoView", () => ({ DemoView: () => null }));

const project = (ids: string[]) => ({ registry: { ids: () => ids, url: (id: string) => `http://localhost/assets/${id}.png` } }) as unknown as LoadedProject;

beforeEach(() => resetBackupForTests());
afterEach(() => vi.unstubAllGlobals());

describe("preparar el respaldo mientras la sala funciona (SPECS 6.4)", () => {
  it("descarga el módulo de la demostración y calienta la caché con cada recurso del catálogo, una sola vez", async () => {
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchSpy);
    const p = project(["a", "b", "c"]);
    const result = await prepareBackup(p);
    expect(result).toEqual({ modules: true, assets: 3, failed: 0 });
    expect(fetchSpy.mock.calls.map((c) => (c as unknown as [string])[0]).sort()).toEqual(["http://localhost/assets/a.png", "http://localhost/assets/b.png", "http://localhost/assets/c.png"]);
    await prepareBackup(p);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // no se repite
  });

  it("un recurso que falla no rompe nada: solo queda contado como no precargado", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.includes("b.png") ? new Response("no", { status: 404 }) : u.includes("c.png") ? Promise.reject(new Error("sin red")) : new Response(new Uint8Array([1])))));
    expect(await prepareBackup(project(["a", "b", "c"]))).toEqual({ modules: true, assets: 1, failed: 2 });
  });
});
