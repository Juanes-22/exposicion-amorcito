import Phaser from "phaser";
import { getDeps } from "../createGame";
import { STAGE } from "../geometry/stage";
import { addLabel, bindSceneLifecycle, fitStage, JerryReaction, setLabel } from "./activityShared";
import { drawPiece } from "./pieceGlyphs";
import { INVENTOR_SCENE } from "./sceneKeys";

const SLOT_Y = 118;
const TRAY_Y = 478;
const SLOT_XS = [330, 480, 630] as const;
const MACHINE = { x: 270, y: 256, w: 420, h: 176 } as const;
/** Los tubos hacia los espacios empiezan debajo de los mensajes de las piezas, que ocupan hasta ~SLOT_Y + 108. */
const PIPE_TOP = SLOT_Y + 112;
/** Cada pieza viaja ~700 ms y empieza 650 ms después de la anterior. */
const FLY_MS = 700;
const STAGGER_MS = 650;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * El inventor de preguntas, escena cercana (SPECS 3.5). Tres espacios y la máquina: apagada hasta colocar las piezas; al colocarlas cada
 * pieza viaja a su espacio y se identifica con su mensaje; al elegir la pregunta final la máquina «imprime» la tarjeta. La escena solo
 * pinta lo que dice el snapshot: no decide nada ni habla con el servidor.
 */
export class InventorScene extends Phaser.Scene {
  private cleanups: Array<() => void> = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private slotLabels: Phaser.GameObjects.Text[] = [];
  private labels!: Record<"title" | "question" | "kicker", Phaser.GameObjects.Text>;
  private jerry!: JerryReaction;
  private token = 0;
  /** Momento (reloj de la escena) en que se vio pasar a «colocadas», o -∞ si ya lo estaban al abrir la escena. */
  private placedAt: number | null = null;
  private seenFinal: boolean | null = null;

  constructor() {
    super(INVENTOR_SCENE);
  }

  init(): void {
    this.token = getDeps(this).bridge.beginScene();
    this.placedAt = null;
    this.seenFinal = null;
  }

  create(): void {
    const { bridge } = getDeps(this);
    this.gfx = this.add.graphics().setDepth(5);
    this.slotLabels = SLOT_XS.map(() => addLabel(this, 15, "#fff8e6", false).setAlign("center").setWordWrapWidth(150));
    this.labels = {
      title: addLabel(this, 24, "#ffd9a0"),
      question: addLabel(this, 20, "#3b2a1a", true).setAlign("center").setWordWrapWidth(500).setDepth(12),
      kicker: addLabel(this, 14, "#7a4f2a", false).setDepth(12),
    };
    this.jerry = new JerryReaction(this, this.gfx, { x: 110, y: TRAY_Y - 10 });
    fitStage(this, this.cleanups);
    bindSceneLifecycle(this, this.cleanups, () => this.jerry.destroy());
    bridge.emit("game:ready", { sceneKey: INVENTOR_SCENE, token: this.token });
  }

  override update(): void {
    const { bridge, project, reducedMotion } = getDeps(this);
    const snap = bridge.snapshot;
    if (!snap || snap.state.adventure.view.kind !== "final") return;
    const adv = snap.state.adventure;
    const { config } = project.bundle;
    const inv = config.inventor;
    const placed = adv.inventor.piecesPlaced;
    const final = adv.notebook.find((r) => r.id === adv.inventor.finalQuestionId);
    const now = this.time.now;

    // Solo se anima la TRANSICIÓN vista en esta escena; si ya estaba colocado al abrir (recarga, revisita), se muestra directo.
    if (this.placedAt === null && placed) this.placedAt = this.seenFinal === null ? Number.NEGATIVE_INFINITY : now;
    if (this.seenFinal !== null && !this.seenFinal && final) this.jerry.trigger("¡Guau, guau!");
    this.seenFinal = !!final;
    if (this.placedAt !== null && this.placedAt === now) this.jerry.trigger("¡Guau!");
    const elapsed = this.placedAt === null ? 0 : reducedMotion ? Number.POSITIVE_INFINITY : now - this.placedAt;
    const total = FLY_MS + STAGGER_MS * (inv.requiredPieceIds.length - 1);
    const lit = placed && elapsed >= total;

    const g = this.gfx;
    g.clear();
    g.fillStyle(0x2f2418, 1).fillRect(0, 0, STAGE.width, STAGE.height);
    g.fillStyle(0x3e2f20, 1).fillRect(0, 0, STAGE.width, 440);
    g.fillStyle(0x9a6a38, 1).fillRect(16, 440, STAGE.width - 32, 20).fillStyle(0x7a4f2a, 1).fillRect(16, 460, STAGE.width - 32, 8);

    // Máquina: cuerpo, panel, tubos hacia los espacios y luces. Apagada en grises; encendida, cálida y con un pulso suave.
    const pulse = lit && !reducedMotion ? 0.5 + 0.5 * Math.sin(now / 320) : 0;
    const bodyColor = lit ? 0xd9a441 : 0x6b5a48;
    if (lit) g.fillStyle(0xffe9a0, 0.14 + 0.1 * pulse).fillCircle(MACHINE.x + MACHINE.w / 2, MACHINE.y + MACHINE.h / 2, 205);
    for (const x of SLOT_XS) g.lineStyle(10, lit ? 0xb27d22 : 0x54463a, 1).lineBetween(x, PIPE_TOP, x, MACHINE.y + 6);
    g.fillStyle(bodyColor, 1).fillRoundedRect(MACHINE.x, MACHINE.y, MACHINE.w, MACHINE.h, 18).lineStyle(4, 0x3b2a1a, 1).strokeRoundedRect(MACHINE.x, MACHINE.y, MACHINE.w, MACHINE.h, 18);
    g.fillStyle(lit ? 0xfff0b8 : 0x3a2f26, 1).fillRoundedRect(MACHINE.x + 40, MACHINE.y + 36, 190, 80, 10).lineStyle(3, 0x3b2a1a, 1).strokeRoundedRect(MACHINE.x + 40, MACHINE.y + 36, 190, 80, 10);
    for (let i = 0; i < 3; i++) g.fillStyle(lit ? [0x4e9a51, 0xe3b92c, 0xd9534f][i]! : 0x4a3d32, 1).fillCircle(MACHINE.x + 270 + i * 44, MACHINE.y + 56, 13).lineStyle(3, 0x3b2a1a, 1).strokeCircle(MACHINE.x + 270 + i * 44, MACHINE.y + 56, 13);
    g.fillStyle(0x3b2a1a, 1).fillRect(MACHINE.x + 250, MACHINE.y + 110, 130, 12);

    // Espacios y piezas. Antes de colocar, las piezas esperan abajo (las conseguidas, a color; las que faltan, solo contorno).
    inv.requiredPieceIds.forEach((pieceId, i) => {
      const x = SLOT_XS[i]!;
      g.lineStyle(4, 0xcdbf9d, 1).strokeCircle(x, SLOT_Y, 46);
      g.fillStyle(0x2a2016, 0.85).fillCircle(x, SLOT_Y, 44);
      const have = adv.pieces.includes(pieceId);
      if (!placed) {
        drawPiece(g, pieceId, x, TRAY_Y, 62, have);
        return;
      }
      const p = ease(clamp01((elapsed - i * STAGGER_MS) / FLY_MS));
      const py = TRAY_Y + (SLOT_Y - TRAY_Y) * p;
      drawPiece(g, pieceId, x, py, 62 + 8 * p, have);
      if (p >= 1) g.lineStyle(4, 0xf6d84b, 0.5 + 0.4 * pulse).strokeCircle(x, SLOT_Y, 52);
    });

    // Mensaje de cada pieza, al llegar a su espacio.
    inv.requiredPieceIds.forEach((pieceId, i) => {
      const piece = inv.pieces.find((p) => p.id === pieceId);
      const arrived = placed && elapsed - i * STAGGER_MS >= FLY_MS;
      const t = this.slotLabels[i]!;
      if (arrived && piece) {
        const text = `${piece.label}\n${piece.message}`;
        if (t.text !== text) t.setText(text);
        t.setOrigin(0.5, 0).setPosition(SLOT_XS[i]!, SLOT_Y + 58).setVisible(true);
      } else t.setVisible(false);
    });
    setLabel(this.labels.title, "El inventor de preguntas", STAGE.width / 2, 30);

    // Tarjeta con la pregunta elegida: sale de la máquina.
    if (final) {
      const text = final.modality === "oral" ? inv.oralQuestionText : (final.text ?? "");
      if (this.labels.question.text !== text) this.labels.question.setText(text);
      const w = 560;
      const h = Math.max(70, this.labels.question.height + 44);
      const x = STAGE.width / 2 - w / 2 + 70;
      const y = MACHINE.y + MACHINE.h - 4;
      g.fillStyle(0xfffaf0, 1).fillRoundedRect(x, y, w, h, 8).lineStyle(3, 0x7a4f2a, 1).strokeRoundedRect(x, y, w, h, 8);
      setLabel(this.labels.kicker, "Nuestra pregunta", x + 16, y + 10, 0, 0);
      this.labels.kicker.setVisible(true);
      this.labels.question.setPosition(x + w / 2, y + 34).setOrigin(0.5, 0).setVisible(true);
    } else {
      this.labels.question.setVisible(false);
      this.labels.kicker.setVisible(false);
    }
    this.jerry.draw();
  }
}
