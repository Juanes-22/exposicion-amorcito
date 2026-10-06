import assetsSchema from "./schemas/assets.schema.json";
import type { AssetManifest, ConfigIssue, ValidationResult } from "../contracts/assets";
import { ajvIssues, compileSchema } from "./ajv";
import { isAbsoluteOrUrl, normalizePosix } from "./paths";

const validateShape = compileSchema(assetsSchema);

const at = (path: string, message: string): ConfigIssue => ({ file: "assets.json", path, message });

function pathProblem(path: string): string | null {
  if (isAbsoluteOrUrl(path)) return "debe ser relativo al directorio de assets.json";
  if (normalizePosix(path).startsWith("..")) return "no puede salir del directorio de assets.json";
  return null;
}

/**
 * Forma (assets.schema.json) + coherencia de inventario y de la metadata que usa esta aventura. No toca el disco: la existencia
 * de archivos y la comprobación de frames contra la imagen las hace `scripts/validate-project.ts`.
 * Las comprobaciones específicas de los kits animados de la bitácora (hojas de reposo, animalitos, avatar…) no se portaron porque
 * este catálogo no los contiene; deben portarse si se incorporan esas entradas.
 */
export function validateAssetManifest(data: unknown): ValidationResult<AssetManifest> {
  if (!validateShape(data)) return { ok: false, issues: ajvIssues("assets.json", validateShape.errors) };
  const m = data as unknown as AssetManifest;
  const issues: ConfigIssue[] = [];
  const entries = Object.entries(m.assets);

  if (m.assetCount !== entries.length) issues.push(at("assetCount", `declara ${m.assetCount} pero assets tiene ${entries.length} entradas`));
  const counted: Record<string, number> = {};
  for (const [, a] of entries) counted[a.category] = (counted[a.category] ?? 0) + 1;
  for (const cat of new Set([...Object.keys(counted), ...Object.keys(m.categoryCounts)])) {
    if ((counted[cat] ?? 0) !== (m.categoryCounts[cat] ?? 0)) {
      issues.push(at(`categoryCounts.${cat}`, `declara ${m.categoryCounts[cat] ?? 0} pero hay ${counted[cat] ?? 0} entradas de esa categoría`));
    }
  }
  const paths = new Map<string, string>();
  for (const [id, a] of entries) {
    const where = `assets.${id}`;
    const problem = pathProblem(a.path);
    if (problem) issues.push(at(`${where}.path`, `«${a.path}» ${problem}`));
    const norm = normalizePosix(a.path);
    const other = paths.get(norm);
    if (other && other !== id && a.kind !== "preview") issues.push(at(`${where}.path`, `«${a.path}» ya lo usa ${other}`));
    paths.set(norm, id);

    if (a.visualLayout && a.poseCount !== undefined && a.visualLayout.columns * a.visualLayout.rows !== a.poseCount) {
      issues.push(at(`${where}.poseCount`, "no coincide con columns × rows de visualLayout"));
    }
    if (a.rowDirections && a.visualLayout && a.rowDirections.length !== a.visualLayout.rows) {
      issues.push(at(`${where}.rowDirections`, "debe tener una dirección por fila de visualLayout"));
    }
    if (a.requiresFrameDefinition && a.kind !== "pose-sheet") issues.push(at(`${where}.requiresFrameDefinition`, "solo aplica a recursos de kind «pose-sheet»"));
    if (a.atlasPath) {
      const p = pathProblem(a.atlasPath);
      if (p) issues.push(at(`${where}.atlasPath`, `«${a.atlasPath}» ${p}`));
    }
    if (a.kind === "tileset") {
      if (typeof a.tileWidth !== "number" || typeof a.tileHeight !== "number" || typeof a.tileCount !== "number" || a.width === undefined || a.height === undefined) {
        issues.push(at(where, "un tileset necesita width, height, tileWidth, tileHeight y tileCount"));
      } else if (Math.floor(a.width / a.tileWidth) * Math.floor(a.height / a.tileHeight) < a.tileCount) {
        issues.push(at(`${where}.tileCount`, "declara más tiles de los que caben en la imagen"));
      }
    }
    if (a.placeholder !== undefined && typeof a.placeholder !== "boolean") issues.push(at(`${where}.placeholder`, "debe ser verdadero o falso"));
    if (a.placeholder === true && !a.provenance) issues.push(at(`${where}.provenance`, "un recurso provisional debe declarar su procedencia"));
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: m };
}
