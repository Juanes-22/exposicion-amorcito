/// <reference lib="dom" />
// Prueba e2e de la fase 2: administradora + dos participantes en contextos de navegador independientes (credenciales propias),
// contra el servidor real que sirve el build. Ejecutar con `npx tsx scripts/e2e/room-flow.ts` tras `npm run build`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";

const EVIDENCE = resolve("docs/evidencia/fase2");
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
  await shot(ana.page, "02-entrada-ana.png");
  await ana.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await ana.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  const beto = await open("beto", phone, `/sala/${code}`);
  await beto.page.getByLabel("Tu nombre").fill("ana");
  await beto.page.getByRole("radio", { name: "Verde" }).check();
  await beto.page.getByRole("button", { name: "Entrar a la sala" }).click();
  await beto.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  check((await beto.page.locator("h1").innerText()) === "ana · 2", "nombres repetidos conservan identidades distintas («ana · 2»)");
  check((await canvases(ana.page)) === 0 && (await canvases(beto.page)) === 0, "quien espera no monta ningún canvas del mapa (CA-04)");
  await shot(ana.page, "03-espera-ana.png");

  // 3. Vanessa ve a ambas conectadas, da el turno a Ana y comienza.
  await admin.page.locator(".participant").nth(1).waitFor();
  check((await admin.page.locator(".participant").count()) === 2, "Vanessa ve las dos tarjetas de participantes");
  check((await admin.page.getByText("2 conectadas").count()) === 1, "la cantidad conectada se muestra");
  await shot(admin.page, "04-bienvenida-vanessa-con-participantes.png");
  await admin.page.getByRole("button", { name: "Dar el turno a Ana", exact: true }).click();
  await admin.page.getByRole("button", { name: "Comenzar con Ana" }).click();
  await ana.page.getByText("Es tu turno, Ana").waitFor();
  await ana.page.locator("canvas").waitFor();
  await admin.page.getByText("Explora: Ana").waitFor();
  await admin.page.locator("canvas").waitFor();
  check((await canvases(ana.page)) === 1 && (await canvases(admin.page)) === 1, "Ana (controladora) y Vanessa (proyección) montan UNA escena cada una");
  check((await canvases(beto.page)) === 0, "la persona en espera sigue sin canvas mientras Ana juega");
  await ana.page.waitForTimeout(800);
  await shot(ana.page, "05-turno-ana-telefono.png");
  await shot(admin.page, "06-proyeccion-explora-ana.png");

  // 4. Cambio de turno: Ana vuelve a espera, Beto recibe el mapa.
  // Los paneles de moderación arrancan plegados para no tapar el mapa proyectado: Vanessa abre «Participantes».
  check((await admin.page.getByRole("button", { name: "Dar el turno a ana · 2" }).isVisible()) === false, "los paneles de moderación arrancan plegados y no cubren el mapa");
  await admin.page.getByText("Participantes (2 conectadas)").click();
  const t0 = Date.now();
  await admin.page.getByRole("button", { name: "Dar el turno a ana · 2" }).click();
  await beto.page.getByText("Es tu turno, ana · 2").waitFor();
  const turnMs = Date.now() - t0;
  await beto.page.locator("canvas").waitFor();
  await ana.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  await ana.page.waitForFunction(() => document.querySelectorAll("canvas").length === 0);
  check((await canvases(ana.page)) === 0 && (await canvases(beto.page)) === 1, "el cambio de turno retira el mapa a Ana y lo monta para Beto");
  check(await ana.page.getByText("Explora: ana · 2").count() === 1, "Ana ve de quién es el turno");
  console.log(`  ℹ turno visible en el teléfono de Beto ${turnMs} ms después del clic (medición informal, un solo intento, mismo equipo)`);
  await shot(beto.page, "07-turno-beto-telefono.png");

  // 5. Pausa: congela y se ve en las vistas con texto; reanudar.
  await admin.page.getByRole("button", { name: "Pausar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await beto.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await shot(admin.page, "08-pausa-proyeccion.png");
  check((await admin.page.getByRole("heading", { name: "En pausa" }).count()) === 1 && (await beto.page.getByRole("heading", { name: "En pausa" }).count()) === 1, "la pausa llega con texto a la proyección y al controlador");
  await admin.page.getByRole("button", { name: "Reanudar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  await beto.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  check((await canvases(beto.page)) === 1, "reanudar devuelve el mapa al controlador sin recrear nada");

  // 6. Recarga de Vanessa: recupera administración y la sala queda pausada.
  await admin.page.reload();
  await admin.page.getByText("Explora: ana · 2").waitFor();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  check((await admin.page.getByRole("button", { name: "Reanudar" }).count()) === 1, "al recargar, Vanessa recupera la administración con la sala pausada (CA-26)");
  await shot(admin.page, "09-vanessa-recarga-pausada.png");

  check(problems.length === 0, `sin errores de consola ni de página en los tres contextos${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de la fase 2: OK");
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
