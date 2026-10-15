import Phaser from "phaser";
import type { MapIndex } from "../../../shared/config/tmj";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AssetRegistry } from "../../config/assetRegistry";
import { crispText } from "../crispText";

/** Clave del mapa en la caché de Phaser. */
export const MAP_KEY = "laboratorio";

const BACKGROUND_DEPTH = -1_000_000;
const FOREGROUND_DEPTH = 1_000_000;

/** Recursos gráficos que hay que descargar: los del mapa, la máquina encendida y el personaje. Nada más del catálogo. */
export function requiredTextureAssets(map: MapIndex, config: LaboratorioConfig): string[] {
  const ids = new Set<string>();
  for (const t of map.tilesets) ids.add(t.assetId);
  for (const l of map.imageLayers) ids.add(l.assetId);
  for (const d of map.decorations) if (d.visible) ids.add(d.assetId);
  for (const s of map.stations) ids.add(s.assetId);
  if (map.inventor) ids.add(map.inventor.assetId);
  ids.add(config.inventor.activeAssetId);
  ids.add(config.world.player.assetId);
  return [...ids];
}

export interface StationView {
  activityId: string;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

export interface BuiltMap {
  tilemap: Phaser.Tilemaps.Tilemap;
  stations: Map<string, StationView>;
  inventor: { image: Phaser.GameObjects.Image; offKey: string; onKey: string; label: Phaser.GameObjects.Text } | null;
  debug: Phaser.GameObjects.Graphics | null;
  destroy(): void;
}

export interface BuildOptions {
  map: MapIndex;
  config: LaboratorioConfig;
  assets: AssetRegistry;
  debug: boolean;
}

/**
 * Construye el mapa desde el TMJ ya cargado con `load.tilemapTiledJSON` (SPECS 8.5): tile layers con las APIs nativas, capas de
 * imagen y decoraciones dibujadas explícitamente con los datos originales, y Station/Inventor como objetos con sus gráficos.
 * Orden visual: fondo → suelo → objetos ordenados por pies → primer plano. No es un parser alternativo de Tiled.
 */
export function buildMap(scene: Phaser.Scene, { map, config, assets, debug }: BuildOptions): BuiltMap {
  const tilemap = scene.make.tilemap({ key: MAP_KEY });
  const created: Phaser.GameObjects.GameObject[] = [];

  const tilesets = map.tilesets.map((t) => {
    // El nombre del tileset en el TMJ enlaza con la textura registrada bajo su assetId.
    const ts = tilemap.addTilesetImage(t.name, t.assetId, t.tileWidth, t.tileHeight);
    if (!ts) throw new Error(`No se pudo crear el tileset «${t.name}» (assetId «${t.assetId}»)`);
    return ts;
  });
  for (const info of map.tileLayers) {
    const layer = tilemap.createLayer(info.name, tilesets, 0, 0);
    if (!layer) throw new Error(`No se pudo crear la capa de tiles «${info.name}»`);
    layer.setDepth(info.name === "foreground" ? FOREGROUND_DEPTH + info.index : BACKGROUND_DEPTH + info.index).setAlpha(info.opacity).setVisible(info.visible);
    created.push(layer);
  }
  for (const info of map.imageLayers) {
    const img = scene.add.image(info.x, info.y, info.assetId).setOrigin(0, 0).setAlpha(info.opacity).setVisible(info.visible);
    img.setDepth(info.name === "foreground" ? FOREGROUND_DEPTH + info.index : BACKGROUND_DEPTH + info.index);
    created.push(img);
  }

  for (const d of map.decorations) {
    if (!d.visible) continue;
    const img = scene.add.image(d.point.x, d.point.y, d.assetId).setOrigin(d.origin.x, d.origin.y).setScale(d.scale);
    img.setDepth(d.depthMode === "back" ? BACKGROUND_DEPTH / 2 : d.depthMode === "front" ? FOREGROUND_DEPTH / 2 : d.point.y);
    created.push(img);
  }

  const label = (x: number, y: number, text: string) =>
    crispText(
      scene.add.text(x, y, text, { fontFamily: "Nunito Variable, Nunito, sans-serif", fontSize: "15px", fontStyle: "bold", color: "#fff8e6", backgroundColor: "#3b2a1acc", padding: { x: 6, y: 3 } }),
    )
      .setOrigin(0.5, 1)
      .setDepth(FOREGROUND_DEPTH / 4);

  const stations = new Map<string, StationView>();
  for (const s of map.stations) {
    const origin = assets.get(s.assetId).origin ?? { x: 0.5, y: 1 };
    const image = scene.add.image(s.point.x, s.point.y, s.assetId).setOrigin(origin.x, origin.y).setScale(s.scale).setDepth(s.point.y);
    const lbl = label(s.point.x, s.point.y - image.displayHeight + 4, config.activities[s.activityId]?.title ?? s.activityId);
    stations.set(s.activityId, { activityId: s.activityId, image, label: lbl });
    created.push(image, lbl);
  }

  let inventor: BuiltMap["inventor"] = null;
  if (map.inventor) {
    const i = map.inventor;
    const origin = assets.get(i.assetId).origin ?? { x: 0.5, y: 1 };
    const image = scene.add.image(i.point.x, i.point.y, i.assetId).setOrigin(origin.x, origin.y).setScale(i.scale).setDepth(i.point.y);
    const lbl = label(i.point.x, i.point.y - image.displayHeight + 4, "Inventor");
    inventor = { image, offKey: i.assetId, onKey: config.inventor.activeAssetId, label: lbl };
    created.push(image, lbl);
  }

  let overlay: Phaser.GameObjects.Graphics | null = null;
  if (debug) {
    overlay = scene.add.graphics().setDepth(FOREGROUND_DEPTH * 2);
    overlay.fillStyle(0xd9534f, 0.35);
    for (const c of map.collisions) overlay.fillRect(c.x, c.y, c.width, c.height);
    overlay.lineStyle(2, 0x2f9c95, 0.9);
    for (const s of [...map.stations, ...(map.inventor ? [map.inventor] : [])]) overlay.strokeCircle(s.point.x, s.point.y, s.interactionRadius);
    overlay.fillStyle(0xe3b92c, 1);
    for (const p of [...Object.values(map.spawns), ...map.stations.map((s) => s.point), ...(map.inventor ? [map.inventor.point] : [])]) overlay.fillCircle(p.x, p.y, 4);
    // Huella del personaje en el spawn: la misma convención de pies que usan navegación y servidor.
    const fp = config.world.player.footprint;
    const spawn = map.spawns[config.world.initialSpawnId];
    if (spawn) {
      overlay.lineStyle(2, 0x3b7dd8, 1);
      overlay.strokeRect(spawn.x - fp.width / 2, spawn.y - fp.height, fp.width, fp.height);
    }
    created.push(overlay);
  }

  return {
    tilemap,
    stations,
    inventor,
    debug: overlay,
    destroy() {
      for (const o of created) o.destroy();
      tilemap.destroy();
    },
  };
}
