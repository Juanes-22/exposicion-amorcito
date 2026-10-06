import Phaser from "phaser";
import { formatNumber } from "../../../shared/domain/models";
import type { RampsActivityConfig } from "../../../shared/contracts/config";
import { getDeps } from "../createGame";
import { BALL_RADIUS_PX, GROUND_Y, RAMP_BOTTOM_X, rampLayout, rampLayoutAt, RAMP_LENGTH_PX } from "../geometry/ramps";
import { STAGE } from "../geometry/stage";
import { addLabel, bindSceneLifecycle, drawBubble, fillPolygon, fitStage, readActivity, setLabel } from "./activityShared";
import { RAMPS_SCENE } from "./sceneKeys";


/**
 * Rampas, escena cercana. La pelota sigue `s/L = min(1, (t/T)²)` con el tiempo transcurrido de la simulación visual, que sale del
 * reloj de simulación (se detiene en la pausa): ni el teléfono ni la proyección deciden cuándo empieza o termina una prueba, y el
 * tiempo mostrado es el de esa simulación, no una medición real de laboratorio (SPECS 3.3).
 */
export class RampsScene extends Phaser.Scene {
  private cleanups: Array<() => void> = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private labels!: Record<"angle" | "timer" | "result" | "count" | "bubble" | "guide" | "guideTitle", Phaser.GameObjects.Text>;

  constructor() {
    super(RAMPS_SCENE);
  }

  private token = 0;

  init(): void {
    this.token = getDeps(this).bridge.beginScene();
  }

  create(): void {
    const { bridge } = getDeps(this);
    this.gfx = this.add.graphics().setDepth(5);
    const wrap = (width: number, size: number, color: string) => addLabel(this, size, color, false).setWordWrapWidth(width).setAlign("left");
    this.labels = {
      angle: addLabel(this, 20),
      timer: addLabel(this, 22, "#ffd9a0"),
      result: addLabel(this, 18, "#cdbf9d", false),
      count: addLabel(this, 16, "#cdbf9d", false),
      bubble: wrap(300, 19, "#3b2a1a").setDepth(12),
      guide: wrap(300, 16, "#3b2a1a").setDepth(12),
      guideTitle: addLabel(this, 15, "#7a4f2a"),
    };
    fitStage(this, this.cleanups);
    bindSceneLifecycle(this, this.cleanups);
    bridge.emit("game:ready", { sceneKey: RAMPS_SCENE, token: this.token });
  }

  override update(): void {
    const a = readActivity(this, "ramps");
    if (!a) return;
    const { bridge, project } = getDeps(this);
    const cfg = a.config as RampsActivityConfig;
    const dialogues = project.bundle.config.dialogues;
    const st = a.state;
    const g = this.gfx;
    g.clear();

    const running = st.trials.find((t) => t.state === "running");
    const finished = st.trials.filter((t) => t.state === "finished");
    const last = st.trials[st.trials.length - 1];
    // La prueba en marcha dibuja su propia inclinación (congelada al crearla); en reposo, la que está elegida.
    const angle = running ? running.angleDeg : st.angleDeg;
    const elapsed = running ? bridge.clock.now() - running.startActiveMs : 0;
    const restAtBottom = !running && last?.state === "finished" && last.angleDeg === st.angleDeg;
    const L = running ? rampLayoutAt(angle, elapsed, running.durationMs) : rampLayout(angle, restAtBottom ? 1 : 0);

    // Fondo y suelo.
    g.fillStyle(0x2f2418, 1).fillRect(0, 0, STAGE.width, STAGE.height);
    g.fillStyle(0x3e2f20, 1).fillRect(0, 0, STAGE.width, GROUND_Y);
    g.fillStyle(0x9a6a38, 1).fillRect(16, GROUND_Y, STAGE.width - 32, 30).fillStyle(0x7a4f2a, 1).fillRect(16, GROUND_Y + 30, STAGE.width - 32, 10);

    // Rampa: cuña de apoyo, tablón y marcas cada 25 %.
    const a1 = (angle * Math.PI) / 180;
    const n = { x: Math.sin(a1), y: -Math.cos(a1) };
    g.fillStyle(0x5e3b1f, 1);
    fillPolygon(g, [L.top, L.bottom, { x: L.top.x, y: GROUND_Y }]);
    g.fillStyle(0xd7b27a, 1);
    fillPolygon(g, [L.top, L.bottom, { x: L.bottom.x - 14 * n.x, y: L.bottom.y - 14 * n.y }, { x: L.top.x - 14 * n.x, y: L.top.y - 14 * n.y }]);
    g.lineStyle(2, 0x7a4f2a, 1).lineBetween(L.top.x, L.top.y, L.bottom.x, L.bottom.y);
    for (const p of [0.25, 0.5, 0.75]) {
      const x = L.top.x + (L.bottom.x - L.top.x) * p;
      const y = L.top.y + (L.bottom.y - L.top.y) * p;
      g.lineStyle(3, 0x7a4f2a, 1).lineBetween(x, y, x + n.x * 12, y + n.y * 12);
    }
    // Meta.
    g.lineStyle(4, 0xf4ead5, 1).lineBetween(RAMP_BOTTOM_X + 22, GROUND_Y, RAMP_BOTTOM_X + 22, GROUND_Y - 70);
    g.fillStyle(0xd9534f, 1);
    fillPolygon(g, [{ x: RAMP_BOTTOM_X + 22, y: GROUND_Y - 70 }, { x: RAMP_BOTTOM_X + 62, y: GROUND_Y - 56 }, { x: RAMP_BOTTOM_X + 22, y: GROUND_Y - 42 }]);

    // Pelota con una raya que gira: se ve que rueda.
    const spin = (L.progress * RAMP_LENGTH_PX) / BALL_RADIUS_PX;
    g.fillStyle(0xe0574b, 1).fillCircle(L.ball.x, L.ball.y, BALL_RADIUS_PX).lineStyle(2, 0x7a1f1b, 1).strokeCircle(L.ball.x, L.ball.y, BALL_RADIUS_PX);
    g.lineStyle(3, 0xfff1d6, 1).lineBetween(L.ball.x - Math.cos(spin) * 11, L.ball.y - Math.sin(spin) * 11, L.ball.x + Math.cos(spin) * 11, L.ball.y + Math.sin(spin) * 11);

    // Docente ficticio y guía: solo mientras el experimento está cerrado o abriéndose a la pregunta (SPECS 3.3, pasos 1–5).
    const teacherSays = st.step === "closedAnswer" || st.step === "question" ? cfg.firstPrompt : st.step === "prediction" ? dialogues[cfg.inviteDialogueId] ?? "" : "";
    const showGuide = st.step === "closedAnswer" || st.step === "question";
    if (teacherSays) {
      this.drawTeacher(g, 96, GROUND_Y);
      if (this.labels.bubble.text !== teacherSays) this.labels.bubble.setText(teacherSays);
      const w = this.labels.bubble.width + 32;
      const h = this.labels.bubble.height + 24;
      drawBubble(g, 24, 40, w, h, { x: 100, y: GROUND_Y - 150 });
      this.labels.bubble.setPosition(40, 52).setVisible(true);
    } else this.labels.bubble.setVisible(false);
    if (showGuide) {
      if (this.labels.guide.text !== cfg.guideLine) this.labels.guide.setText(cfg.guideLine);
      const w = 340;
      const h = this.labels.guide.height + 52;
      g.fillStyle(0xfffaf0, 1).fillRoundedRect(STAGE.width - w - 28, 40, w, h, 8).lineStyle(3, 0x7a4f2a, 1).strokeRoundedRect(STAGE.width - w - 28, 40, w, h, 8);
      setLabel(this.labels.guideTitle, "Guía", STAGE.width - w - 12, 52, 0, 0);
      this.labels.guide.setPosition(STAGE.width - w - 12, 78).setVisible(true);
      this.labels.guideTitle.setVisible(true);
    } else {
      this.labels.guide.setVisible(false);
      this.labels.guideTitle.setVisible(false);
    }

    // Rótulos: el tiempo mostrado es el de la simulación visual.
    setLabel(this.labels.angle, `Inclinación: ${formatNumber(angle)}°`, RAMP_BOTTOM_X - 130, GROUND_Y + 68);
    setLabel(this.labels.timer, running ? `Tiempo de la simulación: ${formatNumber(Math.min(elapsed, running.durationMs) / 1000, 1)} s` : "", STAGE.width / 2, 30);
    const lastDone = finished[finished.length - 1];
    setLabel(this.labels.result, !running && lastDone ? `Última prueba: ${formatNumber(lastDone.angleDeg)}° → ${formatNumber(lastDone.durationMs / 1000, 1)} s (simulación)` : "", STAGE.width / 2, GROUND_Y + 100);
    setLabel(this.labels.count, st.trials.length || st.step === "trials" ? `Pruebas terminadas: ${finished.length}` : "", 130, GROUND_Y + 68);
  }

  /** Docente ficticio con formas simples. */
  private drawTeacher(g: Phaser.GameObjects.Graphics, x: number, groundY: number): void {
    g.fillStyle(0x3a4a6a, 1).fillRect(x - 18, groundY - 70, 14, 70).fillRect(x + 4, groundY - 70, 14, 70);
    g.fillStyle(0x4e9a51, 1).fillRoundedRect(x - 30, groundY - 150, 60, 86, 10);
    g.fillStyle(0xf0c8a0, 1).fillCircle(x, groundY - 170, 24);
    g.fillStyle(0x5e3b1f, 1).fillRect(x - 24, groundY - 196, 48, 14);
    g.lineStyle(5, 0x4e9a51, 1).lineBetween(x + 28, groundY - 130, x + 52, groundY - 106);
  }
}
