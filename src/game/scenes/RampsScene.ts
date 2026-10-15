import Phaser from "phaser";
import { angleLabel } from "../../../shared/domain/models";
import type { RampsActivityConfig } from "../../../shared/contracts/config";
import { getDeps } from "../createGame";
import { BALL_RADIUS_PX, GROUND_Y, RAMP_BOTTOM_X, rampLayout, rampLayoutAt, RAMP_LENGTH_PX } from "../geometry/ramps";
import { STAGE } from "../geometry/stage";
import { addLabel, bindSceneLifecycle, fillPolygon, fitStage, readActivity, setLabel, visibleStage } from "./activityShared";
import { RAMPS_SCENE } from "./sceneKeys";


/**
 * Rampas, escena cercana de quien explora (o de la demostración de Vanessa). La pelota sigue `s/L = min(1, (t/T)²)` con el tiempo transcurrido de la simulación visual, que sale del
 * reloj de simulación (se detiene en la pausa): ni el teléfono ni la proyección deciden cuándo empieza o termina una prueba. La escena
 * no muestra grados ni tiempos: la inclinación se nombra y cuánto demoró la pelota es la pregunta de la conversación (SPECS 3.3).
 */
export class RampsScene extends Phaser.Scene {
  private cleanups: Array<() => void> = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private labels!: Record<"angle" | "count" | "results", Phaser.GameObjects.Text>;

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
    this.labels = {
      angle: addLabel(this, 20),
      count: addLabel(this, 16, "#cdbf9d", false),
      results: addLabel(this, 17, "#fff8e6", false).setAlign("left").setWordWrapWidth(330),
    };
    // En el celular, la cámara se acerca a la rampa (de la menos a la más empinada), la meta y el nombre de la inclinación.
    fitStage(this, this.cleanups, { x: 250, y: 10, width: 640, height: 500 });
    bindSceneLifecycle(this, this.cleanups);
    bridge.emit("game:ready", { sceneKey: RAMPS_SCENE, token: this.token });
  }

  override update(): void {
    const a = readActivity(this, "ramps");
    if (!a) return;
    const { bridge } = getDeps(this);
    const cfg = a.config as RampsActivityConfig;
    const st = a.state;
    const g = this.gfx;
    g.clear();

    const running = st.trials.find((t) => t.state === "running");
    const finished = st.trials.filter((t) => t.state === "finished");
    const last = st.trials[st.trials.length - 1];
    // La prueba en marcha dibuja su propia inclinación (congelada al crearla); en reposo, la que la persona tiene elegida ahora (local).
    const e = cfg.experiment;
    const chosen = Math.min(e.maxAngleDeg, Math.max(e.minAngleDeg, bridge.local.angleDeg ?? last?.angleDeg ?? e.minAngleDeg));
    const angle = running ? running.angleDeg : chosen;
    const elapsed = running ? bridge.clock.now() - running.startActiveMs : 0;
    const restAtBottom = !running && last?.state === "finished" && last.angleDeg === chosen;
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

    // Rótulos: el nombre de la inclinación, sin grados ni tiempos.
    setLabel(this.labels.angle, angleLabel(e, angle), RAMP_BOTTOM_X - 130, GROUND_Y + 68);
    // Los rótulos de las esquinas van a la parte visible del escenario (en el celular la cámara se acerca a la rampa).
    const vis = visibleStage(this);
    setLabel(this.labels.count, `Pruebas terminadas: ${finished.length} de ${cfg.experiment.requiredTrials}`, vis.left + 20, vis.top + 18, 0, 0);
    // Cada prueba queda registrada sola: la persona recuerda qué inclinaciones probó, también escritas.
    const lines = finished.slice(-4).map((t, i) => `${finished.length - Math.min(4, finished.length) + i + 1}) ${angleLabel(e, t.angleDeg).toLowerCase()}`);
    // En la proyección la mesa se muestra sin avance de nadie: el contador del grupo está en la esquina de la consola.
    const mine = getDeps(this).bridge.visual?.viewer.kind === "participant";
    this.labels.count.setVisible(mine);
    this.labels.results.setText(lines.join("\n")).setPosition(vis.left + 20, vis.top + 46).setOrigin(0, 0).setVisible(mine && lines.length > 0);
  }
}
