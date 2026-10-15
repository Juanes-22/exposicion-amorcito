import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { frameDefinitions, WALK_SHEET_ID, type SheetDefinition } from "../shared/config/frameDefinitions";
import type { AssetManifest } from "../shared/contracts/assets";
import { validateFrameDefinitions } from "./lib/validateFrames";

const manifestPath = resolve("public/assets/assets.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AssetManifest;
const clone = (): Record<string, SheetDefinition> => structuredClone(frameDefinitions) as Record<string, SheetDefinition>;
const issuesOf = (defs: Record<string, SheetDefinition>) => validateFrameDefinitions(defs, manifest, manifestPath);
type Mutable = { frames: SheetDefinition["frames"][number][]; animations: SheetDefinition["animations"] };
const walk = (d: Record<string, SheetDefinition>) => d[WALK_SHEET_ID] as unknown as Mutable;

describe("definiciones de frames de la hoja de Vanessa y Jerry (CT-15)", () => {
  it("coinciden con la imagen real: sin recortes, sin vacíos, sin solapes", () => {
    expect(issuesOf(clone())).toEqual([]);
  });

  it("cubren las 12 poses de rowDirections × columnas, no una división automática de la cuadrícula visual", () => {
    const entry = manifest.assets[WALK_SHEET_ID]!;
    expect(entry.requiresFrameDefinition).toBe(true);
    expect(frameDefinitions[WALK_SHEET_ID]!.frames).toHaveLength(entry.poseCount as number);
    const crossing = frameDefinitions[WALK_SHEET_ID]!.frames.filter((f) => [362, 724].some((c) => f.x < c && f.x + f.width > c) || [362, 724, 1086].some((c) => f.y < c && f.y + f.height > c));
    expect(crossing.length).toBeGreaterThan(0); // la cuadrícula nominal de 362 px NO es válida
  });

  it("detecta un recorte que corta la pose, uno vacío, uno fuera de la imagen y un solapamiento", () => {
    let d = clone();
    walk(d).frames[0] = { ...walk(d).frames[0]!, x: walk(d).frames[0]!.x + 60, width: walk(d).frames[0]!.width - 60 };
    expect(issuesOf(d).some((i) => i.message.includes("recorta la pose"))).toBe(true);

    d = clone();
    walk(d).frames[1] = { ...walk(d).frames[1]!, x: 0, y: 700, width: 40, height: 20 };
    walk(d).frames[2] = { ...walk(d).frames[2]!, x: 1000, width: 400 };
    walk(d).frames[4] = { ...walk(d).frames[3]!, name: "left-1" };
    const msgs = issuesOf(d).map((i) => i.message).join("|");
    expect(msgs).toContain("vacío");
    expect(msgs).toContain("fuera de la imagen");
    expect(msgs).toContain("solapa");
  });

  it("detecta nombres que no siguen rowDirections, poseCount distinto y animaciones con frames inexistentes", () => {
    const d = clone();
    walk(d).frames.pop();
    walk(d).frames[0] = { ...walk(d).frames[0]!, name: "abajo-0" };
    walk(d).animations = { ...walk(d).animations, "vanessa-walk-down": { frames: ["down-0", "fantasma"], frameRate: 8, repeat: -1 } };
    const msgs = issuesOf(d).map((i) => i.message).join("|");
    expect(msgs).toContain("poseCount");
    expect(msgs).toContain("rowDirections");
    expect(msgs).toContain("frame inexistente «fantasma»");
  });

  it("rechaza un assetId inexistente o que no es una hoja de poses", () => {
    const d = { "no.existe": { assetId: "no.existe", frames: [], animations: {} }, "ui.icon.open-book": { assetId: "ui.icon.open-book", frames: [], animations: {} } };
    const msgs = issuesOf(d as Record<string, SheetDefinition>).map((i) => i.message).join("|");
    expect(msgs).toContain("asset ID no encontrado");
    expect(msgs).toContain("no es una hoja de poses");
  });

  it("el punto de apoyo está en la base de la pose, bajo Vanessa (Jerry, delante de ella, puede quedar un poco más abajo)", () => {
    for (const f of frameDefinitions[WALK_SHEET_ID]!.frames) {
      expect(f.feetY).toBeGreaterThan(f.height - 16);
      expect(f.feetX).toBeGreaterThan(0);
      expect(f.feetX).toBeLessThan(f.width * 0.6);
    }
  });

  it("de pie parpadean de vez en cuando: la columna central (ojos cerrados) aparece poco y la pose quieta tiene los ojos abiertos", () => {
    for (const dir of ["down", "left", "right", "up"]) {
      const a = frameDefinitions[WALK_SHEET_ID]!.animations[`vanessa-idle-${dir}`]!;
      const blinks = a.frames.filter((f) => f === `${dir}-1`).length;
      expect(blinks).toBeGreaterThan(0);
      expect(blinks / a.frames.length).toBeLessThan(0.2);
      expect(a.restFrame).toBe(`${dir}-0`);
      expect(a.stillFrame).toBe(`${dir}-0`);
      expect(a.repeat).toBe(-1);
    }
  });
});
