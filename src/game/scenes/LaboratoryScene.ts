import Phaser from "phaser";
import { playerAt } from "../../../shared/domain/adventure";
import type { AssetFailure } from "../bridge/events";
import { getDeps } from "../createGame";
import { Player } from "../entities/Player";
import { ensureSheet } from "../sheets";
import { buildMap, MAP_KEY, requiredTextureAssets, type BuiltMap } from "../tiled/buildMap";

export const LABORATORY_SCENE = "LaboratoryScene";

/**
 * Laboratorio: mapa, mesas y personaje. Pinta lo que recibe por el puente y emite intenciones tipadas; no decide permisos,
 * posiciones autoritativas ni progreso (SPECS 7.2). La posición se interpola desde el plan del servidor, no desde el teléfono.
 */
export class LaboratoryScene extends Phaser.Scene {
  private token = 0;
  private built: BuiltMap | null = null;
  private player: Player | null = null;
  private cleanups: Array<() => void> = [];

  constructor() {
    super(LABORATORY_SCENE);
  }

  init(): void {
    this.token = getDeps(this).bridge.beginScene();
  }

  preload(): void {
    const { project, bridge } = getDeps(this);
    const { bundle, registry } = project;
    const failures: AssetFailure[] = [];

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => bridge.emit("game:load-progress", { value }));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => failures.push({ assetId: file.key, url: String(file.url) }));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (failures.length > 0 && bridge.isActive(this.token)) bridge.emit("game:asset-failures", { failures, token: this.token });
    });

    // El TMJ ya validado se entrega como objeto (sin segunda descarga). Se clona: el loader no debe poder alterar el original.
    this.load.tilemapTiledJSON(MAP_KEY, structuredClone(project.tmj) as object);
    // El TMJ no descarga las texturas por sí solo: se cargan por AssetRegistry, solo las referenciadas.
    for (const assetId of requiredTextureAssets(bundle.map, bundle.config)) this.load.image(assetId, registry.url(assetId));
  }

  create(): void {
    const { project, bridge, debug, reducedMotion } = getDeps(this);
    const { bundle, registry } = project;
    const { map, config } = bundle;

    ensureSheet(this, config.world.player.assetId);
    this.built = buildMap(this, { map, config, assets: registry, debug });

    const spawn = map.spawns[config.world.initialSpawnId]!;
    this.player = new Player(this, config.world.player.assetId, spawn, config.world.player.scale, reducedMotion);

    // La cámara muestra el mapa completo a escala 1 y gestiona la ampliación (SPECS 8.3).
    const fit = () => {
      const cam = this.cameras.main;
      const zoom = Math.min(this.scale.width / map.widthPx, this.scale.height / map.heightPx);
      cam.setZoom(zoom > 0 ? zoom : 1).centerOn(map.widthPx / 2, map.heightPx / 2);
    };
    fit();
    this.scale.on(Phaser.Scale.Events.RESIZE, fit);
    this.cleanups.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, fit));

    this.cleanups.push(bridge.on("app:snapshot", ({ state }) => this.player?.place(state.adventure.player.feet, state.adventure.player.facing, false)));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    // Un snapshot retenido llega a quien arranca después del emisor.
    const retained = bridge.snapshot;
    if (retained) this.player.place(retained.state.adventure.player.feet, retained.state.adventure.player.facing, false);
    bridge.emit("game:ready", { sceneKey: LABORATORY_SCENE, token: this.token });
  }

  override update(): void {
    const { bridge } = getDeps(this);
    const snap = bridge.snapshot;
    if (!snap || !this.player) return;
    const frame = bridge.frame;
    // Con muestras del servidor se interpola el plan aceptado; sin ellas, el último estado estable.
    const adv = snap.state.adventure;
    const sample = playerAt(adv, frame?.activeMs ?? adv.timeline.activeMs);
    this.player.place(sample.feet, sample.facing, sample.moving);
  }

  private teardown(): void {
    for (const off of this.cleanups.splice(0)) off();
    this.built?.destroy();
    this.built = null;
    this.player?.destroy();
    this.player = null;
  }
}
