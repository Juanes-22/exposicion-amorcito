import Phaser from "phaser";
import type { ShadowsActivityConfig } from "../../../shared/contracts/config";
import { getDeps } from "../createGame";
import { shadowLayout, TABLE_Y } from "../geometry/shadows";
import { STAGE } from "../geometry/stage";
import { addLabel, bindSceneLifecycle, fillPolygon, fitStage, JerryReaction, readActivity, setLabel, visibleStage } from "./activityShared";
import { SHADOWS_SCENE } from "./sceneKeys";


/**
 * Sombras, escena cercana de quien explora (o de la demostración de Vanessa). Dibuja el modelo ideal de fuente puntual con la geometría
 * de `geometry/shadows.ts` (la misma fórmula que la descripción textual). Mantiene fijos objeto y pantalla; solo se mueve la linterna,
 * que no atraviesa el objeto: la distancia mínima del rango la deja siempre a la izquierda de él (SPECS 3.2). La posición de la linterna
 * mientras se ajusta es local; al terminar el ajuste se registra su posición y su sombra, y quedan marcadas en la escena. Se comparan
 * tamaños a simple vista: la escena no muestra medidas.
 */
export class ShadowsScene extends Phaser.Scene {
  private cleanups: Array<() => void> = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private labels!: Record<"samples", Phaser.GameObjects.Text>;
  private jerry!: JerryReaction;
  private seen = { counted: -1 };

  constructor() {
    super(SHADOWS_SCENE);
  }

  private token = 0;

  init(): void {
    this.token = getDeps(this).bridge.beginScene();
  }

  create(): void {
    const { bridge } = getDeps(this);
    this.gfx = this.add.graphics().setDepth(5);
    this.labels = { samples: addLabel(this, 16, "#cdbf9d", false) };
    this.jerry = new JerryReaction(this, this.gfx, { x: 120, y: TABLE_Y - 40 });
    // En el celular, la cámara se acerca a la linterna (en todo su recorrido), el objeto, la pantalla y Jerry.
    fitStage(this, this.cleanups, { x: 10, y: 50, width: 620, height: 400 });
    bindSceneLifecycle(this, this.cleanups, () => this.jerry.destroy());
    bridge.emit("game:ready", { sceneKey: SHADOWS_SCENE, token: this.token });
  }

  override update(): void {
    const a = readActivity(this, "shadows");
    if (!a) return;
    const cfg = a.config as ShadowsActivityConfig;
    const { experiment: e } = cfg;
    const { bridge } = getDeps(this);
    const st = a.state;
    // La linterna se ve donde la persona la tiene ahora (local, sin esperar al servidor); en reposo, en la última posición registrada.
    const distanceCm = Math.min(e.sourceDistanceMaxCm, Math.max(e.sourceDistanceMinCm, bridge.local.lanternCm ?? st.samples.at(-1)?.distanceCm ?? e.sourceDistanceMinCm));
    const L = shadowLayout(distanceCm, e.screenDistanceCm, e.objectHeightCm);
    const g = this.gfx;
    g.clear();

    // Reacción de Jerry: cada posición que cuenta.
    const counted = st.samples.filter((s) => s.counts).length;
    if (this.seen.counted >= 0 && counted > this.seen.counted) this.jerry.trigger(counted >= e.requiredSamples ? "¡Guau, guau!" : "¡Guau!");
    this.seen = { counted };

    // Fondo y mesa.
    g.fillStyle(0x2f2418, 1).fillRect(0, 0, STAGE.width, STAGE.height);
    g.fillStyle(0x3e2f20, 1).fillRect(0, 0, STAGE.width, TABLE_Y);
    g.fillStyle(0x9a6a38, 1).fillRect(16, TABLE_Y, STAGE.width - 32, 30).fillStyle(0x7a4f2a, 1).fillRect(16, TABLE_Y + 30, STAGE.width - 32, 10);

    // Cono de luz y volumen de sombra (detrás del objeto).
    g.fillStyle(0xffe066, 0.22);
    fillPolygon(g, [{ x: L.sourceX + 18, y: TABLE_Y - 4 }, { x: L.screenX, y: L.shadowTopY }, { x: L.screenX, y: TABLE_Y }]);
    g.fillStyle(0x000000, 0.4);
    fillPolygon(g, [{ x: L.objectX, y: L.objectTopY }, { x: L.screenX, y: L.shadowTopY }, { x: L.screenX, y: TABLE_Y }, { x: L.objectX, y: TABLE_Y }]);
    g.lineStyle(2, 0xffe9a0, 0.7).lineBetween(L.sourceX + 18, TABLE_Y - 4, L.screenX, L.shadowTopY).lineBetween(L.sourceX + 18, TABLE_Y - 4, L.screenX, TABLE_Y);

    // Pantalla fija: la parte iluminada y la sombra.
    const boardTop = 70;
    g.fillStyle(0xe8e4d8, 1).fillRect(L.screenX, boardTop, 12, TABLE_Y - boardTop);
    g.fillStyle(0x1b1b1b, 0.92).fillRect(L.screenX - 16, L.shadowTopY, 16, L.shadowHeightPx);
    g.lineStyle(2, 0x1b1b1b, 1).strokeRect(L.screenX - 16, L.shadowTopY, 16, L.shadowHeightPx);
    // Los resultados ya registrados quedan como marcas en la pantalla, a la altura de cada sombra: así se comparan a simple vista.
    const counts = st.samples.filter((s) => s.counts);
    counts.forEach((s, i) => {
      const y = TABLE_Y - Math.min(s.shadowCm * L.scale, TABLE_Y - 54);
      const color = i === 0 ? 0x4e9a51 : 0x3b7dd8;
      g.lineStyle(4, color, 1).lineBetween(L.screenX + 14, y, L.screenX + 40, y);
    });

    // Objeto fijo (pequeño) y linterna.
    g.fillStyle(0x4a86d9, 1).fillRect(L.objectX - L.objectWidthPx / 2, L.objectTopY, L.objectWidthPx, L.objectHeightPx);
    g.lineStyle(2, 0x1d3f73, 1).strokeRect(L.objectX - L.objectWidthPx / 2, L.objectTopY, L.objectWidthPx, L.objectHeightPx);
    g.fillStyle(0x8d9aa5, 1).fillRoundedRect(L.sourceX - 20, TABLE_Y - 18, 36, 17, 4);
    g.fillStyle(0x6a7782, 1).fillRect(L.sourceX - 6, TABLE_Y - 18, 6, 17);
    g.fillStyle(0xf6d84b, 1).fillTriangle(L.sourceX + 16, TABLE_Y - 20, L.sourceX + 16, TABLE_Y - 1, L.sourceX + 26, TABLE_Y - 4 - 8);
    g.fillStyle(0xfff3a8, 1).fillCircle(L.sourceX + 18, TABLE_Y - 4, 4);

    // Posiciones anotadas: marcas sobre la mesa (las que cuentan, en verde).
    for (const s of st.samples) {
      const x = L.objectX - s.distanceCm * L.scale;
      g.fillStyle(s.counts ? 0x4e9a51 : 0x8b7b66, 1).fillTriangle(x - 7, TABLE_Y + 40, x + 7, TABLE_Y + 40, x, TABLE_Y + 28);
    }
    const vis = visibleStage(this);
    setLabel(this.labels.samples, `Posiciones comparadas: ${Math.min(counted, e.requiredSamples)} de ${e.requiredSamples}`, vis.left + 20, vis.top + 18, 0, 0);
    this.jerry.draw();
  }
}
