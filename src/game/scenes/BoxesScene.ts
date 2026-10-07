import Phaser from "phaser";
import type { BoxesActivityConfig } from "../../../shared/contracts/config";
import { getDeps } from "../createGame";
import { STAGE } from "../geometry/stage";
import { addLabel, bindSceneLifecycle, drawBubble, fillPolygon, fitStage, readActivity, setLabel } from "./activityShared";
import { BOXES_SCENE } from "./sceneKeys";


const TABLE_Y = 408;
const SHARED_X = 250;
const PERSONAL_X = 690;
const OBJECT_Y = 292;

/**
 * La caja de las sorpresas, escena cercana de quien explora (o de la demostración de Vanessa). Una sola escena con la caja compartida,
 * abierta, y la caja personal de una compañera ficticia, que **siempre** permanece cerrada: no existe dibujo, textura ni dato de su
 * contenido (SPECS 3.4). Elegir un objeto o pedir permiso se hace con los controles HTML; la escena solo refleja el estado.
 */
export class BoxesScene extends Phaser.Scene {
  private cleanups: Array<() => void> = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private labels!: Record<"shared" | "personal" | "owner" | "bubble" | "detailTitle" | "detail" | "marks", Phaser.GameObjects.Text>;

  constructor() {
    super(BOXES_SCENE);
  }

  private token = 0;

  init(): void {
    this.token = getDeps(this).bridge.beginScene();
  }

  create(): void {
    const { bridge } = getDeps(this);
    this.gfx = this.add.graphics().setDepth(5);
    this.labels = {
      shared: addLabel(this, 19),
      personal: addLabel(this, 19),
      owner: addLabel(this, 16, "#cdbf9d", false),
      bubble: addLabel(this, 18, "#3b2a1a", false).setWordWrapWidth(250).setDepth(12),
      detailTitle: addLabel(this, 22, "#ffd9a0"),
      detail: addLabel(this, 17, "#fff8e6", false).setWordWrapWidth(380),
      marks: addLabel(this, 22, "#7ed37e"),
    };
    fitStage(this, this.cleanups);
    bindSceneLifecycle(this, this.cleanups);
    bridge.emit("game:ready", { sceneKey: BOXES_SCENE, token: this.token });
  }

  override update(): void {
    const a = readActivity(this, "boxes");
    if (!a) return;
    const { project } = getDeps(this);
    const cfg = a.config as BoxesActivityConfig;
    const dialogues = project.bundle.config.dialogues;
    const st = a.state;
    const g = this.gfx;
    g.clear();

    g.fillStyle(0x2f2418, 1).fillRect(0, 0, STAGE.width, STAGE.height);
    g.fillStyle(0x3e2f20, 1).fillRect(0, 0, STAGE.width, TABLE_Y);
    g.fillStyle(0x9a6a38, 1).fillRect(16, TABLE_Y, STAGE.width - 32, 30).fillStyle(0x7a4f2a, 1).fillRect(16, TABLE_Y + 30, STAGE.width - 32, 10);

    this.drawSharedBox(g, true);
    cfg.sharedObjects.forEach((o, i) => {
      const x = SHARED_X - 80 + i * 80;
      const selected = st.selectedObjectId === o.id;
      this.drawObject(g, o.id, x, OBJECT_Y, selected ? 1.35 : 1);
      if (selected) g.lineStyle(4, 0xf6d84b, 1).strokeCircle(x, OBJECT_Y, 44);
      if (st.inspected.includes(o.id)) {
        g.lineStyle(5, 0x7ed37e, 1).lineBetween(x + 22, OBJECT_Y - 52, x + 30, OBJECT_Y - 44).lineBetween(x + 30, OBJECT_Y - 44, x + 44, OBJECT_Y - 62);
      }
    });
    setLabel(this.labels.shared, "Para explorar", SHARED_X, TABLE_Y + 60);

    // Caja personal: cerrada, con candado. No se dibuja ni se calcula nada de su interior.
    this.drawPersonalBox(g);
    setLabel(this.labels.personal, cfg.personalBox.label, PERSONAL_X, TABLE_Y + 60);
    setLabel(this.labels.owner, cfg.personalBox.ownerLabel, PERSONAL_X, TABLE_Y + 84);

    // Compañera ficticia y su respuesta.
    const refusal = st.askedPermission ? dialogues[cfg.refusalDialogueId] ?? "" : "";
    this.drawPeer(g, 850, TABLE_Y);
    if (refusal) {
      if (this.labels.bubble.text !== refusal) this.labels.bubble.setText(refusal);
      const w = this.labels.bubble.width + 28;
      const h = this.labels.bubble.height + 22;
      drawBubble(g, 842 - w + 36, TABLE_Y - 260, w, h, { x: 850, y: TABLE_Y - 200 });
      this.labels.bubble.setPosition(842 - w + 36 + 14, TABLE_Y - 260 + 11).setOrigin(0, 0).setVisible(true);
    } else this.labels.bubble.setVisible(false);

    // Detalle del objeto elegido: el texto equivalente de lo que se ve, se oye o se observa.
    const sel = cfg.sharedObjects.find((o) => o.id === st.selectedObjectId);
    if (sel) {
      g.fillStyle(0x3e2f20, 1).fillRoundedRect(36, 24, 440, 130, 12).lineStyle(3, 0x9a6a38, 1).strokeRoundedRect(36, 24, 440, 130, 12);
      setLabel(this.labels.detailTitle, sel.label, 56, 38, 0, 0);
      if (this.labels.detail.text !== sel.description) this.labels.detail.setText(sel.description);
      this.labels.detail.setPosition(56, 74).setOrigin(0, 0).setVisible(true);
      this.labels.detailTitle.setVisible(true);
    } else {
      this.labels.detail.setVisible(false);
      this.labels.detailTitle.setVisible(false);
    }
    this.labels.marks.setVisible(false);
  }

  private drawSharedBox(g: Phaser.GameObjects.Graphics, open: boolean): void {
    const w = 250;
    const h = 108;
    g.fillStyle(0xc89a5b, 1).fillRect(SHARED_X - w / 2, TABLE_Y - h, w, h).lineStyle(3, 0x7a5a30, 1).strokeRect(SHARED_X - w / 2, TABLE_Y - h, w, h);
    g.fillStyle(0xa87f45, 1).fillRect(SHARED_X - w / 2 + 12, TABLE_Y - h + 18, w - 24, 10);
    if (open) {
      g.fillStyle(0xb98a4b, 1);
      fillPolygon(g, [{ x: SHARED_X - w / 2, y: TABLE_Y - h }, { x: SHARED_X - w / 2 - 28, y: TABLE_Y - h - 46 }, { x: SHARED_X - w / 2 + 70, y: TABLE_Y - h - 46 }, { x: SHARED_X - w / 2 + 70, y: TABLE_Y - h }]);
      fillPolygon(g, [{ x: SHARED_X + w / 2, y: TABLE_Y - h }, { x: SHARED_X + w / 2 + 28, y: TABLE_Y - h - 46 }, { x: SHARED_X + w / 2 - 70, y: TABLE_Y - h - 46 }, { x: SHARED_X + w / 2 - 70, y: TABLE_Y - h }]);
    } else {
      g.fillStyle(0xb98a4b, 1).fillRect(SHARED_X - w / 2 - 6, TABLE_Y - h - 14, w + 12, 18).lineStyle(3, 0x7a5a30, 1).strokeRect(SHARED_X - w / 2 - 6, TABLE_Y - h - 14, w + 12, 18);
    }
  }

  private drawPersonalBox(g: Phaser.GameObjects.Graphics): void {
    const w = 230;
    const h = 112;
    g.fillStyle(0x8a6fc2, 1).fillRect(PERSONAL_X - w / 2, TABLE_Y - h, w, h).lineStyle(3, 0x4f3a86, 1).strokeRect(PERSONAL_X - w / 2, TABLE_Y - h, w, h);
    g.fillStyle(0x7658b0, 1).fillRect(PERSONAL_X - w / 2 - 6, TABLE_Y - h - 14, w + 12, 24).lineStyle(3, 0x4f3a86, 1).strokeRect(PERSONAL_X - w / 2 - 6, TABLE_Y - h - 14, w + 12, 24);
    // Candado.
    g.lineStyle(6, 0x3b2a1a, 1).strokeCircle(PERSONAL_X, TABLE_Y - h + 22, 14);
    g.fillStyle(0xf3d36b, 1).fillRoundedRect(PERSONAL_X - 20, TABLE_Y - h + 30, 40, 32, 6).lineStyle(3, 0x7a5a1a, 1).strokeRoundedRect(PERSONAL_X - 20, TABLE_Y - h + 30, 40, 32, 6);
    g.fillStyle(0x3b2a1a, 1).fillCircle(PERSONAL_X, TABLE_Y - h + 44, 4).fillRect(PERSONAL_X - 2, TABLE_Y - h + 44, 4, 10);
  }

  private drawPeer(g: Phaser.GameObjects.Graphics, x: number, groundY: number): void {
    g.fillStyle(0x6a3a5a, 1).fillRect(x - 16, groundY - 66, 13, 66).fillRect(x + 3, groundY - 66, 13, 66);
    g.fillStyle(0xd6609b, 1).fillRoundedRect(x - 28, groundY - 142, 56, 82, 10);
    g.fillStyle(0xf0c8a0, 1).fillCircle(x, groundY - 162, 23);
    g.fillStyle(0x2f2418, 1).fillRect(x - 23, groundY - 186, 46, 15);
  }

  /** Objetos compartidos con formas simples. Los IDs desconocidos se dibujan como una bolita neutra con su etiqueta en el HTML. */
  private drawObject(g: Phaser.GameObjects.Graphics, id: string, x: number, y: number, s: number): void {
    switch (id) {
      case "campanita":
        g.fillStyle(0xf3c64f, 1);
        fillPolygon(g, [{ x: x - 24 * s, y: y + 20 * s }, { x: x - 14 * s, y: y - 14 * s }, { x: x + 14 * s, y: y - 14 * s }, { x: x + 24 * s, y: y + 20 * s }]);
        g.fillCircle(x, y - 18 * s, 6 * s).fillStyle(0x7a5a1a, 1).fillCircle(x, y + 24 * s, 5 * s);
        break;
      case "lupa":
        g.lineStyle(7 * s, 0x5e3b1f, 1).lineBetween(x + 12 * s, y + 12 * s, x + 30 * s, y + 32 * s);
        g.fillStyle(0xcfeaf5, 0.65).fillCircle(x - 4 * s, y - 4 * s, 22 * s).lineStyle(5 * s, 0x8d9aa5, 1).strokeCircle(x - 4 * s, y - 4 * s, 22 * s);
        break;
      case "piedra":
        g.fillStyle(0x9a948a, 1).fillEllipse(x, y + 8 * s, 56 * s, 38 * s).fillStyle(0x7e786e, 1).fillEllipse(x + 8 * s, y + 12 * s, 22 * s, 14 * s);
        break;
      default:
        g.fillStyle(0xcdbf9d, 1).fillCircle(x, y, 22 * s);
    }
  }
}
