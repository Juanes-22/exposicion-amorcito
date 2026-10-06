import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash, sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("coincide con node:crypto en vectores conocidos y límites de bloque", () => {
    const inputs = ["", "abc", "El laboratorio de las cosas cotidianas ñandú 🔬", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "x".repeat(10_000)];
    for (const s of inputs) expect(sha256Hex(s), `longitud ${s.length}`).toBe(createHash("sha256").update(s).digest("hex"));
  });

  it("acepta bytes y da el mismo resultado que el texto UTF-8", () => {
    expect(sha256Hex(new TextEncoder().encode("ñ"))).toBe(sha256Hex("ñ"));
  });
});

describe("contentHash", () => {
  it("no depende del orden de las claves ni de los espacios", () => {
    expect(contentHash({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(contentHash(JSON.parse('{ "b": {"d":"x", "c":[1,2]},\n "a": 1 }')));
  });
  it("cambia si cambia un valor", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
  it("ignora propiedades undefined como JSON.stringify", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
