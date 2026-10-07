// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCredential, loadCredential, saveCredential, type StoredCredential } from "./credentials";
import { newRequestId } from "./ids";
import { demoPath, homePath, parseRoute, roomPath } from "./useRoute";

const cred: StoredCredential = { token: "t".repeat(43), role: "participant", principalId: "p1", displayName: "Ana", color: "azul", savedAt: "2026-10-05T00:00:00.000Z" };

describe("rutas (CT-16)", () => {
  it("reconoce /, /demo y /sala/:code, normaliza el código y rechaza el resto", () => {
    expect(parseRoute("/", "/")).toEqual({ name: "home" });
    expect(parseRoute("/demo", "/")).toEqual({ name: "demo" });
    expect(parseRoute("/demo/", "/")).toEqual({ name: "demo" });
    expect(parseRoute("/sala/abc234", "/")).toEqual({ name: "room", code: "ABC234" });
    expect(parseRoute("/sala/ABC234/", "/")).toEqual({ name: "room", code: "ABC234" });
    for (const bad of ["/sala", "/sala/", "/sala/a", "/sala/ABC-234", "/sala/ABC234/otra", "/otra"]) expect(parseRoute(bad, "/"), bad).toEqual({ name: "notFound" });
  });
  it("con otra base de despliegue resuelve igual y no duplica prefijos", () => {
    expect(parseRoute("/laboratorio/sala/ABC234", "/laboratorio/")).toEqual({ name: "room", code: "ABC234" });
    expect(parseRoute("/laboratorio/", "/laboratorio/")).toEqual({ name: "home" });
    expect(parseRoute("/laboratorio/demo", "/laboratorio/")).toEqual({ name: "demo" });
    expect(roomPath("ABC234", "/")).toBe("/sala/ABC234");
    expect(roomPath("ABC234", "/laboratorio/")).toBe("/laboratorio/sala/ABC234");
  });
  it("la ruta de la demostración respeta la base y recuerda de qué sala se vino, sin romper el reconocimiento de la ruta", () => {
    expect(demoPath(undefined, "/")).toBe("/demo");
    expect(demoPath("ABC234", "/")).toBe("/demo?from=ABC234");
    expect(demoPath("ABC234", "/laboratorio/")).toBe("/laboratorio/demo?from=ABC234");
    expect(homePath("/")).toBe("/");
    expect(homePath("/laboratorio/")).toBe("/laboratorio/");
    // La consulta no forma parte de la ruta que se interpreta.
    expect(parseRoute(new URL("http://x/laboratorio/demo?from=ABC234").pathname, "/laboratorio/")).toEqual({ name: "demo" });
  });
});

describe("credenciales locales", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("se guardan con una clave propia por proyecto y por sala, sin mezclar salas", () => {
    saveCredential("ABC234", cred);
    saveCredential("XYZ789", { ...cred, principalId: "p2" });
    expect(loadCredential("abc234")?.principalId).toBe("p1");
    expect(loadCredential("XYZ789")?.principalId).toBe("p2");
    expect(Object.keys(window.localStorage).every((k) => k.startsWith("laboratorio-cosas-cotidianas:v1:sala:"))).toBe(true);
    clearCredential("ABC234");
    expect(loadCredential("ABC234")).toBeNull();
    expect(loadCredential("XYZ789")).not.toBeNull();
  });
  it("ignora contenido corrupto o con otra forma", () => {
    window.localStorage.setItem("laboratorio-cosas-cotidianas:v1:sala:BAD111", "{no es json");
    window.localStorage.setItem("laboratorio-cosas-cotidianas:v1:sala:BAD222", JSON.stringify({ token: 5 }));
    expect(loadCredential("BAD111")).toBeNull();
    expect(loadCredential("BAD222")).toBeNull();
  });
  it("si el almacenamiento falla (ventana privada) la sesión sigue en memoria y no lanza", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("cuota", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(() => saveCredential("MEM111", cred)).not.toThrow();
    expect(loadCredential("MEM111")?.principalId).toBe("p1");
    expect(() => clearCredential("MEM111")).not.toThrow();
  });
});

describe("identificadores de petición", () => {
  it("son únicos, con suficiente entropía y no dependen de crypto.randomUUID (contextos no seguros)", () => {
    const ids = new Set(Array.from({ length: 2000 }, newRequestId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{24}$/);
  });
});
