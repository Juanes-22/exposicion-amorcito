import { describe, expect, it } from "vitest";
import { countChars, displayNameFor, nameKey, normalizeName, normalizeRecordText } from "./text";

describe("nombres", () => {
  it("recortan, colapsan espacios y normalizan a NFC", () => {
    expect(normalizeName("  Ana   María ")).toMatchObject({ ok: true, value: "Ana María" });
    expect(normalizeName("José")).toMatchObject({ ok: true, value: "José" }); // e + acento combinante → é
  });
  it("cuentan caracteres Unicode percibidos: 20 emojis caben, 21 no; un emoji compuesto cuenta como uno", () => {
    expect(normalizeName("😀".repeat(20)).ok).toBe(true);
    expect(normalizeName("😀".repeat(21)).ok).toBe(false);
    expect(countChars("👨‍👩‍👧‍👦")).toBe(1);
    expect(normalizeName("ñ".repeat(20)).ok).toBe(true);
    expect(normalizeName("ñ".repeat(21)).ok).toBe(false);
  });
  it("rechazan vacío, solo espacios, controles y marcas de dirección de texto", () => {
    expect(normalizeName("").ok).toBe(false);
    expect(normalizeName("   ").ok).toBe(false);
    expect(normalizeName("Ana\u0000").ok).toBe(false);
    expect(normalizeName("Ana\n").ok).toBe(true); // el salto final se recorta como espacio
    expect(normalizeName("A\nB")).toMatchObject({ ok: true, value: "A B" });
    expect(normalizeName("‮ona").ok).toBe(false);
    expect(normalizeName(42).ok).toBe(false);
  });
  it("no trata el HTML como especial: se guarda como texto y React lo escapa", () => {
    expect(normalizeName("<b>Ana</b>")).toMatchObject({ ok: true, value: "<b>Ana</b>" });
  });
  it("la clave de nombre ignora mayúsculas; la distinción es visible solo desde la segunda persona", () => {
    expect(nameKey("LAURA")).toBe(nameKey("laura"));
    expect(displayNameFor("Laura", 1)).toBe("Laura");
    expect(displayNameFor("Laura", 2)).toBe("Laura · 2");
  });
});

describe("texto de registros", () => {
  it("admite hasta el máximo después de recortar espacios", () => {
    expect(normalizeRecordText(`  ${"a".repeat(280)}  `, 280).ok).toBe(true);
    expect(normalizeRecordText("a".repeat(281), 280).ok).toBe(false);
    expect(normalizeRecordText("🔬".repeat(280), 280).ok).toBe(true);
    expect(normalizeRecordText("🔬".repeat(281), 280).ok).toBe(false);
  });
  it("rechaza texto vacío o de solo espacios y controles, pero conserva saltos de línea", () => {
    expect(normalizeRecordText("   \n  ", 280).ok).toBe(false);
    expect(normalizeRecordText("a\u0007b", 280).ok).toBe(false);
    expect(normalizeRecordText("uno\r\ndos", 280)).toMatchObject({ ok: true, value: "uno\ndos" });
  });
});
