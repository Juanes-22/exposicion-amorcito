import type { AssetEntry, AssetManifest, ConfigIssue } from "../contracts/assets";
import type { LaboratorioConfig } from "../contracts/config";
import { INVENTOR_ID } from "../contracts/config";
import { buildNavGrid, findPath, isFootprintFree, type NavGrid } from "../domain/navigation";
import { contentHash } from "./hash";
import { dirnamePosix, joinPosix } from "./paths";
import type { SheetDefinition } from "./frameDefinitions";
import { readTmj, type MapIndex } from "./tmj";
import { validateAssetManifest } from "./validateAssets";
import { validateConfig } from "./validateConfig";

/** Dónde vive el directorio del catálogo respecto de la base pública (donde está `maps/`). */
export interface PublicLayout {
  /** Directorio de `assets.json` relativo a la base pública, p. ej. `assets`. */
  assetsDir: string;
}

export interface ProjectInputs {
  /** JSON ya parseado de cada archivo: la validación nunca lee ni escribe disco. */
  config: unknown;
  manifest: unknown;
  tmj: unknown;
  frameSheets: Readonly<Record<string, Pick<SheetDefinition, "animations">>>;
  layout?: PublicLayout;
}

export interface ProjectBundle {
  config: LaboratorioConfig;
  manifest: AssetManifest;
  map: MapIndex;
  nav: NavGrid;
  /** Huellas de coherencia cliente/servidor (SPECS 4.2). */
  configHash: string;
  mapHash: string;
}

export type ProjectResult = { ok: true; bundle: ProjectBundle; notes: string[] } | { ok: false; issues: ConfigIssue[]; notes: string[] };

/** `$schema` es metadato del editor, no contenido: cambiarlo no debe invalidar las salas ya creadas con este contenido. */
function withoutEditorMetadata(config: unknown): unknown {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return config;
  const { $schema: _editorOnly, ...rest } = config as Record<string, unknown>;
  return rest;
}

const tmjIssue = (path: string, message: string): ConfigIssue => ({ file: "laboratorio.tmj", path, message });

/** Ruta pública (relativa a la base pública) que designa un `image` editorial de Tiled y la de un recurso del catálogo. */
function sameFile(mapPath: string, tiledImage: string, layout: PublicLayout, manifest: AssetManifest, entry: AssetEntry): boolean {
  const fromTiled = joinPosix(dirnamePosix(mapPath), tiledImage);
  const fromManifest = joinPosix(layout.assetsDir, manifest.basePath, entry.path);
  return fromTiled === fromManifest;
}

/**
 * Valida el paquete completo: catálogo, contenido, mapa y todas las referencias cruzadas. Es la única puerta de entrada:
 * la usan la CLI (`npm run validate:project`), el servidor al arrancar y el frontend antes de inicializar Phaser.
 * Nunca «arregla» ni reescribe nada (SPECS 9.5).
 */
export function validateProject(input: ProjectInputs): ProjectResult {
  const layout = input.layout ?? { assetsDir: "assets" };
  const notes: string[] = [];

  const assets = validateAssetManifest(input.manifest);
  if (!assets.ok) return { ok: false, issues: assets.issues, notes };
  const manifest = assets.value;

  const config = validateConfig(input.config, { manifest, frameSheets: input.frameSheets });
  // Sin forma válida no hay nada más que leer; con referencias rotas se sigue con el mapa para informar de todo a la vez.
  if (!config.ok && !("value" in config)) return { ok: false, issues: config.issues, notes };
  const cfg = config.value;
  const configIssues = config.ok ? [] : config.issues;

  const read = readTmj(input.tmj, cfg.world.mapPath.replace(/^.*\//, "").replace(/\.tmj$/, ""));
  if (read.map === null) return { ok: false, issues: [...configIssues, ...read.issues], notes };
  const map = read.map;
  const issues: ConfigIssue[] = [...configIssues, ...read.issues];

  // ---- recursos del mapa: existen y la ruta editorial resuelve al mismo archivo ----
  const checkImage = (where: string, assetId: string, image: string, kinds?: string[]) => {
    const entry = Object.hasOwn(manifest.assets, assetId) ? manifest.assets[assetId] : undefined;
    if (!entry) return void issues.push(tmjIssue(where, `asset ID no encontrado en assets.json: «${assetId}»`));
    if (kinds && !kinds.includes(entry.kind)) issues.push(tmjIssue(where, `«${assetId}» es de kind «${entry.kind}»; se esperaba ${kinds.join(" o ")}`));
    if (entry.type !== "image") issues.push(tmjIssue(where, `«${assetId}» no es una imagen`));
    if (image !== "" && !sameFile(cfg.world.mapPath, image, layout, manifest, entry)) {
      issues.push(tmjIssue(where, `la ruta del editor «${image}» no resuelve al archivo de «${assetId}» en assets.json («${joinPosix(layout.assetsDir, manifest.basePath, entry.path)}»)`));
    }
    return entry;
  };
  for (const ts of map.tilesets) {
    const where = `tileset «${ts.name}»`;
    const entry = checkImage(`${where} › propiedad assetId`, ts.assetId, ts.image, ["tileset"]);
    if (!entry) continue;
    if (entry.width !== undefined && entry.width !== ts.imageWidth) issues.push(tmjIssue(where, `imagewidth ${ts.imageWidth} no coincide con el catálogo (${entry.width})`));
    if (entry.height !== undefined && entry.height !== ts.imageHeight) issues.push(tmjIssue(where, `imageheight ${ts.imageHeight} no coincide con el catálogo (${entry.height})`));
    if (entry.tileWidth !== undefined && (entry.tileWidth !== ts.tileWidth || entry.tileHeight !== ts.tileHeight)) issues.push(tmjIssue(where, "el tamaño de tile no coincide con el catálogo"));
    if (entry.tileCount !== undefined && entry.tileCount !== ts.tileCount) issues.push(tmjIssue(where, `tilecount ${ts.tileCount} no coincide con el catálogo (${entry.tileCount})`));
    if (ts.columns !== Math.floor(ts.imageWidth / ts.tileWidth)) issues.push(tmjIssue(where, "columns no coincide con imagewidth / tilewidth"));
  }
  for (const layer of map.imageLayers) checkImage(`capa «${layer.name}» › propiedad assetId`, layer.assetId, layer.image);
  for (const d of map.decorations) checkImage(`capa «${d.layer}» › objeto #${d.objectId} › propiedad assetId`, d.assetId, "");
  for (const s of map.stations) checkImage(`capa de estaciones › objeto #${s.objectId} «${s.activityId}» › propiedad assetId`, s.assetId, "");
  if (map.inventor) checkImage(`Inventor #${map.inventor.objectId} › propiedad assetId`, map.inventor.assetId, "");
  for (const e of map.soundEmitters) {
    const entry = manifest.assets[e.assetId];
    if (!entry) issues.push(tmjIssue(`SoundEmitter #${e.objectId} › propiedad assetId`, `asset ID no encontrado: «${e.assetId}»`));
  }

  // ---- estaciones ↔ recorrido ----
  const routeSet = new Set(cfg.route);
  const seen = new Set<string>();
  for (const s of map.stations) {
    const where = `estación #${s.objectId} «${s.activityId}»`;
    if (s.activityId === INVENTOR_ID) issues.push(tmjIssue(`${where} › propiedad activityId`, `«${INVENTOR_ID}» se coloca con la clase Inventor, no con Station`));
    else if (!routeSet.has(s.activityId)) issues.push(tmjIssue(`${where} › propiedad activityId`, `«${s.activityId}» no está en route: para retirar una mesa quita su objeto y su ID de route (no basta ocultar la capa)`));
    if (seen.has(s.activityId)) issues.push(tmjIssue(`${where} › propiedad activityId`, `hay más de una estación para «${s.activityId}»`));
    seen.add(s.activityId);
  }
  for (const id of cfg.route) if (!seen.has(id)) issues.push(tmjIssue("estaciones", `falta la estación de «${id}»: añade un objeto Station con activityId «${id}»`));
  if (!map.inventor) issues.push(tmjIssue("estaciones", "falta el objeto Inventor"));

  // ---- spawn, transitabilidad y alcanzabilidad con la huella real ----
  const fp = cfg.world.player.footprint;
  const nav = buildNavGrid(map, fp);
  const spawn = map.spawns[cfg.world.initialSpawnId];
  if (!spawn) {
    issues.push(tmjIssue("spawns", `no existe el Spawn «${cfg.world.initialSpawnId}» (world.initialSpawnId)`));
  } else {
    if (!isFootprintFree(map, fp, spawn)) issues.push(tmjIssue(`Spawn «${cfg.world.initialSpawnId}»`, "la huella del personaje choca con una colisión o sale del mapa"));
    else {
      const targets = [...map.stations.map((s) => ({ name: `estación «${s.activityId}»`, point: s.point })), ...(map.inventor ? [{ name: "Inventor", point: map.inventor.point }] : [])];
      for (const t of targets) {
        if (!isFootprintFree(map, fp, t.point)) issues.push(tmjIssue(t.name, "su punto de interacción no es transitable: la huella del personaje choca con una colisión (el punto debe estar en suelo libre, frente a la mesa)"));
        else if (!findPath(map, fp, nav, spawn, t.point)) issues.push(tmjIssue(t.name, `no es alcanzable desde el Spawn «${cfg.world.initialSpawnId}»`));
      }
    }
  }
  for (const [id, p] of Object.entries(map.spawns)) if (!isFootprintFree(map, fp, p)) issues.push(tmjIssue(`Spawn «${id}»`, "la huella del personaje choca con una colisión o sale del mapa"));

  // ---- modo presentación: ningún recurso provisional del mapa puede quedar como final (SPECS 9.5) ----
  const mapAssets: Array<[string, string]> = [
    ...map.tilesets.map((t): [string, string] => [`tileset «${t.name}» › propiedad assetId`, t.assetId]),
    ...map.imageLayers.map((l): [string, string] => [`capa «${l.name}» › propiedad assetId`, l.assetId]),
    ...map.decorations.map((d): [string, string] => [`capa «${d.layer}» › objeto #${d.objectId} › propiedad assetId`, d.assetId]),
    ...map.stations.map((s): [string, string] => [`estación #${s.objectId} «${s.activityId}» › propiedad assetId`, s.assetId]),
    ...(map.inventor ? [[`Inventor #${map.inventor.objectId} › propiedad assetId`, map.inventor.assetId] as [string, string]] : []),
  ];
  if (cfg.mode === "presentation") {
    for (const [where, id] of mapAssets) if (manifest.assets[id]?.placeholder) issues.push(tmjIssue(where, `«${id}» es un recurso provisional: mode «presentation» no lo admite`));
  }

  // ---- avisos (no son errores) ----
  // Los sonidos asignados a eventos también cuentan: un sonido provisional en uso se avisa igual que un dibujo provisional.
  const audioAssets = Object.values(cfg.audio.events);
  const usedPlaceholders = [...new Set([...mapAssets.map(([, id]) => id), ...audioAssets])].filter((id) => manifest.assets[id]?.placeholder);
  if (usedPlaceholders.length > 0) notes.push(`${usedPlaceholders.length} recurso(s) provisional(es) en uso (permitido en mode «${cfg.mode}»): ${usedPlaceholders.join(", ")}`);

  if (issues.length > 0) return { ok: false, issues, notes };
  return { ok: true, bundle: { config: cfg, manifest, map, nav, configHash: contentHash(withoutEditorMetadata(input.config)), mapHash: contentHash(input.tmj) }, notes };
}
