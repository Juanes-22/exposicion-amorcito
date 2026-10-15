/// <reference lib="dom" />
// La demostración local (fase 6, P6-05 y P6-06; con rondas). Dos situaciones que SPECS 6.4 pide ensayar:
//  A. «Backend caído con el frontend ya cargado»: una sala real con progreso; el servidor se apaga; Vanessa decide pasar a la demostración
//     desde la página que ya tenía abierta, recorre TODA la aventura sin servidor y al volver el servicio la sala sigue con su estado propio.
//  B. «Computadora sin red usando la compilación local»: solo el servidor estático (`vite preview`), sin API ni sockets.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServerApp, type ServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";
import { loadProjectFromDisk } from "../../server/src/project";

const EVIDENCE = process.env.E2E_EVIDENCE ? resolve("docs/evidencia/fase6") : mkdtempSync(join(tmpdir(), "laboratorio-evidencia-"));
const dir = mkdtempSync(join(tmpdir(), "laboratorio-demo-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const check = (cond: unknown, m: string) => {
  if (!cond) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};
const browser = await chromium.launch();
const problems: string[] = [];
const opened: Record<string, Page> = {};

async function open(name: string, viewport: { width: number; height: number }, url: string, ignore: RegExp[] = []) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  opened[name] = page;
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !ignore.some((re) => re.test(m.text())) && problems.push(`${name} console.error: ${m.text()}`));
  await page.goto(url);
  return { ctx, page };
}

/** Abre un panel plegable de la consola sin importar si ya estaba abierto. */
const openPanel = (page: Page, title: RegExp) => page.locator("details.panel", { has: page.locator("summary", { hasText: title }) }).evaluate((el) => ((el as HTMLDetailsElement).open = true));

/**
 * Recorre las tres mesas y el inventor desde la interfaz, como lo haría Vanessa con la demostración: ella conduce la ronda y explora cada
 * mesa con su propio personaje (la demostración es una sala de una sola persona).
 */
async function playJourney(page: Page, label: string) {
  const explore = async (title: string, next: string, experiment: () => Promise<void>) => {
    await page.getByRole("button", { name: `Abrir mesa: ${title}` }).click();
    await page.getByText("0 de 1 listos").first().waitFor();
    await page.getByText("Mesas", { exact: true }).click();
    await page.getByRole("button", { name: "Ir a la mesa actual" }).click();
    await page.getByRole("heading", { name: title }).waitFor();
    await experiment();
    await page.getByText("✓ Listo para conversar").waitFor();
    await page.getByRole("button", { name: "Volver al mapa" }).click();
    await page.getByText("1 de 1 listos").first().waitFor();
    await page.getByRole("button", { name: "Conversemos" }).click(); // con todas las personas listas no hay nada que confirmar
    await page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
    await page.getByRole("button", { name: next }).click();
  };
  await explore("Sombras", "Abrir siguiente mesa: Rampas", async () => {
    const slider = page.getByRole("slider", { name: "Distancia de la linterna al objeto" });
    await slider.waitFor();
    await slider.fill("40");
    await page.locator(".results li").nth(0).waitFor();
    await slider.fill("20");
    await page.locator(".results li").nth(1).waitFor();
  });
  await openPanel(page, /Cuaderno del grupo/);
  await page.getByLabel(/Idea del grupo \(síntesis/).fill(`${label}: la luz estira la sombra`);
  await page.getByRole("button", { name: "Guardar la idea", exact: true }).click();
  await page.locator(".adventure__panels .records .record__text", { hasText: `${label}: la luz estira la sombra` }).waitFor();

  await explore("Rampas", "Abrir siguiente mesa: El observatorio", async () => {
    const angle = page.getByRole("slider", { name: "Inclinación de la rampa" });
    await angle.waitFor();
    for (const idx of ["0", "6"]) {
      await angle.fill(idx);
      await page.getByRole("button", { name: "Soltar la pelota" }).click();
      await page.getByRole("button", { name: "Soltar la pelota" }).waitFor({ timeout: 15_000 }); // vuelve a estar disponible al terminar
    }
  });

  await explore("El observatorio", "Pasar al inventor", async () => {
    await page.getByRole("button", { name: "Luna", exact: true }).click();
    await page.getByRole("button", { name: "Acercar la vista: aumento cercano" }).click();
    await page.getByText("✓ Luna observada").waitFor();
    await page.getByRole("button", { name: "Estrellas", exact: true }).click();
    await page.getByText("✓ Estrellas observadas").waitFor();
  });

  // Cierre: la pregunta final se escribe, se revisa y se confirma antes de imprimirse en el inventor.
  await page.getByLabel("Pregunta final del grupo").fill("¿Por qué las cosas cambian cuando las miramos de cerca?");
  await page.getByRole("button", { name: "Revisar y confirmar" }).click();
  await page.getByRole("button", { name: "Sí, imprimirla en el inventor" }).click();
  await page.getByText("Cada descubrimiento puede abrir otra pregunta.").first().waitFor();
}

const demoState = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("laboratorio-cosas-cotidianas:v1:demo:estado");
    return raw ? (JSON.parse(raw) as { room: { phase: string; roomGeneration: number; adventure: { pieces: string[]; notebook: Array<{ text: string | null; kind: string }>; inventor: { finalQuestionId?: string } } } }).room : null;
  });
const FAIL_NOISE = [/Failed to load resource/i, /WebSocket connection/i, /ERR_CONNECTION_REFUSED/i, /net::ERR/i];

// ============================ A. backend caído, frontend cargado ============================
console.log("\nA. Backend caído con el frontend ya cargado");
const dbPath = join(dir, "sala.sqlite");
const settings = loadSettings({}, { databasePath: dbPath, port: 0, host: "127.0.0.1", distDir: resolve("dist") });
const project = loadProjectFromDisk(settings.publicDir);
let app: ServerApp = createServerApp({ settings, project });
const port = await app.listen(0);
const BASE = `http://127.0.0.1:${port}`;
let app2: ServerApp | null = null;
let preview: ChildProcess | null = null;

try {
  const admin = await open("admin", { width: 1280, height: 720 }, `${BASE}/`, FAIL_NOISE);
  const requests: string[] = [];
  admin.page.on("response", (r) => requests.push(r.url()));
  const failedRequests: string[] = [];
  admin.page.on("requestfailed", (r) => failedRequests.push(r.url()));
  await admin.page.getByRole("button", { name: "Crear sala" }).click();
  await admin.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.page.url().split("/").pop()!;
  await admin.page.getByText("Entra con tu celular").waitFor();

  const ana = await open("ana", { width: 390, height: 844 }, `${BASE}/sala/${code}`, FAIL_NOISE);
  await ana.page.getByLabel("Tu nombre").fill("Ana");
  await ana.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await ana.page.getByText("Vanessa comenzará la aventura en un momento.").waitFor();
  await admin.page.locator(".participant").first().waitFor();
  await admin.page.getByRole("button", { name: "Comenzar la aventura" }).click();
  await ana.page.locator("canvas").waitFor();
  await admin.page.getByRole("button", { name: "Abrir mesa: Sombras" }).click();
  await openPanel(admin.page, /Cuaderno del grupo/);
  await admin.page.getByLabel("Idea inicial del grupo").fill("Mi idea REAL de la sala");
  await admin.page.getByRole("button", { name: "Guardar la idea inicial" }).click();
  await admin.page.locator(".adventure__panels .records .record__text", { hasText: "Mi idea REAL de la sala" }).waitFor();
  check(true, "la sala real tiene progreso confirmado: la idea inicial del grupo");

  // El respaldo se prepara mientras todo funciona: el módulo de la demostración ya está descargado.
  const t0 = Date.now();
  while (!requests.some((u) => /DemoView/.test(u)) && Date.now() - t0 < 10_000) await sleep(100);
  check(requests.some((u) => /DemoView/.test(u)), "con la sala funcionando, la consola de Vanessa ya descargó el módulo de la demostración (respaldo preparado)");
  await sleep(1500);

  const roomBefore = JSON.stringify(app.service.inspect(code)!.state.adventure.notebook);
  const generation = app.service.inspect(code)!.state.roomGeneration;

  // El servicio deja de responder (también deja de servir el frontend).
  await ana.ctx.close();
  await app.close();
  const downAt = Date.now();
  await admin.page.getByRole("alert").getByText("La conexión con la sala no vuelve").waitFor({ timeout: 20_000 });
  console.log(`  ℹ la oferta de la demostración apareció ${Date.now() - downAt} ms después de apagar el servicio`);
  check(true, "con el servicio caído, Vanessa ve la oferta «Usar la demostración» (no se activa sola)");
  await admin.page.screenshot({ path: join(EVIDENCE, "01-oferta-de-demostracion.png") });
  const failedBefore = failedRequests.length;
  await admin.page.getByRole("button", { name: "Usar la demostración" }).click();
  await admin.page.getByText("Demostración", { exact: true }).waitFor();
  await admin.page.locator("canvas").waitFor();
  await sleep(1500);
  check((await admin.page.locator(".game-problem").count()) === 0, "la demostración pinta el laboratorio sin servidor: ningún recurso falló");
  check((await admin.page.getByText("Demostración", { exact: true }).isVisible()) && admin.page.url().includes(`/demo?from=${code}`), "el rótulo «Demostración» es visible y la dirección conserva de qué sala se vino");
  check(failedRequests.length === failedBefore, "al entrar a la demostración no hay peticiones de red fallidas: no usa sockets ni la API");
  await admin.page.screenshot({ path: join(EVIDENCE, "02-demostracion-mapa.png") });

  await playJourney(admin.page, "Demo");
  check(true, "la demostración recorre las tres mesas y el inventor hasta el final, sin servidor");
  await admin.page.screenshot({ path: join(EVIDENCE, "03-demostracion-final.png") });
  const demo = await demoState(admin.page);
  check(demo?.phase === "finished" && demo.adventure.pieces.length === 3 && demo.adventure.notebook.some((r) => r.text?.includes("Demo: la luz estira la sombra")), "su estado quedó guardado aparte, con sus tres piezas y sus propios registros");
  check(failedRequests.length === failedBefore, "y durante todo el recorrido no se intentó ninguna petición de red");
  const keys = await admin.page.evaluate(() => Object.keys(localStorage));
  check(keys.some((k) => k.includes(":demo:")) && !JSON.stringify(demo).match(/token|Mi idea REAL/i), "el estado de la demostración no contiene credenciales ni nada de la sala");

  // Recargar la página de la demostración (con el servicio todavía caído) no puede ser: la página no se descarga. Ese es el caso B.
  // Vuelve el servicio con el MISMO archivo SQLite y el mismo puerto.
  app2 = createServerApp({ settings: { ...settings, port }, project });
  await app2.listen(port);
  await admin.page.getByRole("button", { name: `Volver a la sala ${code}` }).click();
  await admin.page.getByText("Mesa 1 de 3: Sombras").waitFor({ timeout: 25_000 });
  await openPanel(admin.page, /Cuaderno del grupo/);
  await sleep(600);
  const room = app2.service.inspect(code)!.state;
  check(JSON.stringify(room.adventure.notebook) === roomBefore && room.adventure.notebook.length === 1 && room.roomGeneration === generation, "al volver, la sala sigue con SU estado: una sola nota, la del grupo; nada de la demostración se mezcló");
  check(room.adventure.pieces.length === 0 && room.phase === "paused", "sin piezas de la demostración y recuperada en pausa (reinicio del servicio): Vanessa decide cuándo continuar");
  const roomText = await admin.page.locator(".adventure__panels .records").innerText();
  check(roomText.includes("Mi idea REAL de la sala") && !roomText.includes("Demo:"), "la pantalla de la sala muestra solo su propio cuaderno");
  await admin.page.screenshot({ path: join(EVIDENCE, "04-sala-intacta-al-volver.png") });
  await admin.ctx.close();

  // ============================ B. sin red, compilación local ============================
  console.log("\nB. Computadora sin red, con la compilación local (sin API ni sockets)");
  const freePort = () =>
    new Promise<number>((res) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => res(p));
      });
    });
  const previewPort = await freePort();
  // `vite preview` hereda el proxy de /api y /socket.io hacia el puerto del servidor (PORT, por defecto 3001). Aquí se apunta a un
  // puerto sin nadie: esta prueba NUNCA debe hablar con un servidor de desarrollo que alguien tenga encendido en esta computadora.
  const deadPort = await freePort();
  preview = spawn(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(deadPort) } });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("vite preview no arrancó")), 20_000);
    preview!.stdout!.on("data", (d: Buffer) => /Local:|localhost|127\.0\.0\.1/.test(String(d)) && (clearTimeout(t), res()));
    preview!.once("exit", () => rej(new Error("vite preview terminó")));
  });
  const local = await open("local", { width: 1280, height: 720 }, `http://127.0.0.1:${previewPort}/`, FAIL_NOISE);
  await local.page.getByRole("button", { name: "Crear sala" }).click();
  await local.page.getByRole("alert").waitFor();
  check(true, "sin backend, «Crear sala» avisa que no se pudo (no se queda colgado)");
  await local.page.getByRole("button", { name: /Demostración/ }).click();
  await local.page.getByText("Demostración", { exact: true }).waitFor();
  await local.page.locator("canvas").waitFor();
  await local.ctx.setOffline(true); // desde aquí ni siquiera hay red local: la demostración ya no pide nada
  const localFailures: string[] = [];
  local.page.on("requestfailed", (r) => localFailures.push(r.url()));
  await playJourney(local.page, "Local");
  check(localFailures.length === 0, "con la red cortada del todo, la demostración completa la aventura sin una sola petición fallida");
  await local.page.screenshot({ path: join(EVIDENCE, "05-demostracion-sin-red.png") });

  // Recargar con la red cortada no es posible (la página no está en memoria); con la red de vuelta la demostración retoma lo guardado.
  await local.ctx.setOffline(false);
  await local.page.reload();
  await local.page.getByText("Demostración", { exact: true }).waitFor();
  await local.page.getByRole("button", { name: "Reanudar" }).waitFor();
  check(true, "al recargar la demostración recupera lo guardado y vuelve en pausa (Vanessa decide cuándo seguir)");
  await local.page.getByRole("button", { name: "Reiniciar la demostración" }).click();
  await local.page.getByRole("button", { name: "Sí, reiniciar" }).click();
  await local.page.getByRole("button", { name: "Abrir mesa: Sombras" }).waitFor();
  const reset = await demoState(local.page);
  check(reset?.adventure.notebook.length === 0 && reset.adventure.pieces.length === 0 && reset.roomGeneration === 2, "«Reiniciar la demostración» la deja desde cero, lista para abrir la primera mesa");

  check(problems.length === 0, `sin errores de página ni de consola ajenos a la red caída${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de la demostración local y el respaldo (fase 6): OK");
} catch (e) {
  const where = process.env.E2E_FAIL_DIR ?? tmpdir();
  for (const [name, page] of Object.entries(opened)) await page.screenshot({ path: join(where, `fallo-demo-${name}.png`) }).catch(() => undefined);
  console.error(`Capturas del fallo en ${where}/fallo-demo-*.png`);
  throw e;
} finally {
  await browser.close();
  preview?.kill("SIGKILL");
  await app.close().catch(() => undefined);
  await app2?.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
}
