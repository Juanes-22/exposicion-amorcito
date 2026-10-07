/// <reference lib="dom" />
// Movimiento en el laboratorio compartido: cada persona mueve SU personaje desde su celular y los demás dispositivos (la proyección y los
// otros celulares) dibujan el MISMO plan. Tres contextos de navegador independientes (proyección + dos celulares) contra el build servido
// por el servidor real (`npm run build` antes).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";
import { loadProjectFromDisk } from "../../server/src/project";

// Las capturas de evidencia solo se escriben en docs/ cuando se pide (E2E_EVIDENCE=1); si no, van a una carpeta temporal para no
// ensuciar el historial con binarios que cambian en cada ejecución.
const EVIDENCE = process.env.E2E_EVIDENCE ? resolve("docs/evidencia/movimiento") : mkdtempSync(join(tmpdir(), "laboratorio-evidencia-"));
const dir = mkdtempSync(join(tmpdir(), "laboratorio-move-"));
// Más lento que en producción (150 u/s): el teléfono vertical solo VE ~520 px de mundo, así que para tener trayectos de varios segundos
// dentro de lo visible hace falta caminar más despacio. El cliente usa la velocidad del PLAN que decide el servidor.
const SPEED = 60;
const settings = loadSettings({}, { databasePath: join(dir, "m.sqlite"), port: 0, host: "127.0.0.1", distDir: resolve("dist") });
const project = loadProjectFromDisk(settings.publicDir);
project.config.world.playerSpeed = SPEED;
const app = createServerApp({ settings, project });
const BASE = `http://127.0.0.1:${await app.listen(0)}`;
const browser = await chromium.launch();
const problems: string[] = [];
const check = (cond: unknown, m: string) => {
  if (!cond) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface View {
  player: { x: number; y: number };
  clock: number;
  running: boolean;
  plan: { id: string; end: { x: number; y: number } } | null;
  zoom: number;
  view: { x: number; y: number; w: number; h: number };
  listeners: number;
}

/**
 * Lo que una pantalla dibuja de UNA persona: dónde está su sprite en la escena, su plan y el reloj con el que lo hace. Sin nombre es el
 * personaje de quien mira (el celular); con nombre, el de esa persona (otro celular o la proyección).
 */
const read = (page: Page, who?: string): Promise<View> =>
  page.evaluate((name) => {
    const g = (window as unknown as { __PHASER_GAME__: any }).__PHASER_GAME__;
    const scene = g.scene.getScene("LaboratoryScene");
    const bridge = g.registry.get("deps").bridge;
    const v = bridge.visual;
    const own = v.viewer.kind === "participant" ? v.viewer.principalId : null;
    const ch = name ? v.characters.find((c: any) => c.displayName === name) : v.characters.find((c: any) => c.principalId === own);
    const view = scene.characters.get(ch.principalId);
    const plan = ch.character.plan;
    const cam = scene.cameras.main;
    return {
      player: { x: view.image.x, y: view.image.y },
      clock: bridge.clock.now(),
      running: bridge.clock.isRunning,
      plan: plan ? { id: plan.planId, end: plan.points[plan.points.length - 1] } : null,
      zoom: cam.zoom,
      view: { x: cam.worldView.x, y: cam.worldView.y, w: cam.worldView.width, h: cam.worldView.height },
      listeners: bridge.listenerCount(),
    };
  }, who);

/** Toca el mapa en el punto de MUNDO indicado: calcula dónde cae en pantalla con la cámara real y hace un clic de verdad. */
/** Devuelve el instante (Date.now) justo antes del clic, para medir latencias sin contar la espera ni la lectura. */
async function tapWorld(page: Page, wx: number, wy: number): Promise<number> {
  await sleep(220); // una persona no toca dos veces en menos de ~120 ms: la escena descarta esos rebotes a propósito
  const v = await read(page);
  const box = (await page.locator("canvas").boundingBox())!;
  const x = box.x + ((wx - v.view.x) / v.view.w) * box.width;
  const y = box.y + ((wy - v.view.y) / v.view.h) * box.height;
  const at = Date.now();
  await page.mouse.click(x, y);
  return at;
}
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const planOf = (name: string) => `(() => { const b = window.__PHASER_GAME__?.registry.get("deps").bridge; const c = b?.visual?.characters.find((x) => x.displayName === ${JSON.stringify(name)}); return c ? c.character.plan : undefined; })()`;
/** El servidor conserva el último plan aunque ya haya llegado (la posición se deduce del plan y del reloj): «hay plan nuevo» es un plan con OTRO id. */
const currentPlanId = (page: Page, name: string): Promise<string> => page.evaluate(`(${planOf(name)})?.planId ?? ""`) as Promise<string>;
const waitNewPlan = (page: Page, name: string, previous: string) => page.waitForFunction(`((${planOf(name)})?.planId ?? "") !== ${JSON.stringify(previous)}`, undefined, { timeout: 8000 });
/** Llegó: no hay plan, o el reloj de simulación de esa pantalla ya pasó el final del plan (velocidad y longitud los decide el servidor). */
const waitArrived = (page: Page, name: string, timeout = 20000) =>
  page.waitForFunction(
    `(() => { const b = window.__PHASER_GAME__?.registry.get("deps").bridge; const p = ${planOf(name)}; return p === null || (!!p && b.clock.now() >= p.startActiveMs + (p.lengthTotal / p.speed) * 1000); })()`,
    undefined,
    { timeout },
  );
/** Toca el mapa y espera a que ESA pantalla (y las demás indicadas) tengan el plan nuevo. Devuelve el id del plan anterior. */
async function walk(who: { page: Page; name: string }, wx: number, wy: number, alsoSeenBy: Page[] = []): Promise<string> {
  const previous = await currentPlanId(who.page, who.name);
  await tapWorld(who.page, wx, wy);
  await waitNewPlan(who.page, who.name, previous);
  for (const p of alsoSeenBy) await waitNewPlan(p, who.name, previous);
  return previous;
}

/** La escena del laboratorio ya está activa y dibujó a quien mira (al volver de una mesa se crea de nuevo). */
const labReady = (page: Page) =>
  page.waitForFunction(() => {
    const g = (window as any).__PHASER_GAME__;
    const v = g.registry.get("deps").bridge.visual;
    return g.scene.isActive("LaboratoryScene") && v?.viewer.kind === "participant" && !!g.scene.getScene("LaboratoryScene").characters?.get(v.viewer.principalId);
  });

const opened: Record<string, Page> = {};

async function open(name: string, viewport: { width: number; height: number }, path: string) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  opened[name] = page;
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console.error: ${m.text()}`));
  await page.goto(`${BASE}${path}`);
  return { ctx, page };
}

try {
  // ---- sala con la proyección y dos personas que juegan ----
  const admin = await open("admin", { width: 1280, height: 720 }, "/");
  await admin.page.getByRole("button", { name: "Crear sala" }).click();
  await admin.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.page.url().split("/").pop()!;
  await admin.page.goto(`${BASE}/sala/${code}?hooks`);
  await admin.page.getByText("Entra con tu celular").waitFor();
  const phone = { width: 390, height: 844 };
  const entrar = async (name: string) => {
    const p = await open(name.toLowerCase(), phone, `/sala/${code}?hooks`);
    await p.page.getByLabel("Tu nombre").fill(name);
    await p.page.getByRole("button", { name: "Entrar a la sala" }).click();
    return p;
  };
  const ana = await entrar("Ana");
  const beto = await entrar("Beto");
  await admin.page.locator(".participant").nth(1).waitFor();
  await admin.page.getByRole("button", { name: "Comenzar la aventura" }).click();
  for (const p of [ana.page, beto.page, admin.page]) {
    await p.locator("canvas").waitFor();
    await p.waitForFunction(() => (window as any).__PHASER_GAME__?.registry.get("deps").bridge.visual);
  }
  await sleep(500);

  // ---- 1. cámara: la proyección ve el laboratorio entero; el teléfono vertical sigue a su personaje con ampliación legible ----
  const a0 = await read(ana.page);
  const p0 = await read(admin.page, "Ana");
  check(p0.view.w >= 1280 - 1, `la proyección encuadra el laboratorio entero (ve ${Math.round(p0.view.w)} px de mundo de ancho, zoom ${p0.zoom.toFixed(2)})`);
  const phoneFit = phone.width / 1280; // el zoom que necesitaría ESTE teléfono para mostrar el laboratorio entero
  check(Math.abs(a0.view.w - 520) < 4 && a0.zoom > phoneFit * 2, `el teléfono vertical sigue a su personaje y ve ~520 px de mundo (zoom ${a0.zoom.toFixed(2)}, más del doble que los ${phoneFit.toFixed(2)} que haría falta para ver el mapa entero)`);
  check(a0.view.x >= -1 && a0.view.x + a0.view.w <= 1281, "la cámara de seguimiento no muestra fuera del mapa");

  // ---- 2. un toque en el teléfono de Ana: el servidor acepta UN plan y TODAS las pantallas dibujan a Ana en el mismo sitio ----
  const target = { x: 640, y: 450 };
  await walk({ page: ana.page, name: "Ana" }, target.x, target.y, [admin.page, beto.page]);
  const [a1, p1, b1] = await Promise.all([read(ana.page, "Ana"), read(admin.page, "Ana"), read(beto.page, "Ana")]);
  check(a1.plan && p1.plan && b1.plan && a1.plan.id === p1.plan.id && p1.plan.id === b1.plan.id, `el celular de Ana, el de Beto y la proyección dibujan el MISMO plan (${a1.plan?.id})`);
  check(a1.plan && dist2(a1.plan.end, target) < 1.5, `la conversión pantalla→mundo es exacta: el servidor recibió el destino (${a1.plan?.end.x.toFixed(1)}, ${a1.plan?.end.y.toFixed(1)}) y se tocó (${target.x}, ${target.y})`);
  let worst = 0;
  for (let i = 0; i < 12; i++) {
    const [a, p, b] = await Promise.all([read(ana.page, "Ana"), read(admin.page, "Ana"), read(beto.page, "Ana")]);
    worst = Math.max(worst, dist2(a.player, p.player), dist2(a.player, b.player));
    await sleep(120);
  }
  console.log(`  ℹ divergencia máxima entre pantallas durante el trayecto: ${worst.toFixed(1)} px (a ${SPEED} u/s, 100 ms de diferencia = ${(SPEED / 10).toFixed(0)} px)`);
  check(worst < 40, "durante el trayecto, las tres pantallas dibujan a Ana en la misma posición (diferencia < 40 px)");
  await ana.page.screenshot({ path: join(EVIDENCE, "01-telefono-siguiendo-a-ana.png") });
  await admin.page.screenshot({ path: join(EVIDENCE, "02-proyeccion-mismo-plan.png") });

  // ---- 3. llega: todas terminan exactamente en el destino y la posición queda guardada por el servidor ----
  for (const p of [ana.page, admin.page, beto.page]) await waitArrived(p, "Ana", 15000);
  await sleep(250);
  const [a2, p2] = await Promise.all([read(ana.page, "Ana"), read(admin.page, "Ana")]);
  check(dist2(a2.player, target) < 1.5 && dist2(p2.player, target) < 1.5, "al llegar, el celular y la proyección dejan a Ana exactamente en el destino");

  // ---- 4. un punto dentro de una pared se rechaza con una explicación y no cambia nada ----
  await tapWorld(ana.page, 640, 90);
  await ana.page.getByText(/no se puede pisar/).first().waitFor();
  const a3 = await read(ana.page);
  check(dist2(a3.player, target) < 1.5 && a3.plan?.id === a2.plan?.id, "tocar una pared muestra «no se puede pisar» y el personaje no se mueve ni queda atrapado");
  await walk({ page: ana.page, name: "Ana" }, 850, 600); // y sigue pudiendo moverse (suelo libre, lejos del inventor)
  check(true, "después de un rechazo, el siguiente toque válido funciona");
  await waitArrived(ana.page, "Ana");

  // ---- 5. las dos personas caminan A LA VEZ, cada una por su plan, y cada pantalla las dibuja a las dos ----
  await Promise.all([walk({ page: ana.page, name: "Ana" }, 700, 600, [admin.page]), walk({ page: beto.page, name: "Beto" }, 800, 650, [admin.page])]);
  const [pa, pb] = await Promise.all([read(admin.page, "Ana"), read(admin.page, "Beto")]);
  check(pa.plan && pb.plan && pa.plan.id !== pb.plan.id, `la proyección ve dos planes distintos a la vez (${pa.plan?.id} y ${pb.plan?.id}): nadie espera su turno`);
  await sleep(600);
  const [anaEnAna, anaEnBeto, betoEnAna, betoEnBeto] = await Promise.all([read(ana.page, "Ana"), read(beto.page, "Ana"), read(ana.page, "Beto"), read(beto.page, "Beto")]);
  check(dist2(anaEnAna.player, anaEnBeto.player) < 40 && dist2(betoEnAna.player, betoEnBeto.player) < 40, "cada celular dibuja al otro caminando en el mismo lugar que el celular del otro");
  await beto.page.screenshot({ path: join(EVIDENCE, "03-beto-ve-a-ana-caminar.png") });
  await waitArrived(admin.page, "Ana");
  await waitArrived(admin.page, "Beto");

  // ---- 6. pausa en mitad del movimiento congela TODAS las escenas; reanudar continúa sin sumar la conversación ----
  await walk({ page: beto.page, name: "Beto" }, 640, 600);
  await sleep(500);
  await admin.page.getByRole("button", { name: "Pausar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await sleep(300);
  const [f1, g1] = await Promise.all([read(beto.page), read(admin.page, "Beto")]);
  await sleep(1500); // una charla corta con todo en pausa
  const [f2, g2] = await Promise.all([read(beto.page), read(admin.page, "Beto")]);
  check(dist2(f1.player, f2.player) < 0.5 && dist2(g1.player, g2.player) < 0.5, "en pausa el personaje no avanza ni un píxel, en el celular ni en la proyección");
  check(!f2.running && Math.abs(f2.clock - f1.clock) < 1, "el reloj de simulación del cliente queda quieto exactamente donde estaba");
  await admin.page.screenshot({ path: join(EVIDENCE, "04-pausa-a-mitad-del-movimiento.png") });
  await admin.page.getByRole("button", { name: "Reanudar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  await sleep(500);
  const f3 = await read(beto.page);
  check(f3.running && dist2(f3.player, f2.player) > 8, "al reanudar sigue caminando desde donde estaba");
  check(dist2(f3.player, f2.player) < 90, "y sin saltar: no suma el tiempo que duró la conversación en pausa");
  await waitArrived(beto.page, "Beto");

  // ---- 7. redimensionar: el encuadre se recalcula y el personaje sigue a la vista ----
  await beto.page.setViewportSize({ width: 700, height: 420 });
  await sleep(500);
  const r1 = await read(beto.page);
  check(r1.player.x >= r1.view.x && r1.player.x <= r1.view.x + r1.view.w && r1.player.y >= r1.view.y && r1.player.y <= r1.view.y + r1.view.h, `tras redimensionar a 700×420 la cámara recalcula el encuadre (zoom ${r1.zoom.toFixed(2)}) y el personaje sigue a la vista`);
  await beto.page.setViewportSize(phone);
  await sleep(400);

  // ---- 8. pestaña congelada y de vuelta: se aplica el tiempo actual, sin «adelantar» con un delta acumulado ----
  await walk({ page: beto.page, name: "Beto" }, 420, 560);
  const cdp = await beto.ctx.newCDPSession(beto.page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await sleep(1800);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await sleep(700);
  const [h1, h2] = await Promise.all([read(beto.page), read(admin.page, "Beto")]);
  check(dist2(h1.player, h2.player) < 60, `tras congelar la pestaña 1,8 s, el celular vuelve a coincidir con la proyección (a ${dist2(h1.player, h2.player).toFixed(1)} px)`);
  await waitArrived(beto.page, "Beto");

  // ---- 9. mesas: solo la habilitada, y solo cuando Vanessa la abre ----
  await beto.page.getByText("Mesas", { exact: true }).click();
  check(await beto.page.getByRole("button", { name: "Ir a la mesa actual" }).isDisabled(), "en la preparación «Ir a la mesa actual» está desactivado: la mesa se abre cuando Vanessa lo indica");
  await beto.page.getByText("Mesas", { exact: true }).click();
  await tapWorld(beto.page, 260, 270);
  await beto.page.getByText(/Vanessa abrirá la mesa en un momento/).first().waitFor();
  const noWalk = await currentPlanId(beto.page, "Beto");
  await sleep(300);
  check((await currentPlanId(beto.page, "Beto")) === noWalk, "tocar la mesa antes de que se abra lo explica y no hace caminar");
  await admin.page.getByRole("button", { name: "Abrir mesa: Sombras" }).click();
  await beto.page.getByText(/La mesa está abierta/).first().waitFor();
  // Tocar la mesa habilitada desde lejos: camina hasta ella y la abre al llegar.
  await tapWorld(beto.page, 260, 270);
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor({ timeout: 25000 });
  const feet = await beto.page.evaluate(() => {
    const v = (window as any).__PHASER_GAME__.registry.get("deps").bridge.visual;
    return v.characters.find((c: any) => c.principalId === v.viewer.principalId).character.feet as { x: number; y: number };
  });
  check(dist2(feet, { x: 260, y: 330 }) < 90, "tocar la mesa habilitada camina hasta su punto de interacción y la abre al llegar (el servidor valida la proximidad)");
  await beto.page.screenshot({ path: join(EVIDENCE, "05-mesa-abierta-al-llegar.png") });
  await beto.page.getByRole("button", { name: "Volver al mapa" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor({ state: "detached" });
  // Tocar una mesa que todavía no toca: se explica y no se camina.
  await walk({ page: beto.page, name: "Beto" }, 480, 400);
  await waitArrived(beto.page, "Beto");
  const before = await read(beto.page);
  await tapWorld(beto.page, 640, 270);
  await beto.page.getByText("Esa mesa se habilitará más adelante.").first().waitFor();
  await sleep(300);
  const after = await read(beto.page);
  check(after.plan?.id === before.plan?.id && dist2(after.player, before.player) < 1, "tocar una mesa que todavía no toca explica el orden y no hace caminar al personaje");
  await beto.page.getByText("Mesas", { exact: true }).click();
  await beto.page.getByRole("button", { name: "Ir a la mesa actual" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor();
  check(true, "«Ir a la mesa actual» abre la mesa sin exigir cercanía (equivalente accesible de caminar hasta ella)");
  await beto.page.getByRole("button", { name: "Volver al mapa" }).click();
  await labReady(beto.page);

  // ---- 10. ciclo de vida: recargar el celular no duplica canvas, juegos ni listeners, y el personaje sigue donde estaba ----
  const posBefore = (await read(beto.page)).player;
  const listeners = (await read(beto.page)).listeners;
  for (let i = 0; i < 3; i++) {
    await beto.page.reload();
    await beto.page.locator("canvas").waitFor();
    await beto.page.waitForFunction(() => (window as any).__PHASER_GAME__?.registry.get("deps").bridge.visual);
    await sleep(300);
  }
  const counts = await Promise.all([admin.page, ana.page, beto.page].map((p) => p.locator("canvas").count()));
  check(counts.every((c) => c === 1), `tras 3 recargas hay un solo canvas en cada pantalla (${counts.join("/")})`);
  const reloaded = await read(beto.page);
  check(reloaded.listeners === listeners, `los listeners del puente no se duplican (${listeners} antes, ${reloaded.listeners} después)`);
  check(dist2(reloaded.player, posBefore) < 2, "al recargar, el personaje de Beto reaparece donde estaba: la posición la guarda el servidor");
  const games = await beto.page.evaluate(() => (window as any).__PHASER_GAMES__?.filter((g: any) => g.canvas?.isConnected).length ?? 0);
  check(games === 1, "un solo Phaser.Game vivo en el celular");

  // ---- 11. medición preliminar de latencia: del clic en el teléfono a que la proyección ya tiene el nuevo plan ----
  await walk({ page: beto.page, name: "Beto" }, 400, 450);
  const lat: number[] = [];
  for (let i = 0; i < 12; i++) {
    const prev = (await read(admin.page, "Beto")).plan?.id ?? "";
    const clickedAt = await tapWorld(beto.page, i % 2 ? 400 : 520, 450);
    await admin.page.waitForFunction(`((${planOf("Beto")})?.planId ?? "") !== ${JSON.stringify(prev)}`, undefined, { timeout: 5000 });
    lat.push(Date.now() - clickedAt);
  }
  lat.sort((a, b) => a - b);
  console.log(`  ℹ latencia clic en el teléfono → plan nuevo en la proyección (12 toques, mismo equipo, localhost): mediana ${lat[6]} ms, máx ${lat[11]} ms. Medición preliminar, NO la de P7 (requiere ≥ 30 muestras, dispositivos y red reales).`);
  check(lat[6]! < 250, `la mediana (${lat[6]} ms) cumple el objetivo preliminar de < 250 ms entre acción aceptada y proyección`);

  check(problems.length === 0, `sin errores de consola ni de página en los tres contextos${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de movimiento en el laboratorio compartido: OK");
} catch (e) {
  // Si algo falla se guarda lo que veía cada contexto: una captura vale más que adivinar.
  const where = process.env.E2E_FAIL_DIR ?? tmpdir();
  for (const [name, page] of Object.entries(opened)) await page.screenshot({ path: join(where, `fallo-movimiento-${name}.png`) }).catch(() => undefined);
  console.error(`Capturas del fallo en ${where}/fallo-movimiento-*.png`);
  throw e;
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
