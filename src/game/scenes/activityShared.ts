import Phaser from "phaser";
import type { ActivityConfig } from "../../../shared/contracts/config";
import type { ActivityState, AdventureState, RoomPhase } from "../../../shared/contracts/state";
import { crispText } from "../crispText";
import { getDeps } from "../createGame";
import { fitFraming, focusFraming, type Rect } from "../framing";
import { STAGE } from "../geometry/stage";

export const FONT = "Nunito Variable, Nunito, sans-serif";

export interface ActivityView<S extends ActivityState = ActivityState> {
  id: string;
  config: ActivityConfig;
  /** Las pruebas de quien mira (o de la demostración de Vanessa): nunca las de otra persona. */
  state: S;
  adv: AdventureState;
  phase: RoomPhase;
}

/**
 * La mesa que esta pantalla tiene abierta y las pruebas de quien mira, leídas del último estado visual del puente (la escena pinta, no
 * decide). `null` si no corresponde: no hay mesa abierta, es de otro tipo o quien mira no es una persona ni una demostración.
 */
export function readActivity<T extends ActivityState["type"]>(scene: Phaser.Scene, type: T): ActivityView<Extract<ActivityState, { type: T }>> | null {
  const { bridge, project } = getDeps(scene);
  const v = bridge.visual;
  if (!v) return null;
  const personal = v.viewer.kind === "participant" ? v.viewer.me : v.viewer.kind === "projection" ? v.viewer.demo : null;
  if (personal?.view.kind !== "activity") return null;
  const id = personal.view.activityId;
  const state = personal.activities[id];
  const config = project.bundle.config.activities[id];
  if (!state || !config || state.type !== type) return null;
  return { id, config, state: state as Extract<ActivityState, { type: T }>, adv: v.group, phase: v.phase };
}

/**
 * Muestra el escenario lógico entero, centrado y a escala uniforme, y lo vuelve a ajustar si cambia el tamaño. Con `focus`, en una
 * pantalla más angosta que el escenario (el celular vertical) se acerca a esa zona para que la actividad se vea grande.
 */
export function fitStage(scene: Phaser.Scene, cleanups: Array<() => void>, focus?: Rect): void {
  const apply = () => {
    const view = { width: scene.scale.width, height: scene.scale.height };
    const f = focus ? focusFraming(view, STAGE, focus) : fitFraming(view, STAGE);
    scene.cameras.main.setZoom(f.zoom).centerOn(f.centerX, f.centerY);
  };
  apply();
  scene.scale.on(Phaser.Scale.Events.RESIZE, apply);
  cleanups.push(() => scene.scale.off(Phaser.Scale.Events.RESIZE, apply));
}

/**
 * La parte del escenario que se ve con la cámara actual, acotada al escenario. En el celular la cámara se acerca a la actividad: los
 * rótulos de las esquinas se colocan aquí para que no queden fuera de la vista.
 */
export function visibleStage(scene: Phaser.Scene): { left: number; top: number; right: number; bottom: number } {
  const v = scene.cameras.main.worldView;
  if (!(v.width > 0 && v.height > 0)) return { left: 0, top: 0, right: STAGE.width, bottom: STAGE.height };
  return { left: Math.max(0, v.x), top: Math.max(0, v.y), right: Math.min(STAGE.width, v.right), bottom: Math.min(STAGE.height, v.bottom) };
}

/** Polígono relleno con la API de trazado (no pide `Vector2`). El color y la opacidad se fijan antes con `fillStyle`. */
export function fillPolygon(g: Phaser.GameObjects.Graphics, points: ReadonlyArray<{ x: number; y: number }>): void {
  if (points.length < 3) return;
  g.beginPath();
  g.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y);
  g.closePath();
  g.fillPath();
}

export function addLabel(scene: Phaser.Scene, size = 18, color = "#fff8e6", bold = true): Phaser.GameObjects.Text {
  return crispText(scene.add.text(0, 0, "", { fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? "bold" : "normal", color })).setDepth(10);
}

/** Cambia el texto solo si es distinto (cada `setText` regenera la textura). */
export function setLabel(t: Phaser.GameObjects.Text, text: string, x: number, y: number, originX = 0.5, originY = 0.5): void {
  if (t.text !== text) t.setText(text);
  t.setOrigin(originX, originY).setPosition(x, y);
}

/** Globo de diálogo con cola. Devuelve el área útil para el texto. */
export function drawBubble(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, tail: { x: number; y: number }): void {
  g.fillStyle(0xfffaf0, 1).lineStyle(3, 0x5e3b1f, 1);
  g.fillRoundedRect(x, y, w, h, 14).strokeRoundedRect(x, y, w, h, 14);
  const bx = Math.min(Math.max(tail.x, x + 24), x + w - 24);
  g.fillTriangle(bx - 12, y + h - 1, bx + 12, y + h - 1, tail.x, tail.y).lineStyle(3, 0x5e3b1f, 1).lineBetween(bx - 12, y + h, tail.x, tail.y).lineBetween(bx + 12, y + h, tail.x, tail.y);
}

/** Huella de Jerry, dibujada con círculos: no hay un asset de Jerry solo, y no se inventa uno. */
export function drawPaw(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 1): void {
  g.fillStyle(0x5e3b1f, 1);
  g.fillEllipse(x, y + 5 * s, 22 * s, 17 * s);
  for (const [dx, dy] of [[-12, -8], [-4, -15], [5, -15], [13, -8]] as const) g.fillEllipse(x + dx * s, y + dy * s, 8 * s, 10 * s);
}

/** Reacción breve de Jerry ante un avance: un globo con su huella y «¡Guau!» durante poco más de un segundo. */
export class JerryReaction {
  private until = 0;
  private text = "";
  private readonly label: Phaser.GameObjects.Text;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly gfx: Phaser.GameObjects.Graphics,
    private readonly at: { x: number; y: number },
  ) {
    this.label = crispText(scene.add.text(0, 0, "", { fontFamily: FONT, fontSize: "20px", fontStyle: "bold", color: "#3b2a1a" })).setDepth(12).setVisible(false);
  }
  trigger(text = "¡Guau!", ms = 1300): void {
    this.text = text;
    this.until = this.scene.time.now + ms;
  }
  /** Se dibuja con el Graphics de la escena (ya limpiado en este fotograma). */
  draw(): void {
    const on = this.scene.time.now < this.until;
    this.label.setVisible(on);
    if (!on) return;
    const w = 150;
    const h = 52;
    drawBubble(this.gfx, this.at.x - w / 2, this.at.y - h - 22, w, h, { x: this.at.x, y: this.at.y - 4 });
    drawPaw(this.gfx, this.at.x - w / 2 + 28, this.at.y - h - 22 + h / 2, 0.8);
    setLabel(this.label, this.text, this.at.x + 12, this.at.y - h - 22 + h / 2);
  }
  destroy(): void {
    this.label.destroy();
  }
}

/** Mismas dependencias y teardown en las tres escenas cercanas. */
export function bindSceneLifecycle(scene: Phaser.Scene, cleanups: Array<() => void>, extra?: () => void): void {
  const teardown = () => {
    for (const off of cleanups.splice(0)) off();
    extra?.();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);
  scene.events.once(Phaser.Scenes.Events.DESTROY, teardown);
}
