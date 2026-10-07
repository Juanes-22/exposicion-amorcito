/// <reference lib="dom" />
// Prueba de humo contra un despliegue YA en marcha (local en Docker o la URL pública): Vanessa crea una sala, dos personas entran desde
// «celulares» independientes, Vanessa comienza y abre la primera mesa, y las dos exploran. Comprueba página, API, WebSocket, mapa y
// recursos servidos de verdad. Deja una sala de prueba que vence sola.
//
//   npx tsx scripts/e2e/smoke.ts https://mi-laboratorio.example.com
//   npm run smoke -- http://127.0.0.1:8089
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? process.env.SMOKE_URL ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(BASE)) {
  console.error("Uso: npm run smoke -- <URL del despliegue, por ejemplo https://mi-laboratorio.example.com>");
  process.exit(2);
}
const browser = await chromium.launch();
const problems: string[] = [];
const check = (cond: unknown, m: string) => {
  if (!cond) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};
const open = async (name: string, viewport: { width: number; height: number }, path: string) => {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console.error: ${m.text()}`));
  page.on("requestfailed", (r) => problems.push(`${name} petición fallida: ${r.url()} (${r.failure()?.errorText})`));
  await page.goto(`${BASE}${path}`);
  return page;
};

try {
  console.log(`Prueba de humo contra ${BASE}`);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json() as Promise<{ status: string }>);
  check(health.status === "ok", "la API responde (/api/health)");

  const admin = await open("vanessa", { width: 1280, height: 720 }, "/");
  await admin.getByRole("button", { name: "Crear sala" }).click();
  await admin.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.url().split("/").pop()!;
  await admin.getByText("Entra con tu celular").waitFor();
  const shownUrl = await admin.locator(".join-url").innerText();
  check(shownUrl.startsWith(BASE), `el enlace de entrada que se proyecta usa la dirección pública (${shownUrl})`);

  const phone = { width: 390, height: 844 };
  const join = async (name: string) => {
    const p = await open(name, phone, `/sala/${code}`);
    await p.getByLabel("Tu nombre").fill(name);
    await p.getByRole("button", { name: "Entrar a la sala" }).click();
    await p.getByText("Vanessa comenzará la aventura en un momento.").waitFor();
    return p;
  };
  const ana = await join("Ana");
  const beto = await join("Beto");
  await admin.locator(".participant").nth(1).waitFor();
  check(true, "dos personas entran por la dirección pública y Vanessa las ve conectadas (WebSocket)");

  await admin.getByRole("button", { name: "Comenzar la aventura" }).click();
  for (const p of [admin, ana, beto]) await p.locator("canvas").waitFor();
  await admin.getByRole("button", { name: "Abrir mesa: Sombras" }).click();
  await admin.getByText("0 de 2 listos").first().waitFor();
  for (const p of [ana, beto]) {
    await p.getByText("Mesas", { exact: true }).click();
    await p.getByRole("button", { name: "Ir a la mesa actual" }).click();
    await p.getByRole("heading", { name: "Sombras" }).waitFor();
  }
  await ana.getByRole("slider", { name: "Distancia de la linterna al objeto" }).fill("30");
  await ana.locator(".results li").first().waitFor();
  check(true, "el mapa y las mesas cargan, Vanessa abre la mesa y cada persona registra su resultado");
  check(problems.length === 0, `sin errores de consola, de página ni peticiones fallidas${problems.length ? `: ${problems.slice(0, 4).join(" | ")}` : ""}`);
  console.log(`\nPrueba de humo: OK (sala de prueba ${code}; vence sola)`);
} finally {
  await browser.close();
}
