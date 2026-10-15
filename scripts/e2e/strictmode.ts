/// <reference lib="dom" />
// CT-04: montar y desmontar el host de Phaser bajo React StrictMode (solo existe en desarrollo) no duplica canvas, juegos ni errores.
// Levanta su propio servidor (API y sockets, con una base temporal) y un servidor de desarrollo de Vite en un puerto libre que le manda
// `/api` y `/socket.io` por proxy, como `npm run dev`. Recorre una sala real: la consola de Vanessa monta el mapa.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";

const dir = mkdtempSync(join(tmpdir(), "laboratorio-strictmode-"));
const app = createServerApp({ settings: loadSettings({}, { databasePath: join(dir, "sala.sqlite"), port: 0, host: "localhost", distDir: join(dir, "sin-dist") }) });
// `vite.config.ts` toma el puerto del servidor de `PORT` al cargarse: se fija antes de crear el servidor de desarrollo.
process.env.PORT = String(await app.listen(0));
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

  // Una sala real con una persona que juega: la consola de Vanessa monta el mapa al comenzar.
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Crear sala" }).click();
  await page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const roomUrl = new URL(page.url()).pathname;
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`${BASE}${roomUrl}`);
  await phone.getByLabel("Tu nombre").fill("Ana");
  await phone.getByRole("button", { name: "Entrar a la sala" }).click();
  await page.getByText("1 persona conectada", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Comenzar la aventura" }).click();
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
    await go(roomUrl);
    await page.waitForSelector(".game-host canvas");
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
  s = await state();
  check(s.canvases === 1 && s.hosts === 1, "tras 5 desmontajes y montajes sigue habiendo un solo canvas");
  check(s.games.filter((g) => g.connected).length === 1 && s.games.filter((g) => g.pending).length === 0, "los juegos anteriores se destruyeron y retiraron su canvas; ninguno queda pendiente");

  // Audio (P7-02): el reproductor también sobrevive al desmontaje y montaje de StrictMode. El sonido está activado por defecto y empieza
  // con el primer gesto en la página; el registro de lo que suena solo existe con ?hooks.
  await page.evaluate((u) => window.history.replaceState(null, "", `${u}?hooks`), roomUrl);
  check((await page.getByRole("button", { name: /Silenciar/ }).getAttribute("aria-pressed")) === "true", "el sonido aparece activado por defecto, a la espera del primer toque");
  // Al irse Vanessa la sala se pausó: al volver, se reanuda (ese clic es también el primer gesto que deja sonar el audio).
  const resume = page.getByRole("button", { name: "Reanudar", exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole("button", { name: "Abrir mesa: Sombras" }).click();
  await page.getByRole("button", { name: "Conversemos" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Conversar ahora" }).click();
  await page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await page.getByRole("button", { name: "Abrir siguiente mesa: Rampas" }).click();
  const sounded = await page.waitForFunction(() => (((window as any).__AUDIO_LOG__ ?? []) as string[]).includes("piece.earned"), undefined, { timeout: 5000 }).then(() => true, () => false);
  check(sounded, "bajo StrictMode el sonido suena de verdad desde el primer gesto: la pieza conseguida se oye en la proyección");
  check(problems.length === 0, `sin errores de consola ni de página${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de ciclo de vida de Phaser: OK");
} finally {
  await browser.close();
  await vite.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
