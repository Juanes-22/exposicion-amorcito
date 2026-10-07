/// <reference lib="dom" />
// CT-04: montar y desmontar el host de Phaser bajo React StrictMode (solo existe en desarrollo) no duplica canvas, juegos ni errores.
// Levanta su propio servidor de desarrollo de Vite en un puerto libre.
import { chromium } from "playwright";
import { createServer } from "vite";

const vite = await createServer({ server: { port: 5190, strictPort: false }, logLevel: "error" });
await vite.listen();
const BASE = vite.resolvedUrls!.local[0]!.replace(/\/$/, "");
const browser = await chromium.launch();
const problems: string[] = [];
const check = (c: unknown, m: string) => {
  if (!c) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console.error: ${m.text()}`));
  await page.goto(`${BASE}/demo`);
  await page.waitForSelector(".game-host canvas");
  await page.waitForTimeout(1500);

  const state = () =>
    page.evaluate(() => ({
      canvases: document.querySelectorAll("canvas").length,
      hosts: document.querySelectorAll(".game-host").length,
      games: ((window as unknown as { __PHASER_GAMES__?: Array<{ isRunning: boolean; pendingDestroy: boolean; canvas?: HTMLCanvasElement }> }).__PHASER_GAMES__ ?? []).map((g) => ({ running: g.isRunning, pending: g.pendingDestroy, connected: g.canvas?.isConnected === true })),
    }));
  const go = (to: string) => page.evaluate((t) => (window.history.pushState(null, "", t), window.dispatchEvent(new PopStateEvent("popstate"))), to);

  let s = await state();
  console.log("  montaje inicial (StrictMode):", JSON.stringify(s));
  check(s.games.length >= 2, "StrictMode creó dos juegos al montar (la comprobación es significativa)");
  check(s.canvases === 1 && s.hosts === 1, "un solo host y un solo canvas tras el doble montaje");
  check(s.games.filter((g) => g.connected).length === 1, "solo un juego conserva su canvas en el documento");

  for (let i = 0; i < 5; i++) {
    await go("/");
    await page.waitForSelector(".game-host", { state: "detached" });
    await go("/demo");
    await page.waitForSelector(".game-host canvas");
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
  s = await state();
  check(s.canvases === 1 && s.hosts === 1, "tras 5 desmontajes y montajes sigue habiendo un solo canvas");
  check(s.games.filter((g) => g.connected).length === 1 && s.games.filter((g) => g.pending).length === 0, "los juegos anteriores se destruyeron y retiraron su canvas; ninguno queda pendiente");
  // Audio (P7-02): el reproductor también sobrevive al desmontaje y montaje de StrictMode. Con el reproductor ya «soltado» por el primer
  // desmontaje, «Activar sonido» no hacía nada en desarrollo (el build de producción no desmonta dos veces y no lo mostraba).
  await page.getByRole("button", { name: /Activar sonido/ }).click();
  const soundOn = await page.getByRole("button", { name: /Silenciar/ }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  check(soundOn, "bajo StrictMode, «Activar sonido» activa el sonido (el botón pasa a «Silenciar»)");
  // …y el sonido se dispara de verdad: anotar una posición de la linterna hace «clic». El registro de pruebas solo existe con ?hooks.
  await page.evaluate("window.history.replaceState(null, '', '/demo?hooks')");
  // En desarrollo, el doble montaje hace que la demostración arranque como si se hubiera recargado: en pausa, hasta «Reanudar».
  const resume = page.getByRole("button", { name: "Reanudar", exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByText("Mesas", { exact: true }).click();
  await page.getByRole("button", { name: "Sombras", exact: true }).click();
  await page.getByLabel("Tu respuesta").fill("la luz estira la sombra");
  await page.getByRole("button", { name: "Compartir con el grupo" }).click();
  const slider = page.getByRole("slider", { name: "Distancia de la linterna al objeto" });
  await slider.waitFor();
  await slider.fill("40");
  await page.getByRole("button", { name: "Anotar esta posición" }).click();
  const clicked = await page.waitForFunction(() => (((window as any).__AUDIO_LOG__ ?? []) as string[]).includes("shadows.click"), undefined, { timeout: 5000 }).then(() => true, () => false);
  check(clicked, "bajo StrictMode, anotar una posición de la linterna hace sonar el «clic» (se lanzó de verdad)");
  check(problems.length === 0, `sin errores de consola ni de página${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de ciclo de vida de Phaser: OK");
} finally {
  await browser.close();
  await vite.close();
}
