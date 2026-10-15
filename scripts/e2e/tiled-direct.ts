/// <reference lib="dom" />
// CT-01: guardar el TMJ cambia una sala nueva, sin importación intermedia; un TMJ inválido falla indicando capa y objeto.
// Trabaja sobre una COPIA del build (no toca los archivos del proyecto). Requiere `npm run build`.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";

const dir = mkdtempSync(join(tmpdir(), "laboratorio-tiled-"));
const dist = join(dir, "dist");
cpSync(resolve("dist"), dist, { recursive: true });
const tmjPath = join(dist, "maps/laboratorio.tmj");
const original = readFileSync(tmjPath, "utf8");
const app = createServerApp({ settings: loadSettings({}, { databasePath: join(dir, "t.sqlite"), port: 0, host: "127.0.0.1", distDir: dist }) });
const BASE = `http://127.0.0.1:${await app.listen(0)}`;
const browser = await chromium.launch();
const check = (c: unknown, m: string) => {
  if (!c) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};

type Pos = { shadows: { x: number; y: number }; ramps: { x: number; y: number } };
/** Una sala nueva, con una persona que juega, hasta que la proyección de Vanessa dibuja el laboratorio: dónde quedaron las estaciones. */
async function stationPositions(): Promise<{ pos: Pos; requested: string[] }> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const requested: string[] = [];
  page.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Crear sala" }).click();
  await page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const roomUrl = new URL(page.url()).pathname;
  await page.goto(`${BASE}${roomUrl}?hooks`);
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`${BASE}${roomUrl}`);
  await phone.getByLabel("Tu nombre").fill("Ana");
  await phone.getByRole("button", { name: "Entrar a la sala" }).click();
  await page.getByText("1 persona conectada", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Comenzar la aventura" }).click();
  await page.locator("canvas").waitFor();
  await page.waitForFunction(() => (window as unknown as { __PHASER_GAME__?: { scene: { getScene(k: string): { children?: { list: unknown[] } } | null } } }).__PHASER_GAME__?.scene.getScene("LaboratoryScene")?.children?.list.length);
  // Sin funciones con nombre dentro del callback: tsx inyecta `__name`, que no existe en el navegador.
  const pos = await page.evaluate(() => {
    const scene = (window as unknown as { __PHASER_GAME__: { scene: { getScene(k: string): { children: { list: Array<{ texture?: { key: string }; x: number; y: number }> } } } } }).__PHASER_GAME__.scene.getScene("LaboratoryScene");
    const found = ["lab.station.shadows", "lab.station.ramps"].map((key) => scene.children.list.find((c) => c.texture?.key === key)!);
    return { shadows: { x: found[0]!.x, y: found[0]!.y }, ramps: { x: found[1]!.x, y: found[1]!.y } };
  });
  await page.context().close();
  await phone.context().close();
  return { pos, requested };
}

try {
  // Ninguna copia editable de coordenadas ni importador intermedio.
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === "dist" || e.name === ".git" ? [] : e.isDirectory() ? files(join(d, e.name)).map((f) => join(e.name, f)) : [e.name]));
  const all = files(resolve("."));
  check(!all.some((f) => /(^|\/)maps\.json$/.test(f)) && !all.some((f) => /placements/.test(f)), "no existe maps.json ni un archivo de placements");
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
  check(!Object.keys(scripts).some((k) => /^tiled:(generate|import|catalog)$/.test(k)), "package.json no define tiled:generate, tiled:import ni tiled:catalog");

  const before = await stationPositions();
  console.log("  antes:", JSON.stringify(before.pos));
  check(before.requested.includes("/maps/laboratorio.tmj"), "el navegador pidió el TMJ directamente");
  check(!before.requested.some((p) => /maps\.json|placements/.test(p)), "ningún archivo espacial intermedio en las peticiones de red");

  // «Abrir Tiled, mover la estación Sombras 100 px a la derecha y guardar»: se edita el mismo TMJ.
  const edited = JSON.parse(original);
  const obj = edited.layers.find((l: { name: string }) => l.name === "stations").objects.find((o: { name: string }) => o.name === "sombras");
  console.log(`  cambio espacial en el TMJ: objeto «sombras» x ${obj.x} → ${obj.x + 100}`);
  obj.x += 100;
  writeFileSync(tmjPath, JSON.stringify(edited, null, 1));
  const after = await stationPositions();
  console.log("  después:", JSON.stringify(after.pos));
  check(after.pos.shadows.x === before.pos.shadows.x + 100 && after.pos.shadows.y === before.pos.shadows.y, "una sala nueva dibuja la estación 100 px a la derecha, sin ningún paso intermedio");
  check(after.pos.ramps.x === before.pos.ramps.x, "las demás estaciones no se movieron");

  // TMJ inválido: asset desconocido → el frontend lo rechaza antes de iniciar Phaser indicando capa y objeto.
  const invalid = JSON.parse(original);
  invalid.layers.find((l: { name: string }) => l.name === "stations").objects.find((o: { name: string }) => o.name === "rampas").properties[1].value = "lab.station.fantasma";
  writeFileSync(tmjPath, JSON.stringify(invalid));
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/`);
  await page.getByRole("alert").waitFor();
  const text = await page.getByRole("alert").innerText();
  check(/lab\.station\.fantasma/.test(text) && /rampas/.test(text) && /laboratorio\.tmj/.test(text), "un asset desconocido se rechaza nombrando el archivo, el objeto y el assetId");
  check((await page.locator("canvas").count()) === 0, "no se inicializa Phaser con un paquete inválido");
  console.log("  mensaje mostrado:", text.replace(/\s+/g, " ").slice(0, 200));
  console.log("\nE2E Tiled directo: OK");
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  if (!existsSync(resolve("public/maps/laboratorio.tmj"))) throw new Error("¡el TMJ del proyecto desapareció!");
}
