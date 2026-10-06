import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";
import type { SheetDefinition } from "../../shared/config/frameDefinitions";
import type { AssetManifest, ConfigIssue } from "../../shared/contracts/assets";

const ALPHA = 16; // por debajo de este alpha un píxel se considera transparente

/**
 * Valida definiciones de frames contra la imagen real y la metadata del manifiesto (CT-15): dentro de la imagen, sin recortar
 * contenido (el borde de cada frame es transparente), sin vacíos, sin solaparse, con el pivote dentro del frame y coherentes con
 * poseCount/visualLayout/rowDirections. Portado de Bitácora Amorcito @041d326 (scripts/lib/validateFrames.ts).
 */
export function validateFrameDefinitions(defs: Readonly<Record<string, SheetDefinition>>, manifest: AssetManifest, manifestPath: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const baseDir = resolve(dirname(manifestPath), manifest.basePath);
  const add = (path: string, message: string) => issues.push({ file: "assets.json", path, message });

  for (const [key, def] of Object.entries(defs)) {
    const at = `frameDefinitions.${key}`;
    if (def.assetId !== key) add(at, `assetId «${def.assetId}» no coincide con su clave`);
    const entry = Object.hasOwn(manifest.assets, def.assetId) ? manifest.assets[def.assetId] : undefined;
    if (!entry) {
      add(`${at}.assetId`, `asset ID no encontrado: «${def.assetId}»`);
      continue;
    }
    if (entry.kind !== "pose-sheet") add(`${at}.assetId`, `«${def.assetId}» no es una hoja de poses (kind ${entry.kind})`);

    const png = PNG.sync.read(readFileSync(resolve(baseDir, entry.path)));
    const opaque = (x: number, y: number) => (png.data[(y * png.width + x) * 4 + 3] ?? 0) > ALPHA;

    if (entry.poseCount !== undefined && def.frames.length !== entry.poseCount) add(`${at}.frames`, `hay ${def.frames.length} frames y el manifiesto declara poseCount ${entry.poseCount}`);
    const expected = (entry.rowDirections ?? []).flatMap((d) => Array.from({ length: entry.visualLayout?.columns ?? 0 }, (_, c) => `${d}-${c}`));
    if (expected.length > 0 && JSON.stringify(def.frames.map((f) => f.name)) !== JSON.stringify(expected)) add(`${at}.frames`, `los nombres deben seguir rowDirections × columnas: ${expected.join(", ")}`);

    const names = new Set<string>();
    def.frames.forEach((f, i) => {
      const p = `${at}.frames[${i}](${f.name})`;
      if (names.has(f.name)) add(p, "nombre de frame repetido");
      names.add(f.name);
      if (f.width <= 0 || f.height <= 0) return add(p, "tamaño no positivo");
      if (f.x < 0 || f.y < 0 || f.x + f.width > png.width || f.y + f.height > png.height) return add(p, `queda fuera de la imagen (${png.width}×${png.height})`);
      let content = 0;
      let clipped = 0;
      for (let y = f.y; y < f.y + f.height; y++) {
        for (let x = f.x; x < f.x + f.width; x++) {
          if (!opaque(x, y)) continue;
          content++;
          if (x === f.x || y === f.y || x === f.x + f.width - 1 || y === f.y + f.height - 1) clipped++;
        }
      }
      if (content === 0) add(p, "el recorte está vacío");
      if (clipped > 0) add(p, `recorta la pose: ${clipped} píxel(es) opacos en su borde`);
      if (f.feetX < 0 || f.feetX > f.width || f.feetY < 0 || f.feetY > f.height) add(p, "el punto de apoyo (feetX/feetY) cae fuera del frame");
      def.frames.forEach((g, j) => {
        if (j > i && f.x < g.x + g.width && g.x < f.x + f.width && f.y < g.y + g.height && g.y < f.y + f.height) add(p, `se solapa con el frame «${g.name}»`);
      });
    });

    for (const [aid, anim] of Object.entries(def.animations)) {
      const ap = `${at}.animations.${aid}`;
      if (anim.frames.length === 0) add(ap, "sin frames");
      for (const n of [...anim.frames, ...(anim.restFrame ? [anim.restFrame] : [])]) if (!names.has(n)) add(ap, `frame inexistente «${n}»`);
      if (!(anim.frameRate > 0)) add(ap, "frameRate debe ser positivo");
    }
  }
  return issues;
}
