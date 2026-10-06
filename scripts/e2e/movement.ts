/// <reference lib="dom" />
// Fase 3 (P3): el teléfono mueve a Vanessa y la proyección muestra el MISMO plan; el cambio de turno conserva posición y vista; la espera
// no recibe frames. Tres contextos de navegador independientes contra el build servido por el servidor real (`npm run build` antes).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";
import { loadProjectFromDisk } from "../../server/src/project";

// Las capturas de evidencia solo se escriben en docs/ cuando se pide (E2E_EVIDENCE=1); si no, van a una carpeta temporal para no
// ensuciar el historial con binarios que cambian en cada ejecución.
const EVIDENCE = process.env.E2E_EVIDENCE ? resolve("docs/evidencia/fase3") : mkdtempSync(join(tmpdir(), "laboratorio-evidencia-"));
const dir = mkdtempSync(join(tmpdir(), "laboratorio-move-"));
// Vanessa más lenta que en producción (150 u/s): el teléfono vertical solo VE ~520 px de mundo, así que para tener trayectos de varios
// segundos dentro de lo visible hace falta caminar más despacio. El cliente usa la velocidad del PLAN que decide el servidor.
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
  moving: boolean;
  zoom: number;
  view: { x: number; y: number; w: number; h: number };
  listeners: number;
  at: number;
}

/** Estado visible de la escena de una vista: dónde dibuja a Vanessa, el plan y el reloj con el que lo hace. */
const read = (page: Page): Promise<View> =>
  page.evaluate(() => {
    const g = (window as unknown as { __PHASER_GAME__: any }).__PHASER_GAME__;
    const scene = g.scene.getScene("LaboratoryScene");
    const bridge = g.registry.get("deps").bridge;
    const sprite = scene.children.list.find((c: any) => c.texture?.key === "character.vanessa-jerry.walk.poses-v4");
    const adv = bridge.snapshot?.state.adventure;
    const plan = adv?.player.plan;
    const cam = scene.cameras.main;
    return {
      player: { x: sprite.x, y: sprite.y },
      clock: bridge.clock.now(),
      running: bridge.clock.isRunning,
      plan: plan ? { id: plan.planId, end: plan.points[plan.points.length - 1] } : null,
      moving: sprite.anims.isPlaying,
      zoom: cam.zoom,
      view: { x: cam.worldView.x, y: cam.worldView.y, w: cam.worldView.width, h: cam.worldView.height },
      listeners: bridge.listenerCount(),
      at: Date.now(),
    };
  });

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
const countWsFrames = (page: Page) => {
  const c = { frames: 0 };
  page.on("websocket", (ws) => ws.on("framereceived", (f) => typeof f.payload === "string" && f.payload.includes("simulation.frame") && c.frames++));
  return c;
};

const opened: Record<string, Page> = {};

async function open(name: string, viewport: { width: number; height: number }, path: string) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  opened[name] = page;
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console.error: ${m.text()}`));
  const ws = countWsFrames(page);
  await page.goto(`${BASE}${path}`);
  return { ctx, page, ws };
}

try {
  // ---- sala con tres identidades ----
  const admin = await open("admin", { width: 1280, height: 720 }, "/");
  await admin.page.getByRole("button", { name: "Crear sala" }).click();
  await admin.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.page.url().split("/").pop()!;
  await admin.page.goto(`${BASE}/sala/${code}?hooks`);
  await admin.page.getByText("Entra con tu celular").waitFor();
  const phone = { width: 390, height: 844 };
  const ana = await open("ana", phone, `/sala/${code}?hooks`);
  await ana.page.getByLabel("Tu nombre").fill("Ana");
  await ana.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await ana.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  const beto = await open("beto", phone, `/sala/${code}?hooks`);
  await beto.page.getByLabel("Tu nombre").fill("Beto");
  await beto.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await beto.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  await admin.page.locator(".participant").nth(1).waitFor();
  await admin.page.getByRole("button", { name: "Dar el turno a Ana", exact: true }).click();
  await admin.page.getByRole("button", { name: "Comenzar con Ana" }).click();
  await ana.page.getByText("Es tu turno, Ana").waitFor();
  await ana.page.locator("canvas").waitFor();
  await admin.page.locator("canvas").waitFor();
  await ana.page.waitForFunction(() => (window as any).__PHASER_GAME__?.registry.get("deps").bridge.snapshot);
  await admin.page.waitForFunction(() => (window as any).__PHASER_GAME__?.registry.get("deps").bridge.snapshot);
  await sleep(500);

  // ---- 1. cámara: la proyección ve el laboratorio entero; el teléfono vertical sigue a Vanessa con ampliación legible ----
  const a0 = await read(ana.page);
  const p0 = await read(admin.page);
  check(p0.view.w >= 1280 - 1, `la proyección encuadra el laboratorio entero (ve ${Math.round(p0.view.w)} px de mundo de ancho, zoom ${p0.zoom.toFixed(2)})`);
  const phoneFit = phone.width / 1280; // el zoom que necesitaría ESTE teléfono para mostrar el laboratorio entero
  check(Math.abs(a0.view.w - 520) < 2 && a0.zoom > phoneFit * 2, `el teléfono vertical sigue a Vanessa y ve ~520 px de mundo (zoom ${a0.zoom.toFixed(2)}, más del doble que los ${phoneFit.toFixed(2)} que haría falta para ver el mapa entero)`);
  check(a0.view.x >= -1 && a0.view.x + a0.view.w <= 1281, "la cámara de seguimiento no muestra fuera del mapa");

  // ---- 2. un toque en el teléfono: el servidor acepta UN plan y ambas vistas lo dibujan ----
  const target = { x: 640, y: 450 };
  await tapWorld(ana.page, target.x, target.y);
  await ana.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  await admin.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  const a1 = await read(ana.page);
  const p1 = await read(admin.page);
  check(a1.plan && p1.plan && a1.plan.id === p1.plan.id, `teléfono y proyección dibujan el MISMO plan (${a1.plan?.id})`);
  check(a1.plan && dist2(a1.plan.end, target) < 1.5, `la conversión pantalla→mundo es exacta: el servidor recibió el destino (${a1.plan?.end.x.toFixed(1)}, ${a1.plan?.end.y.toFixed(1)}) y se tocó (${target.x}, ${target.y})`);

  // Posiciones de ambas escenas durante el trayecto: deben coincidir salvo la latencia.
  let worst = 0;
  const samples: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) {
    const [a, p] = await Promise.all([read(ana.page), read(admin.page)]);
    const d = dist2(a.player, p.player);
    worst = Math.max(worst, d);
    samples.push([Math.round(a.player.x), Math.round(p.player.x)]);
    await sleep(120);
  }
  console.log(`  ℹ divergencia máxima teléfono↔proyección durante el trayecto: ${worst.toFixed(1)} px (a ${SPEED} u/s, 100 ms de diferencia = ${(SPEED / 10).toFixed(0)} px)`);
  check(worst < 40, "durante el trayecto, las dos escenas dibujan a Vanessa en la misma posición (diferencia < 40 px)");
  await ana.page.screenshot({ path: join(EVIDENCE, "01-telefono-siguiendo-a-vanessa.png") });
  await admin.page.screenshot({ path: join(EVIDENCE, "02-proyeccion-mismo-plan.png") });

  // ---- 3. llega: ambas terminan exactamente en el destino y la posición queda guardada por el servidor ----
  await ana.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 15000 });
  await admin.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 15000 });
  await sleep(250);
  const a2 = await read(ana.page);
  const p2 = await read(admin.page);
  check(dist2(a2.player, target) < 1.5 && dist2(p2.player, target) < 1.5, "al llegar, teléfono y proyección dejan a Vanessa exactamente en el destino");
  check(a2.plan === null && !a2.moving, "terminó el movimiento: sin plan y sin animación de caminar");

  // ---- 4. un punto dentro de una pared se rechaza con una explicación y no cambia nada ----
  await tapWorld(ana.page, 640, 90);
  await ana.page.getByText(/no se puede pisar/).first().waitFor();
  const a3 = await read(ana.page);
  check(a3.plan === null && dist2(a3.player, target) < 1.5, "tocar una pared muestra «no se puede pisar» y Vanessa no se mueve ni queda atrapada");
  await tapWorld(ana.page, 850, 600); // y sigue pudiendo moverse (suelo libre, lejos del inventor)
  await ana.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  check(true, "después de un rechazo, el siguiente toque válido funciona");
  await ana.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 15000 });

  // ---- 5. la espera no recibe frames de simulación ----
  check(beto.ws.frames === 0, `Beto (en espera) no recibió ningún frame de simulación por su WebSocket (Ana: ${ana.ws.frames}, proyección: ${admin.ws.frames})`);
  check((await beto.page.locator("canvas").count()) === 0, "Beto sigue sin canvas");

  // ---- 6. cambio de turno EN PLENO MOVIMIENTO: el nuevo controlador ve el mismo plan, no el spawn ----
  // Trayecto largo (~4 s): claramente más que la maniobra de la interfaz para dar el turno.
  await tapWorld(ana.page, 620, 420);
  await ana.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  await admin.page.getByText(/Participantes \(/).click(); // el panel se abre antes: el cambio de turno es un solo clic
  await sleep(500);
  const anaFramesBefore = ana.ws.frames;
  await admin.page.getByRole("button", { name: "Dar el turno a Beto" }).click();
  await beto.page.getByText("Es tu turno, Beto").waitFor();
  await beto.page.locator("canvas").waitFor();
  await beto.page.waitForFunction(() => (window as any).__PHASER_GAME__?.registry.get("deps").bridge.snapshot);
  await sleep(150);
  const [b1, p3] = await Promise.all([read(beto.page), read(admin.page)]);
  const spawn = { x: 640, y: 720 };
  check(b1.plan && p3.plan && b1.plan.id === p3.plan.id, "Beto recibe el MISMO plan que ya estaba en marcha");
  check(dist2(b1.player, spawn) > 80 && dist2(b1.player, p3.player) < 40, `la escena de Beto dibuja a Vanessa a mitad de camino, no en el spawn (a ${dist2(b1.player, p3.player).toFixed(1)} px de la proyección)`);
  await beto.page.screenshot({ path: join(EVIDENCE, "03-cambio-de-turno-en-pleno-movimiento-beto.png") });
  await ana.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  check((await ana.page.locator("canvas").count()) === 0, "Ana, que perdió el turno, ya no tiene canvas");
  await sleep(500);
  check(ana.ws.frames - anaFramesBefore <= 2, `Ana deja de recibir frames al perder el turno (${ana.ws.frames - anaFramesBefore} tras el cambio, en tránsito)`);
  await beto.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 15000 });
  const b2 = await read(beto.page);
  check(dist2(b2.player, { x: 620, y: 420 }) < 1.5, "el movimiento termina en el destino que había pedido Ana");

  // ---- 7. pausa en mitad del movimiento congela las DOS escenas; reanudar continúa sin sumar la conversación ----
  await tapWorld(beto.page, 420, 420);
  await beto.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  await sleep(500);
  await admin.page.getByRole("button", { name: "Pausar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await sleep(300);
  const [f1, g1] = await Promise.all([read(beto.page), read(admin.page)]);
  await sleep(1500); // una charla corta con todo en pausa
  const [f2, g2] = await Promise.all([read(beto.page), read(admin.page)]);
  check(dist2(f1.player, f2.player) < 0.5 && dist2(g1.player, g2.player) < 0.5, "en pausa Vanessa no avanza ni un píxel, en el teléfono ni en la proyección");
  check(!f2.running && Math.abs(f2.clock - f1.clock) < 1, "el reloj de simulación del cliente queda quieto exactamente donde estaba");
  await admin.page.screenshot({ path: join(EVIDENCE, "04-pausa-a-mitad-del-movimiento.png") });
  await admin.page.getByRole("button", { name: "Reanudar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  await sleep(500);
  const f3 = await read(beto.page);
  check(f3.running && dist2(f3.player, f2.player) > 8, "al reanudar sigue caminando desde donde estaba");
  check(dist2(f3.player, f2.player) < 90, "y sin saltar: no suma el tiempo que duró la conversación en pausa");
  await beto.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 15000 });

  // ---- 8. redimensionar: el encuadre se recalcula y Vanessa sigue a la vista ----
  await beto.page.setViewportSize({ width: 700, height: 420 });
  await sleep(500);
  const r1 = await read(beto.page);
  check(r1.player.x >= r1.view.x && r1.player.x <= r1.view.x + r1.view.w && r1.player.y >= r1.view.y && r1.player.y <= r1.view.y + r1.view.h, `tras redimensionar a 700×420 la cámara recalcula el encuadre (zoom ${r1.zoom.toFixed(2)}) y Vanessa sigue a la vista`);
  await beto.page.setViewportSize(phone);
  await sleep(400);

  // ---- 9. pestaña congelada y de vuelta: se aplica el tiempo actual, sin «adelantar» con un delta acumulado ----
  await tapWorld(beto.page, 200, 520);
  await beto.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  const cdp = await beto.ctx.newCDPSession(beto.page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await sleep(1800);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await sleep(700);
  const [h1, h2] = await Promise.all([read(beto.page), read(admin.page)]);
  check(dist2(h1.player, h2.player) < 60, `tras congelar la pestaña 1,8 s, el teléfono vuelve a coincidir con la proyección (a ${dist2(h1.player, h2.player).toFixed(1)} px)`);
  await beto.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 15000 });

  // ---- 10. mesas: lista accesible, toque sobre una mesa que camina y la abre, volver al mapa ----
  await beto.page.getByText("Mesas", { exact: true }).click();
  check(await beto.page.getByRole("button", { name: "Rampas" }).isDisabled(), "en la lista de mesas, Rampas está bloqueada hasta completar Sombras (se conserva el orden del recorrido)");
  check(await beto.page.getByRole("button", { name: "El inventor" }).isDisabled(), "y el inventor también");
  await beto.page.getByRole("button", { name: "Sombras" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor();
  await admin.page.getByRole("heading", { name: "Sombras" }).waitFor();
  check(true, "abrir Sombras desde la lista no exige proximidad y la proyección también la ve abierta");
  await beto.page.screenshot({ path: join(EVIDENCE, "05-mesa-abierta-desde-la-lista.png") });
  await beto.page.getByRole("button", { name: "Volver al mapa" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor({ state: "detached" });
  // Tocar la mesa de Sombras desde lejos: camina hasta ella y la abre al llegar.
  const mesa = { x: 260, y: 270 };
  await tapWorld(beto.page, mesa.x, mesa.y);
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor({ timeout: 20000 });
  const b3 = await read(beto.page);
  check(dist2(b3.player, { x: 260, y: 330 }) < 80, "tocar la mesa camina hasta su punto de interacción y la abre al llegar (el servidor valida la proximidad)");
  await beto.page.getByRole("button", { name: "Volver al mapa" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor({ state: "detached" });
  // Tocar una mesa bloqueada: se explica y no se camina. Primero se acerca lo bastante para que Rampas quede a la vista del teléfono.
  await tapWorld(beto.page, 480, 400);
  // Primero a que el plan EXISTA (si no, «sin plan» es cierto antes de que el servidor responda) y luego a que termine.
  await beto.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  await beto.page.waitForFunction(() => !(window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan, undefined, { timeout: 20000 });
  const before = await read(beto.page);
  await tapWorld(beto.page, 640, 270);
  await beto.page.getByText("Primero hay que completar la mesa anterior.").first().waitFor();
  await sleep(300);
  check((await read(beto.page)).plan === null && dist2((await read(beto.page)).player, before.player) < 1, "tocar una mesa bloqueada explica el orden y no hace caminar a Vanessa");

  // ---- 11. ciclo de vida: turnos repetidos no duplican canvas, juegos ni listeners ----
  const listenersWhileControlling = (await read(beto.page)).listeners;
  const cycle = async (to: "Ana" | "Beto") => {
    await admin.page.getByRole("button", { name: `Dar el turno a ${to}` }).click();
    const who = to === "Ana" ? ana.page : beto.page;
    await who.getByText(`Es tu turno, ${to}`).waitFor();
    await who.locator("canvas").waitFor();
    await who.waitForFunction(() => (window as any).__PHASER_GAME__?.registry.get("deps").bridge.snapshot);
  };
  for (let i = 0; i < 3; i++) {
    await cycle("Ana");
    await cycle("Beto");
  }
  await sleep(500);
  const counts = await Promise.all([admin.page, ana.page, beto.page].map((p) => p.locator("canvas").count()));
  check(counts[0] === 1 && counts[1] === 0 && counts[2] === 1, `tras 6 cambios de turno hay un canvas en la proyección, otro en el controlador y ninguno en la espera (${counts.join("/")})`);
  const after = await read(beto.page);
  check(after.listeners === listenersWhileControlling, `los listeners del puente no se duplican tras remontar el mapa (${listenersWhileControlling} antes, ${after.listeners} después)`);
  const games = await beto.page.evaluate(() => (window as any).__PHASER_GAMES__?.filter((g: any) => g.canvas?.isConnected).length ?? 0);
  check(games === 1, "un solo Phaser.Game vivo en el teléfono del controlador");

  // ---- 12. medición preliminar de latencia: del clic en el teléfono a que la proyección ya tiene el nuevo plan ----
  await tapWorld(beto.page, 400, 450);
  await beto.page.waitForFunction(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan);
  const lat: number[] = [];
  for (let i = 0; i < 12; i++) {
    const prev = (await read(admin.page)).plan?.id ?? "";
    const clickedAt = await tapWorld(beto.page, i % 2 ? 400 : 520, 450);
    await admin.page.waitForFunction((id) => ((window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure.player.plan?.planId ?? "") !== id, prev, { timeout: 5000 });
    lat.push(Date.now() - clickedAt);
  }
  lat.sort((a, b) => a - b);
  console.log(`  ℹ latencia clic en el teléfono → plan nuevo en la proyección (12 toques, mismo equipo, localhost): mediana ${lat[6]} ms, máx ${lat[11]} ms. Medición preliminar, NO la de P7 (requiere ≥ 30 muestras, dispositivos y red reales).`);
  check(lat[6]! < 250, `la mediana (${lat[6]} ms) cumple el objetivo preliminar de < 250 ms entre acción aceptada y proyección`);

  check(problems.length === 0, `sin errores de consola ni de página en los tres contextos${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de movimiento y proyección compartida (fase 3): OK");
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
