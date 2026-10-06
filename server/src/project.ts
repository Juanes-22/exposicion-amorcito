import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { frameDefinitions } from "../../shared/config/frameDefinitions";
import { validateProject, type ProjectBundle } from "../../shared/config/validateProject";

const readJson = (dir: string, rel: string): unknown => JSON.parse(readFileSync(resolve(dir, rel), "utf8"));

export class InvalidProjectError extends Error {
  constructor(readonly issues: string[]) {
    super(`El proyecto no es válido:\n${issues.map((i) => `  · ${i}`).join("\n")}`);
    this.name = "InvalidProjectError";
  }
}

/**
 * Carga y valida configuración, catálogo y TMJ con los mismos validadores que usan la CLI y el frontend. El servidor no arranca
 * con un paquete inválido: lo que valida es lo que se sirve y lo que ata a las salas por `configHash` y `mapHash` (SPECS 4.2).
 */
export function loadProjectFromDisk(publicDir: string): ProjectBundle {
  const config = readJson(publicDir, "config/laboratorio.json") as { world?: { mapPath?: string } };
  const mapPath = config.world?.mapPath ?? "maps/laboratorio.tmj";
  const result = validateProject({
    config,
    manifest: readJson(publicDir, "assets/assets.json"),
    tmj: readJson(publicDir, mapPath),
    frameSheets: frameDefinitions,
    layout: { assetsDir: "assets" },
  });
  if (!result.ok) throw new InvalidProjectError(result.issues.map((i) => `[${i.file}] ${i.path}: ${i.message}`));
  return result.bundle;
}
