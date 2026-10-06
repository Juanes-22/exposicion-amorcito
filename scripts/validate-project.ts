// `npm run validate:project`: valida laboratorio.json, assets.json y el TMJ (y que cada archivo exista) sin escribir nada.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { frameDefinitions } from "../shared/config/frameDefinitions";
import { validateProject } from "../shared/config/validateProject";
import { validateFrameDefinitions } from "./lib/validateFrames";
import type { ConfigIssue } from "../shared/contracts/assets";

const PUBLIC = resolve("public");
const readJson = (rel: string): unknown => JSON.parse(readFileSync(resolve(PUBLIC, rel), "utf8"));

function fail(issues: ConfigIssue[], notes: string[]): never {
  console.error(`✖ ${issues.length} problema(s):`);
  for (const i of issues) console.error(`  · [${i.file}] ${i.path}: ${i.message}`);
  for (const n of notes) console.error(`  ℹ ${n}`);
  process.exit(1);
}

const config = readJson("config/laboratorio.json") as { world?: { mapPath?: string } };
const mapPath = config.world?.mapPath ?? "maps/laboratorio.tmj";
const manifest = readJson("assets/assets.json");
const tmj = readJson(mapPath);

const result = validateProject({ config, manifest, tmj, frameSheets: frameDefinitions, layout: { assetsDir: "assets" } });
if (!result.ok) fail(result.issues, result.notes);
const { bundle, notes } = result;

// Lo que solo se puede comprobar con el disco: cada recurso del catálogo existe y los frames coinciden con los píxeles.
const issues: ConfigIssue[] = [];
for (const [id, a] of Object.entries(bundle.manifest.assets)) {
  if (!existsSync(resolve(PUBLIC, "assets", bundle.manifest.basePath, a.path))) issues.push({ file: "assets.json", path: `assets.${id}.path`, message: `el archivo «${a.path}» no existe` });
  if (a.atlasPath && !existsSync(resolve(PUBLIC, "assets", bundle.manifest.basePath, a.atlasPath))) issues.push({ file: "assets.json", path: `assets.${id}.atlasPath`, message: `el atlas «${a.atlasPath}» no existe` });
}
if (issues.length === 0) issues.push(...validateFrameDefinitions(frameDefinitions, bundle.manifest, resolve(PUBLIC, "assets/assets.json")));
if (issues.length > 0) fail(issues, notes);

const { config: c, map } = bundle;
console.log("✔ Proyecto válido");
console.log(`  contenido  ${c.contentSetId} · revisión ${c.configRevision} · modo ${c.mode} · hash ${bundle.configHash.slice(0, 12)}`);
console.log(`  mapa       ${c.world.mapPath} · ${map.widthPx}×${map.heightPx} px · hash ${bundle.mapHash.slice(0, 12)}`);
console.log(`  recorrido  ${c.route.join(" → ")} → inventor`);
console.log(`  mapa: ${map.stations.length} estaciones, ${map.spawns ? Object.keys(map.spawns).length : 0} spawn(s), ${map.collisions.length} colisiones, ${map.decorations.length} decoraciones, ${map.tilesets.length} tileset(s)`);
console.log(`  catálogo   ${bundle.manifest.assetCount} recursos`);
for (const n of notes) console.log(`  ℹ ${n}`);
