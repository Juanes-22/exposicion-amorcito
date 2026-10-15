/// <reference lib="dom" />
// Prueba e2e de la sala (fase 2, con rondas simultáneas): administradora + dos participantes en contextos de navegador independientes
// (credenciales propias), contra el servidor real que sirve el build. Ejecutar con `npx tsx scripts/e2e/room-flow.ts` tras `npm run build`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";

// Las capturas de evidencia solo se escriben en docs/ cuando se pide (E2E_EVIDENCE=1); si no, van a una carpeta temporal para no
// ensuciar el historial con binarios que cambian en cada ejecución.
const EVIDENCE = process.env.E2E_EVIDENCE ? resolve("docs/evidencia/fase2") : mkdtempSync(join(tmpdir(), "laboratorio-evidencia-"));
const dir = mkdtempSync(join(tmpdir(), "laboratorio-e2e-"));
const app = createServerApp({ settings: loadSettings({}, { databasePath: join(dir, "e2e.sqlite"), port: 0, host: "127.0.0.1", distDir: resolve("dist") }) });
const port = await app.listen(0);
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const problems: string[] = [];
const ok = (m: string) => console.log(`  ✔ ${m}`);
const check = (cond: unknown, m: string) => {
  if (!cond) throw new Error(`✖ ${m}`);
  ok(m);
};

async function open(name: string, viewport: { width: number; height: number }, path: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console.error: ${m.text()}`));
  await page.goto(`${BASE}${path}`);
  return { ctx, page };
}
const shot = (page: Page, file: string) => page.screenshot({ path: join(EVIDENCE, file) });
const canvases = (page: Page) => page.locator("canvas").count();

try {
  // 1. Vanessa crea la sala.
  const admin = await open("admin", { width: 1280, height: 720 }, "/");
  await admin.page.getByRole("button", { name: "Crear sala" }).click();
  await admin.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.page.url().split("/").pop()!;
  await admin.page.getByText("Entra con tu celular").waitFor();
  check(await admin.page.locator("svg.qr").count() === 1, `Vanessa crea la sala ${code} y ve el QR`);
  check((await admin.page.locator(".join-code").innerText()) === code, "el código de sala se muestra grande para la proyección");
  const qrText = await admin.page.locator("svg.qr").getAttribute("aria-label");
  const stored = await admin.page.evaluate((c) => window.localStorage.getItem(`laboratorio-cosas-cotidianas:v1:sala:${c}`), code);
  check(stored !== null && JSON.parse(stored).role === "admin" && JSON.parse(stored).token.length >= 43, "la credencial de la administradora se guarda con clave propia por proyecto y sala");
  check(!admin.page.url().includes("token") && !(qrText ?? "").includes("token"), "ni la URL ni el QR llevan credenciales");
  await shot(admin.page, "01-bienvenida-vanessa-vacia.png");

  // 2. Dos participantes con el mismo nombre, en contextos separados (otro «teléfono» cada una).
  const phone = { width: 390, height: 844 };
  const ana = await open("ana", phone, `/sala/${code}`);
  await ana.page.getByLabel("Tu nombre").fill("Ana");
  // En una pantalla muy estrecha los círculos de color no se aplastan y ningún nombre se parte ni se recorta (defectos vistos en Chrome
  // Android a 360 dp y en un iPhone: «Nara-nja»). Desde 320 px hay dos columnas; a 320 los círculos ceden a 24 px para que quepa «Turquesa».
  for (const width of [393, 360, 320]) {
    await ana.page.setViewportSize({ width, height: 640 });
    const r = (await ana.page.evaluate(
      `({ sizes: Array.from(document.querySelectorAll('.color-option__swatch')).map((el) => { const b = el.getBoundingClientRect(); return [Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; }), cut: Array.from(document.querySelectorAll('.color-option__label')).filter((l) => l.scrollWidth > l.clientWidth || l.getClientRects().length > 1).map((l) => l.textContent), cols: getComputedStyle(document.querySelector('.color-picker__options')).gridTemplateColumns.split(' ').length })`,
    )) as { sizes: Array<[number, number]>; cut: string[]; cols: number };
    check(r.sizes.length === 8 && r.sizes.every(([w, h]) => w === h && w >= 24), `a ${width} px de ancho los 8 círculos de color siguen siendo círculos (${r.sizes[0]?.join("×")})`);
    check(r.cut.length === 0 && r.cols === 2, `a ${width} px los nombres de los colores caben enteros, en 2 columnas${r.cut.length ? ` (cortados: ${r.cut.join(", ")})` : ""}`);
  }
  await ana.page.setViewportSize(phone);
  await shot(ana.page, "02-entrada-ana.png");
  await ana.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await ana.page.getByText("Vanessa comenzará la aventura en un momento.").waitFor();
  const beto = await open("beto", phone, `/sala/${code}`);
  await beto.page.getByLabel("Tu nombre").fill("ana");
  await beto.page.getByRole("radio", { name: "Verde" }).check();
  await beto.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await beto.page.getByText("Vanessa comenzará la aventura en un momento.").waitFor();
  check((await beto.page.locator(".banner").first().innerText()).includes("ana · 2"), "nombres repetidos conservan identidades distintas («ana · 2»)");
  await shot(ana.page, "03-espera-ana.png");

  // 3. Vanessa ve a ambas conectadas y comienza: no hay turnos, las dos exploran a la vez.
  await admin.page.locator(".participant").nth(1).waitFor();
  check((await admin.page.locator(".participant").count()) === 2, "Vanessa ve las dos tarjetas de participantes");
  check((await admin.page.getByText("2 personas conectadas").count()) === 1, "la cantidad conectada se muestra");
  check((await admin.page.getByRole("button", { name: /Dar el turno|Comenzar con/ }).count()) === 0, "ya no existen turnos ni «Dar el turno»: todas las personas participan");
  await shot(admin.page, "04-bienvenida-vanessa-con-participantes.png");
  await admin.page.getByRole("button", { name: "Comenzar la aventura" }).click();
  await ana.page.locator("canvas").waitFor();
  await beto.page.locator("canvas").waitFor();
  await admin.page.locator("canvas").waitFor();
  await admin.page.getByText("Mesa 1 de 3: Sombras").waitFor();
  check((await canvases(ana.page)) === 1 && (await canvases(beto.page)) === 1 && (await canvases(admin.page)) === 1, "las dos personas y la proyección montan UNA escena cada una");
  await ana.page.waitForTimeout(800);
  await shot(ana.page, "05-ana-telefono.png");
  await shot(admin.page, "06-proyeccion.png");

  // 4. Pausa: congela y se ve en las vistas con texto; reanudar.
  await admin.page.getByRole("button", { name: "Pausar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await ana.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await beto.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await shot(admin.page, "07-pausa-proyeccion.png");
  check((await admin.page.getByRole("heading", { name: "En pausa" }).count()) === 1 && (await ana.page.getByRole("heading", { name: "En pausa" }).count()) === 1, "la pausa llega con texto a la proyección y a los celulares");
  await admin.page.getByRole("button", { name: "Reanudar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  await ana.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  check((await canvases(ana.page)) === 1, "reanudar devuelve el mapa sin recrear nada");

  // 5. Recarga de Vanessa: recupera administración y la sala queda pausada.
  await admin.page.reload();
  await admin.page.getByText("Mesa 1 de 3: Sombras").waitFor();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  check((await admin.page.getByRole("button", { name: "Reanudar" }).count()) === 1, "al recargar, Vanessa recupera la administración con la sala pausada (CA-26)");
  await shot(admin.page, "09-vanessa-recarga-pausada.png");

  // 6. Recarga de una participante: conserva su credencial, su personaje y su sitio.
  await ana.page.reload();
  await ana.page.locator("canvas").waitFor();
  check((await ana.page.locator(".banner").first().innerText()).includes("Ana"), "al recargar, Ana conserva su credencial y vuelve a su sala");

  check(problems.length === 0, `sin errores de consola ni de página en los tres contextos${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de la sala: OK");
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
