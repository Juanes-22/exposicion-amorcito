import Phaser from "phaser";
import type { TelescopeActivityConfig } from "../../../shared/contracts/config";
import type { TelescopeState } from "../../../shared/contracts/state";
import { clampView, HORIZON_Y, PANORAMA, TELESCOPE_TARGETS, type TelescopeView } from "../../../shared/domain/telescope";
import { getDeps } from "../createGame";
import { STAGE } from "../geometry/stage";
import { addLabel, bindSceneLifecycle, fillPolygon, fitStage, readActivity, setLabel, visibleStage } from "./activityShared";
import { TELESCOPE_SCENE } from "./sceneKeys";

/** El visor: un círculo en el centro del escenario. Fuera de él, la carcasa del telescopio. */
const VISOR = { x: STAGE.width / 2, y: STAGE.height / 2, r: 236 } as const;
/** Antes de cerrar la cortina, la persona se gira hacia la ventana (ms). */
const TURN_MS = 500;

/** Estrellas de fondo: siempre las mismas (semilla fija), repartidas por el cielo. */
const BACKGROUND_STARS = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 260 }, () => ({ x: rnd() * PANORAMA.width, y: rnd() * (HORIZON_Y - 40), size: 0.6 + rnd() * 1.1, alpha: 0.35 + rnd() * 0.5 }));
})();

/** El grupo de estrellas que se busca: más brillantes y juntas, reconocibles con cualquier aumento. */
const STAR_GROUP = [
  [-70, -40, 4.5],
  [-20, -62, 3.8],
  [30, -30, 5],
  [78, -52, 3.6],
  [-48, 20, 3.4],
  [10, 34, 4.2],
  [64, 18, 3.2],
  [-6, -6, 2.8],
  [40, 70, 3],
] as const;

/** Casas del horizonte (x, ancho, alto de la pared, alto del tejado). La de la ventana iluminada es la cuarta. */
const HOUSES = [
  [80, 250, 300, 120],
  [360, 220, 250, 100],
  [620, 300, 330, 130],
  [1190, 280, 340, 120],
  [960, 210, 230, 90],
  [1500, 260, 280, 110],
  [1800, 320, 320, 130],
  [2150, 220, 260, 100],
] as const;

/** Ventanas apagadas de las otras casas (no tienen nada que ver). */
const DARK_WINDOWS = [
  [150, 940], [250, 1010], [430, 990], [700, 905], [820, 990], [1020, 1010], [1580, 955], [1690, 1010], [1890, 950], [2010, 1020], [2230, 985],
] as const;

const WINDOW_W = 74;
const WINDOW_H = 58;

/**
 * El observatorio (SPECS 3.4), escena de quien explora o de la demostración de Vanessa en la proyección. Se mira un panorama nocturno
 * ilustrado por el visor de un telescopio: la Luna, un grupo de estrellas y, abajo, los tejados de unas casas. En una ventana iluminada,
 * dos siluetas discuten con gestos; al enfocarla de cerca, una se gira y cierra la cortina, una sola vez y para siempre en esa partida.
 * La escena no explica nada ni premia nada: el límite aparece en la experiencia y se conversa después.
 *
 * Hacia dónde mira el visor mientras se mueve es local (`bridge.local.telescope`); el servidor registra la vista quieta. Las animaciones
 * usan el reloj de simulación, que se detiene en la pausa.
 */
export class TelescopeScene extends Phaser.Scene {
  private cleanups: Array<() => void> = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private labels!: Record<"zoom" | "hint" | "flash", Phaser.GameObjects.Text>;
  private token = 0;
  private drag: { pointerX: number; pointerY: number; view: TelescopeView } | null = null;
  /** Estado de la cortina en el fotograma anterior: `null` al entrar (si ya estaba cerrada, no se anima de nuevo). */
  private lastCurtain: TelescopeState["curtain"] | null = null;
  private curtainStart: number | null = null;
  private lastObserved = -1;
  private flash: { text: string; until: number } | null = null;

  constructor() {
    super(TELESCOPE_SCENE);
  }

  init(): void {
    this.token = getDeps(this).bridge.beginScene();
    this.drag = null;
    this.lastCurtain = null;
    this.curtainStart = null;
    this.lastObserved = -1;
    this.flash = null;
  }

  create(): void {
    const { bridge } = getDeps(this);
    this.gfx = this.add.graphics().setDepth(5);
    this.labels = { zoom: addLabel(this, 17, "#e9d9b6"), hint: addLabel(this, 16, "#cdbf9d", false), flash: addLabel(this, 20, "#fff8e6") };
    // En el celular, la cámara se acerca al visor: el cielo se ve grande.
    fitStage(this, this.cleanups, { x: VISOR.x - VISOR.r - 10, y: VISOR.y - VISOR.r - 10, width: 2 * VISOR.r + 20, height: 2 * VISOR.r + 20 });
    bindSceneLifecycle(this, this.cleanups);

    const onDown = (p: Phaser.Input.Pointer) => {
      const view = this.currentView();
      if (!view || !this.canDrag()) return;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      if (Math.hypot(w.x - VISOR.x, w.y - VISOR.y) > VISOR.r) return;
      this.drag = { pointerX: w.x, pointerY: w.y, view };
    };
    const onMove = (p: Phaser.Input.Pointer) => {
      const a = readActivity(this, "telescope");
      if (!this.drag || !p.isDown || !a || !this.canDrag()) return;
      const exp = (a.config as TelescopeActivityConfig).experiment;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const k = this.scaleFor(exp, this.drag.view.zoom);
      // Arrastrar el cielo: lo que estaba bajo el dedo sigue bajo el dedo.
      const next = clampView({ x: this.drag.view.x - (w.x - this.drag.pointerX) / k, y: this.drag.view.y - (w.y - this.drag.pointerY) / k, zoom: this.drag.view.zoom }, exp);
      bridge.setLocal({ telescope: next });
    };
    const onUp = () => void (this.drag = null);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    this.cleanups.push(() => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    });
    bridge.emit("game:ready", { sceneKey: TELESCOPE_SCENE, token: this.token });
  }

  /** Solo quien explora mueve su telescopio, y solo mientras la mesa está abierta. La proyección (demostración) solo mira. */
  private canDrag(): boolean {
    const { bridge } = getDeps(this);
    return bridge.visual?.viewer.kind === "participant" && bridge.permissions?.canExplore === true;
  }

  /** La vista local mientras se mueve; si no hay (la proyección, o al entrar), la que guardó el servidor. */
  private currentView(): TelescopeView | null {
    const a = readActivity(this, "telescope");
    if (!a) return null;
    const { bridge } = getDeps(this);
    const exp = (a.config as TelescopeActivityConfig).experiment;
    const local = bridge.visual?.viewer.kind === "participant" ? bridge.local.telescope : null;
    return clampView(local ?? { x: a.state.x, y: a.state.y, zoom: a.state.zoom }, exp);
  }

  /** Píxeles del escenario por unidad del panorama con ese aumento. */
  private scaleFor(exp: TelescopeActivityConfig["experiment"], zoom: number): number {
    return (VISOR.r * exp.zoomLevels[zoom]!) / exp.fieldRadius;
  }

  override update(): void {
    const a = readActivity(this, "telescope");
    const view = this.currentView();
    if (!a || !view) return;
    const { bridge, reducedMotion } = getDeps(this);
    const cfg = a.config as TelescopeActivityConfig;
    const exp = cfg.experiment;
    const st = a.state;
    const now = bridge.clock.now();
    const k = this.scaleFor(exp, view.zoom);
    const P = (x: number, y: number) => ({ x: VISOR.x + (x - view.x) * k, y: VISOR.y + (y - view.y) * k });
    const g = this.gfx;
    g.clear();

    // La cortina: si se cierra mientras la escena está abierta, se ve el gesto; si ya estaba cerrada al entrar, aparece cerrada.
    if (this.lastCurtain === "open" && st.curtain === "closed") this.curtainStart = now;
    this.lastCurtain = st.curtain;
    if (this.lastObserved >= 0 && st.observed.length > this.lastObserved) {
      const latest = st.observed.at(-1);
      this.flash = { text: latest === "moon" ? "Luna observada" : latest === "galaxy" ? "Galaxia observada" : "Estrellas observadas", until: this.time.now + 1600 };
    }
    this.lastObserved = st.observed.length;

    // ---- el panorama (lo de fuera del visor lo tapa la carcasa al final) ----
    const tl = P(0, 0);
    g.fillStyle(0x0b1530, 1).fillRect(tl.x, tl.y, PANORAMA.width * k, PANORAMA.height * k);
    const glow = P(0, HORIZON_Y - 220);
    g.fillStyle(0x16244a, 1).fillRect(glow.x, glow.y, PANORAMA.width * k, 220 * k);
    const glow2 = P(0, HORIZON_Y - 90);
    g.fillStyle(0x223460, 1).fillRect(glow2.x, glow2.y, PANORAMA.width * k, 140 * k);

    for (const s of BACKGROUND_STARS) {
      const p = P(s.x, s.y);
      g.fillStyle(0xfff8e6, s.alpha).fillCircle(p.x, p.y, Math.max(0.8, s.size * Math.min(k, 1.6)));
    }
    this.drawGalaxy(g, P, k);
    this.drawStarGroup(g, P, k);
    this.drawMoon(g, P, k);
    this.drawHorizon(g, P, k, now, st, exp, reducedMotion);

    // ---- carcasa del telescopio: tapa todo lo que queda fuera del visor ----
    g.lineStyle(1400, 0x14100c, 1).strokeCircle(VISOR.x, VISOR.y, VISOR.r + 700);
    g.lineStyle(10, 0x8a6a28, 1).strokeCircle(VISOR.x, VISOR.y, VISOR.r + 5);
    g.lineStyle(3, 0xd2a84c, 1).strokeCircle(VISOR.x, VISOR.y, VISOR.r + 1);
    // La zona central: lo que queda dentro de este círculo cuenta como «centrado».
    g.lineStyle(2, 0xfff8e6, 0.28).strokeCircle(VISOR.x, VISOR.y, VISOR.r * exp.centerTolerance);

    // Los rótulos van a las esquinas de lo que se ve: en el celular la cámara se acerca al visor.
    const vis = visibleStage(this);
    setLabel(this.labels.zoom, view.zoom >= 1 ? `Aumento cercano ×${exp.zoomLevels[1]}` : `Aumento general ×${exp.zoomLevels[0]}`, vis.left + 16, vis.top + 14, 0, 0);
    const participant = bridge.visual?.viewer.kind === "participant";
    this.labels.hint.setVisible(participant);
    if (participant) setLabel(this.labels.hint, this.canDrag() ? "Arrastra dentro del visor para mirar" : "", vis.left + 16, vis.bottom - 14, 0, 1);
    const flashOn = this.flash !== null && this.time.now < this.flash.until;
    this.labels.flash.setVisible(flashOn);
    if (flashOn) setLabel(this.labels.flash, `✓ ${this.flash!.text}`, vis.right - 16, vis.top + 14, 1, 0);
  }

  /**
   * Una galaxia en espiral, inclinada: un halo tenue, dos brazos de puntos de luz y un centro brillante. Con el aumento general es una
   * mancha de luz; con el cercano se ven los brazos.
   */
  private drawGalaxy(g: Phaser.GameObjects.Graphics, P: (x: number, y: number) => { x: number; y: number }, k: number): void {
    const gx = TELESCOPE_TARGETS.galaxy;
    const c = P(gx.x, gx.y);
    const R = gx.radius * k;
    const tilt = -0.45;
    const flat = 0.5;
    const at = (r: number, a: number) => {
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * flat;
      return { x: c.x + x * Math.cos(tilt) - y * Math.sin(tilt), y: c.y + x * Math.sin(tilt) + y * Math.cos(tilt) };
    };
    const ellipse = (r: number) => Array.from({ length: 36 }, (_, i) => at(r, (i / 36) * Math.PI * 2));
    for (const [s, alpha] of [[1.25, 0.05], [0.9, 0.08], [0.55, 0.12]] as const) {
      g.fillStyle(0xcdbdff, alpha);
      fillPolygon(g, ellipse(R * s));
    }
    for (let arm = 0; arm < 2; arm++) {
      for (let i = 0; i < 46; i++) {
        const t = i / 45;
        const p = at(R * (0.12 + 0.88 * t), arm * Math.PI + t * 3.6);
        g.fillStyle(0xeee6ff, 0.6 * (1 - t) + 0.15).fillCircle(p.x, p.y, Math.max(0.7, (1.6 - 1.1 * t) * Math.min(k, 2)));
      }
    }
    g.fillStyle(0xfff6e0, 0.35).fillCircle(c.x, c.y, R * 0.28);
    g.fillStyle(0xfffbf0, 0.9).fillCircle(c.x, c.y, R * 0.1);
  }

  private drawStarGroup(g: Phaser.GameObjects.Graphics, P: (x: number, y: number) => { x: number; y: number }, k: number): void {
    const c = TELESCOPE_TARGETS.stars;
    for (const [dx, dy, size] of STAR_GROUP) {
      const p = P(c.x + dx, c.y + dy);
      const r = size * Math.min(Math.max(k, 0.8), 2.2);
      g.fillStyle(0xbfd9ff, 0.22).fillCircle(p.x, p.y, r * 2.4);
      g.fillStyle(0xf3f8ff, 1).fillCircle(p.x, p.y, r);
    }
  }

  private drawMoon(g: Phaser.GameObjects.Graphics, P: (x: number, y: number) => { x: number; y: number }, k: number): void {
    const m = TELESCOPE_TARGETS.moon;
    const c = P(m.x, m.y);
    const R = m.radius * k;
    g.fillStyle(0xfff3c4, 0.08).fillCircle(c.x, c.y, R * 1.35);
    g.fillStyle(0xe9e4cf, 1).fillCircle(c.x, c.y, R);
    // Zonas oscuras («mares») y algunos cráteres reconocibles con el aumento cercano.
    g.fillStyle(0xc4bda6, 1).fillEllipse(c.x - R * 0.28, c.y - R * 0.18, R * 0.62, R * 0.44).fillEllipse(c.x + R * 0.22, c.y + R * 0.12, R * 0.5, R * 0.36).fillEllipse(c.x - R * 0.05, c.y + R * 0.45, R * 0.4, R * 0.22);
    for (const [dx, dy, rr] of [[0.42, -0.42, 0.12], [-0.5, 0.32, 0.09], [0.15, -0.62, 0.07], [0.55, 0.4, 0.08], [-0.2, 0.15, 0.05]] as const) {
      g.fillStyle(0xb3ac94, 1).fillCircle(c.x + dx * R, c.y + dy * R, rr * R);
      g.lineStyle(Math.max(1, rr * R * 0.25), 0xf6f2e2, 0.8).strokeCircle(c.x + dx * R, c.y + dy * R, rr * R);
    }
  }

  private drawHorizon(
    g: Phaser.GameObjects.Graphics,
    P: (x: number, y: number) => { x: number; y: number },
    k: number,
    now: number,
    st: TelescopeState,
    exp: TelescopeActivityConfig["experiment"],
    reducedMotion: boolean,
  ): void {
    // Casas y tejados, en silueta oscura.
    for (const [x, w, h, roof] of HOUSES) {
      const base = PANORAMA.height;
      const top = base - h;
      const a = P(x, top);
      g.fillStyle(0x17131f, 1).fillRect(a.x, a.y, w * k, h * k);
      g.fillStyle(0x221c2c, 1);
      fillPolygon(g, [P(x - 16, top), P(x + w / 2, top - roof), P(x + w + 16, top)]);
    }
    for (const [x, y] of DARK_WINDOWS) {
      const a = P(x - 22, y - 18);
      g.fillStyle(0x2d2836, 1).fillRect(a.x, a.y, 44 * k, 36 * k);
    }

    // La ventana iluminada.
    const wc = TELESCOPE_TARGETS.window;
    const w0 = P(wc.x - WINDOW_W / 2, wc.y - WINDOW_H / 2);
    const W = WINDOW_W * k;
    const H = WINDOW_H * k;
    g.fillStyle(0xffcf72, 0.18).fillRect(w0.x - 10 * k, w0.y - 10 * k, W + 20 * k, H + 20 * k);
    g.fillStyle(0xffd27a, 1).fillRect(w0.x, w0.y, W, H);

    const closing = this.curtainStart !== null ? Math.min(1, Math.max(0, (now - this.curtainStart - TURN_MS) / exp.curtainCloseMs)) : st.curtain === "closed" ? 1 : 0;
    const turning = this.curtainStart !== null ? Math.min(1, Math.max(0, (now - this.curtainStart) / TURN_MS)) : st.curtain === "closed" ? 1 : 0;
    if (closing < 1) this.drawSilhouettes(g, w0.x, w0.y, W, H, k, now, turning, reducedMotion);

    // Cortina: recogida a los lados mientras está abierta; al cerrarse, cubre la ventana desde los dos lados.
    const side = Math.max(0.12, closing * 0.5);
    g.fillStyle(0x8a3b4a, 1).fillRect(w0.x, w0.y, W * side, H).fillRect(w0.x + W * (1 - side), w0.y, W * side, H);
    g.lineStyle(Math.max(1, 1.4 * k), 0x5e2632, 0.9);
    for (let i = 1; i < 4; i++) {
      g.lineBetween(w0.x + (W * side * i) / 4, w0.y, w0.x + (W * side * i) / 4, w0.y + H);
      g.lineBetween(w0.x + W - (W * side * i) / 4, w0.y, w0.x + W - (W * side * i) / 4, w0.y + H);
    }
    // Marco.
    g.lineStyle(Math.max(1.5, 3 * k), 0x3b2a1a, 1).strokeRect(w0.x, w0.y, W, H).lineBetween(w0.x + W / 2, w0.y, w0.x + W / 2, w0.y + H * (closing >= 1 ? 1 : 0));
  }

  /**
   * Dos siluetas que discuten con gestos: brazos que suben y bajan, sin golpes y sin diálogo. Con movimiento reducido los gestos se
   * simplifican a dos posturas que se alternan despacio. `turning` (0..1): una de ellas se gira y va hacia la ventana.
   */
  private drawSilhouettes(g: Phaser.GameObjects.Graphics, x0: number, y0: number, W: number, H: number, k: number, now: number, turning: number, reducedMotion: boolean): void {
    const t = now / 1000;
    const swing = (speed: number, phase: number) => (reducedMotion ? (Math.floor(t / 1.5 + phase) % 2 === 0 ? 0.7 : -0.3) : Math.sin(t * speed + phase) * 0.7);
    const floor = y0 + H;
    const person = (cx: number, armA: number, armB: number, facing: number) => {
      const head = 6.5 * k;
      const bodyW = 15 * k;
      const bodyH = 26 * k;
      const shoulderY = floor - bodyH + 3 * k;
      g.fillStyle(0x2a2030, 1).fillRoundedRect(cx - bodyW / 2, floor - bodyH, bodyW, bodyH, 4 * k).fillCircle(cx + facing * 1.5 * k, floor - bodyH - head + 1 * k, head);
      g.lineStyle(Math.max(1.2, 3.6 * k), 0x2a2030, 1);
      const arm = (side: number, angle: number) => {
        const len = 15 * k;
        const ang = -Math.PI / 2 + side * (0.9 - angle);
        g.lineBetween(cx + side * bodyW * 0.45, shoulderY, cx + side * bodyW * 0.45 + Math.cos(ang) * len, shoulderY + Math.sin(ang) * len);
      };
      arm(-1, armA);
      arm(1, armB);
    };
    const a = x0 + W * 0.3;
    const b = x0 + W * 0.7;
    person(a, swing(4.2, 0), swing(3.1, 1.2), 1);
    // La persona de la derecha deja de discutir, se gira y va hacia la ventana a cerrar la cortina.
    const bx = b + (x0 + W * 0.56 - b) * turning;
    person(bx, turning > 0 ? 0.9 * turning : swing(3.6, 2.1), turning > 0 ? 1.1 * turning : swing(2.7, 0.4), turning > 0 ? 0 : -1);
  }
}
