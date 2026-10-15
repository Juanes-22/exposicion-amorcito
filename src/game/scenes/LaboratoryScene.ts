import Phaser from "phaser";
import { INVENTOR_ID } from "../../../shared/contracts/config";
import type { Point } from "../../../shared/contracts/geometry";
import { playerAt } from "../../../shared/domain/participant";
import { currentActivityId } from "../../../shared/domain/round";
import { newRequestId } from "../../app/ids";
import type { AssetFailure, MapIntent, VisualState } from "../bridge/events";
import { getDeps } from "../createGame";
import { CharacterView, ensureSilhouetteTextures } from "../entities/Character";
import { Player } from "../entities/Player";
import { easeCenter, fitFraming, followFraming, type Framing } from "../framing";
import { ensureSheet } from "../sheets";
import { buildMap, MAP_KEY, requiredTextureAssets, type BuiltMap } from "../tiled/buildMap";
import { LABORATORY_SCENE } from "./sceneKeys";

/** Un toque es un gesto corto y casi quieto; un arrastre o una pulsación larga no mueven al personaje. */
const TAP_MAX_TRAVEL_PX = 14;
const TAP_MAX_MS = 600;
/** Separación mínima entre intenciones: el servidor limita la frecuencia y un dedo nervioso no debe saturarlo. */
const TAP_MIN_GAP_MS = 120;
const FEEDBACK_DEPTH = 2_000_000;
/** Altura aproximada del torso sobre los pies: la cámara de seguimiento centra el cuerpo, no los pies. */
const FOLLOW_LIFT_PX = 40;

/**
 * Laboratorio compartido: mapa, mesas y los personajes de todas las personas. Pinta lo que recibe por el puente y emite intenciones
 * tipadas; no decide permisos, posiciones autoritativas ni progreso (SPECS 7.2). Cada posición se interpola desde el plan que aceptó el
 * servidor con el reloj de simulación ajustado por sus muestras: ni la posición ni el tiempo del teléfono son autoridad (SPECS 5.6).
 * Los personajes no se bloquean entre sí; los obstáculos del escenario sí conservan sus colisiones (las decide el servidor).
 */
export class LaboratoryScene extends Phaser.Scene {
  private token = 0;
  private built: BuiltMap | null = null;
  private guide: Player | null = null;
  private guideAt = "";
  private characters = new Map<string, CharacterView>();
  private cleanups: Array<() => void> = [];
  private framing: Framing | null = null;
  private lastTapAt = -Infinity;
  /** Dónde se tocó cada solicitud pendiente, para señalar su resultado en el mismo sitio. */
  private pending = new Map<string, Point>();
  private destination: Phaser.GameObjects.Graphics | null = null;
  private destinationPlan = "";
  private highlight: Phaser.GameObjects.Graphics | null = null;
  private stationSignature = "";

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
    // Al volver de una mesa el laboratorio se vuelve a crear: lo que ya está en caché no se descarga ni se registra otra vez.
    if (!this.cache.tilemap.exists(MAP_KEY)) this.load.tilemapTiledJSON(MAP_KEY, structuredClone(project.tmj) as object);
    // El TMJ no descarga las texturas por sí solo: se cargan por AssetRegistry, solo las referenciadas.
    for (const assetId of requiredTextureAssets(bundle.map, bundle.config)) if (!this.textures.exists(assetId)) this.load.image(assetId, registry.url(assetId));
  }

  create(): void {
    const { project, bridge, debug, reducedMotion } = getDeps(this);
    const { bundle, registry } = project;
    const { map, config } = bundle;

    ensureSheet(this, config.world.player.assetId);
    ensureSilhouetteTextures(this);
    this.built = buildMap(this, { map, config, assets: registry, debug });
    const spawn = map.spawns[config.world.initialSpawnId]!;
    // Vanessa y Jerry son la guía visual del laboratorio: acompañan la mesa habilitada, no son el personaje de nadie.
    this.guide = new Player(this, config.world.player.assetId, spawn, config.world.player.scale, reducedMotion);
    this.destination = this.add.graphics().setDepth(FEEDBACK_DEPTH - 1);
    this.highlight = this.add.graphics().setDepth(FEEDBACK_DEPTH - 2);

    // Un cambio de tamaño obliga a recalcular el encuadre desde cero (sin arrastrar el suavizado anterior).
    const reframe = () => void (this.framing = null);
    this.scale.on(Phaser.Scale.Events.RESIZE, reframe);
    this.cleanups.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, reframe));

    // Entrada: toque → intención en coordenadas de mundo. La escena no envía nada al servidor.
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.cleanups.push(() => this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this));

    this.cleanups.push(bridge.on("app:visual", (v) => this.applyVisual(v)));
    this.cleanups.push(bridge.on("app:request-result", (r) => this.onRequestResult(r)));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    // Un estado retenido llega a quien arranca después del emisor (SPECS 10.2).
    if (bridge.visual) this.applyVisual(bridge.visual);
    this.applyCamera(0);
    bridge.emit("game:ready", { sceneKey: LABORATORY_SCENE, token: this.token });
  }

  // ---- entrada ----------------------------------------------------------------------------------------------------

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const { bridge } = getDeps(this);
    if (!bridge.isActive(this.token)) return;
    if (pointer.getDistance() > TAP_MAX_TRAVEL_PX || pointer.getDuration() > TAP_MAX_MS) return;
    // La separación entre toques se mide con el reloj REAL del navegador: ni el reloj de la escena ni las marcas de Phaser sirven
    // (Phaser pausa y ralentiza su bucle en páginas en segundo plano, y un anti-rebote no puede depender de un reloj que se detiene).
    const t = performance.now();
    if (t - this.lastTapAt < TAP_MIN_GAP_MS) return;
    this.lastTapAt = t;

    // Pantalla → mundo con la cámara real: el servidor solo recibe coordenadas de mundo (SPECS 2.4).
    const w = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const world = { x: w.x, y: w.y };

    const stationId = this.stationAt(world);
    if (bridge.visual?.viewer.kind !== "participant") return; // la proyección solo mira
    const intent: MapIntent = stationId ? { type: "openStation", stationId } : { type: "move", target: world };
    const requestId = newRequestId();
    this.pending.set(requestId, world);
    if (this.pending.size > 8) this.pending.delete(this.pending.keys().next().value as string);
    this.ping(world, 0xe3b92c);
    bridge.emit("game:action-request", { intent, requestId, token: this.token });
  }

  /** ¿Se tocó una mesa (su dibujo, con un pequeño margen) o la máquina del inventor? */
  private stationAt(world: Point): string | null {
    if (!this.built) return null;
    const hit = (image: Phaser.GameObjects.Image) => Phaser.Geom.Rectangle.Contains(image.getBounds(), world.x, world.y);
    for (const [id, view] of this.built.stations) if (hit(view.image)) return id;
    if (this.built.inventor && hit(this.built.inventor.image)) return INVENTOR_ID;
    return null;
  }

  private onRequestResult({ requestId, accepted }: { requestId: string; accepted: boolean }): void {
    const at = this.pending.get(requestId);
    if (!at) return;
    this.pending.delete(requestId);
    this.ping(at, accepted ? 0x4e9a51 : 0xd9534f);
  }

  /** Anillo que señala dónde se tocó y cómo resultó. Sin animación si se pidió movimiento reducido. */
  private ping(at: Point, color: number): void {
    const { reducedMotion } = getDeps(this);
    const ring = this.add.circle(at.x, at.y, 10).setStrokeStyle(3, color, 1).setFillStyle(color, 0.12).setDepth(FEEDBACK_DEPTH);
    if (reducedMotion) return void this.time.delayedCall(400, () => ring.destroy());
    this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 520, ease: "Sine.easeOut", onComplete: () => ring.destroy() });
  }

  // ---- estado ----------------------------------------------------------------------------------------------------

  /** Mesas: la habilitada, las completadas y las que vienen; y la máquina del inventor. Se recalcula solo si cambia lo visible. */
  private applyVisual(v: VisualState): void {
    if (!this.built) return;
    const { project } = getDeps(this);
    const { config } = project.bundle;
    const adv = v.group;
    const current = currentActivityId(adv, config);
    const signature = JSON.stringify([current, adv.round.stage, adv.completed, adv.pieces.length, adv.inventor.open === true]);
    if (signature === this.stationSignature) return;
    this.stationSignature = signature;

    for (const [id, view] of this.built.stations) {
      const title = config.activities[id]?.title ?? id;
      const done = adv.completed.includes(id);
      const isCurrent = id === current && adv.round.stage !== "closing";
      view.image.setAlpha(done || isCurrent ? 1 : 0.55);
      const text = done ? `✓ ${title}` : isCurrent ? (adv.round.stage === "exploration" ? `${title} · abierta` : adv.round.stage === "conversation" ? `${title} · conversemos` : `${title} · próxima`) : `${title} (más adelante)`;
      view.label.setText(text).setAlpha(done || isCurrent ? 1 : 0.75);
    }
    const inv = this.built.inventor;
    if (inv) {
      const lit = adv.pieces.length >= config.inventor.requiredPieceIds.length;
      inv.image.setTexture(lit ? inv.onKey : inv.offKey).setAlpha(lit ? 1 : 0.55);
      const closing = adv.round.stage === "closing";
      const text = !lit ? `Inventor (${adv.pieces.length} de ${config.inventor.requiredPieceIds.length} piezas)` : closing && adv.inventor.open === true ? "Inventor · abierto" : closing ? "Inventor · próximo" : "Inventor";
      inv.label.setText(text).setAlpha(lit ? 1 : 0.75);
    }
    this.placeGuide(current);
  }

  /** La guía (Vanessa con Jerry) se queda junto a la mesa habilitada; sin mesa, junto a la máquina del inventor. */
  private placeGuide(current: string | null): void {
    if (!this.guide) return;
    const { project } = getDeps(this);
    const { map, config } = project.bundle;
    const key = current ?? INVENTOR_ID;
    if (key === this.guideAt) return;
    this.guideAt = key;
    const s = current ? map.stations.find((x) => x.activityId === current)?.point : map.inventor?.point;
    const base = s ?? map.spawns[config.world.initialSpawnId]!;
    this.guide.place({ x: base.x + 74, y: base.y + 8 }, "down", false);
  }

  // ---- dibujo por fotograma ------------------------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    const { bridge } = getDeps(this);
    const v = bridge.visual;
    if (!v) return;
    const clock = bridge.clock.now();
    this.syncCharacters(v, clock);
    this.drawHighlight(v);
    const me = v.viewer.kind === "participant" ? v.characters.find((c) => c.principalId === (v.viewer as { principalId: string }).principalId) : undefined;
    this.drawDestination(me?.character.plan ?? null, me ? playerAt(me.character, clock).moving : false);
    this.applyCamera(delta);
  }

  /** Crea, coloca y retira los personajes según el estado: cada posición sale del plan del servidor y del reloj de simulación. */
  private syncCharacters(v: VisualState, clock: number): void {
    const own = v.viewer.kind === "participant" ? v.viewer.principalId : null;
    const seen = new Set<string>();
    for (const c of v.characters) {
      seen.add(c.principalId);
      const sample = playerAt(c.character, clock);
      let view = this.characters.get(c.principalId);
      if (!view) {
        view = new CharacterView(this, sample.feet, { own: c.principalId === own, colorId: c.color, displayName: c.displayName });
        this.characters.set(c.principalId, view);
      }
      view.place(sample.feet, this.cameras.main.zoom * this.scale.zoom); // zoom en píxeles CSS: el lienzo va a la densidad de la pantalla
      view.update(c.displayName, c.connected);
    }
    for (const [id, view] of this.characters) {
      if (seen.has(id)) continue;
      view.destroy();
      this.characters.delete(id);
    }
  }

  /**
   * Un anillo que late alrededor de lo que hay que hacer ahora: la mesa habilitada mientras se explora y, en el cierre, la máquina del
   * inventor (más suave mientras Vanessa todavía no lo abre: es a donde hay que caminar).
   */
  private drawHighlight(v: VisualState): void {
    if (!this.highlight || !this.built) return;
    const { project, reducedMotion } = getDeps(this);
    this.highlight.clear();
    const stage = v.group.round.stage;
    let image: Phaser.GameObjects.Image | undefined;
    if (stage === "exploration") {
      const id = currentActivityId(v.group, project.bundle.config);
      image = id ? this.built.stations.get(id)?.image : undefined;
    } else if (stage === "closing" && v.phase !== "finished") image = this.built.inventor?.image;
    if (!image) return;
    const b = image.getBounds();
    const pulse = reducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(this.time.now / 300);
    const strength = stage === "closing" && v.group.inventor.open !== true ? 0.5 : 1;
    this.highlight.lineStyle(4, 0xffd9a0, (0.35 + 0.5 * pulse) * strength).strokeRoundedRect(b.x - 8, b.y - 8, b.width + 16, b.height + 16, 12);
  }

  /** Marca el destino del plan vigente mientras la persona camina: la misma señal en su teléfono y en la proyección. */
  private drawDestination(plan: { planId: string; points: Point[] } | null, moving: boolean): void {
    if (!this.destination) return;
    const key = plan && moving ? plan.planId : "";
    if (key !== this.destinationPlan) {
      this.destinationPlan = key;
      this.destination.clear();
      if (plan && moving) {
        const end = plan.points[plan.points.length - 1]!;
        this.destination.lineStyle(3, 0xffffff, 0.9).strokeCircle(end.x, end.y, 9).lineStyle(2, 0x3b2a1a, 0.7).strokeCircle(end.x, end.y, 12);
      }
    }
  }

  private applyCamera(delta: number): void {
    const { project, bridge, camera, reducedMotion } = getDeps(this);
    const { map } = project.bundle;
    const view = { width: this.scale.width, height: this.scale.height };
    const size = { width: map.widthPx, height: map.heightPx };
    const v = bridge.visual;
    let wanted: Framing;
    const mine = v?.viewer.kind === "participant" ? this.characters.get(v.viewer.principalId) : undefined;
    if (camera === "follow" && mine) {
      const here = mine.feet;
      wanted = followFraming(view, size, { x: here.x, y: here.y - FOLLOW_LIFT_PX });
    } else wanted = fitFraming(view, size);
    // La vista completa no necesita suavizado; el seguimiento sí, pero sin arrastrar un valor viejo tras cambiar de tamaño.
    this.framing = this.framing && camera === "follow" ? easeCenter(this.framing, wanted, delta, reducedMotion) : wanted;
    this.cameras.main.setZoom(this.framing.zoom).centerOn(this.framing.centerX, this.framing.centerY);
  }

  private teardown(): void {
    for (const off of this.cleanups.splice(0)) off();
    this.pending.clear();
    this.destination?.destroy();
    this.destination = null;
    this.highlight?.destroy();
    this.highlight = null;
    this.built?.destroy();
    this.built = null;
    for (const v of this.characters.values()) v.destroy();
    this.characters.clear();
    this.guide?.destroy();
    this.guide = null;
  }
}
