/// <reference lib="dom" />
// Herramienta de ensayo con dispositivos reales o simulados (P7-06): levanta el servidor de verdad con el build (`npm run build` antes),
// crea una sala, abre la consola de Vanessa en un navegador de ESTA computadora (la proyección) y ofrece un panel de control HTTP
// local para conducir las rondas y sacar capturas mientras se prueban los celulares.
//
//   npm run ensayo                      → sala nueva; imprime la dirección que deben abrir los celulares
//   curl 'http://127.0.0.1:3412/state'  → participantes, fase, ronda y cuántas personas están listas
//   curl 'http://127.0.0.1:3412/start'  → comienza; luego /open (abrir la mesa) · /converse[?pending=1] · /freire · /next
//   y también /pause · /resume · /reset · /shot?path=/ruta/captura.png
//
// El panel de control solo escucha en 127.0.0.1. Las credenciales nunca salen de este proceso ni aparecen en direcciones.
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";
import { loadProjectFromDisk } from "../../server/src/project";

const PORT = Number(process.env.ENSAYO_PORT ?? 3400);
const CONTROL_PORT = Number(process.env.ENSAYO_CONTROL_PORT ?? 3412);
const HOST = process.env.ENSAYO_HOST ?? "0.0.0.0";
const dir = mkdtempSync(join(os.tmpdir(), "laboratorio-ensayo-"));
const settings = loadSettings({}, { databasePath: join(dir, "ensayo.sqlite"), port: PORT, host: HOST, distDir: resolve("dist") });
const project = loadProjectFromDisk(settings.publicDir);
const app = createServerApp({ settings, project, logger: { info: () => undefined, warn: console.warn, error: console.error } });
await app.listen(PORT);

const created = app.service.createRoom(project.config.contentSetId, `http://127.0.0.1:${PORT}`);
const code = created.code;
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i!.address);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(
  ([c, cred]) => {
    try {
      localStorage.setItem(`laboratorio-cosas-cotidianas:v1:sala:${c}`, JSON.stringify(cred));
    } catch {
      /* sin almacenamiento */
    }
  },
  [code, { token: created.adminToken, role: "admin", principalId: created.adminId, displayName: "Vanessa", color: null, savedAt: new Date().toISOString() }] as const,
);
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${PORT}/sala/${code}?hooks`);
await page.getByText("Entra con tu celular").waitFor();

const state = () => {
  const s = app.service.inspect(code)!.state;
  const r = s.adventure.round;
  const people = app.repo.listPrincipals(s.roomId).filter((p) => p.role === "participant");
  return {
    code,
    phase: s.phase,
    round: { mesa: project.config.route[r.index] ?? "inventor", etapa: r.stage, enLaRonda: r.roster.length + r.included.length, pendientesAlConversar: r.pendingAtConversation.length },
    pieces: s.adventure.pieces,
    notes: s.adventure.notebook.length,
    participants: people.map((p) => ({ name: p.name, distinction: p.distinction, observer: p.observer, id: p.principalId, ...(s.participants[p.principalId] ? { view: s.participants[p.principalId]!.view.kind } : {}) })),
  };
};

const actions: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  async start() {
    await page.getByRole("button", { name: "Comenzar la aventura" }).click();
    return "comenzó";
  },
  async open() {
    await page.getByRole("button", { name: /^Abrir mesa: / }).click();
    return "mesa abierta: las personas ya pueden explorar";
  },
  async converse(q) {
    await page.getByRole("button", { name: "Conversemos" }).click();
    // Con personas pendientes pide confirmación: solo se confirma si se pidió expresamente (`?pending=1`).
    const dialog = page.getByRole("alertdialog");
    if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
      if (q.get("pending") !== "1") {
        await dialog.getByRole("button", { name: "Cancelar" }).click();
        return "faltan personas por terminar; usa /converse?pending=1 para pasar a conversación con pendientes";
      }
      await dialog.getByRole("button", { name: "Pasar a conversación con pendientes" }).click();
      return "conversación, con pendientes";
    }
    return "conversación";
  },
  async freire() {
    await page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
    return "frase de Freire proyectada";
  },
  async next() {
    await page.getByRole("button", { name: /^Abrir siguiente mesa: |^Pasar al inventor/ }).click();
    return "siguiente mesa (o cierre)";
  },
  async pause() {
    await page.getByRole("button", { name: "Pausar" }).click();
    return "en pausa";
  },
  async resume() {
    await page.getByRole("button", { name: "Reanudar" }).click();
    return "reanudada";
  },
  async reset() {
    await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
    await page.getByRole("button", { name: "Sí, reiniciar" }).click();
    return "reiniciada";
  },
  async shot(q) {
    await page.screenshot({ path: q.get("path") ?? join(dir, "proyeccion.png") });
    return "captura guardada";
  },
  async viewport(q) {
    await page.setViewportSize({ width: Number(q.get("w") ?? 1280), height: Number(q.get("h") ?? 720) });
    return "tamaño cambiado";
  },
};

const control = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const name = url.pathname.slice(1);
  try {
    const result = name === "state" ? state() : actions[name] ? await actions[name]!(url.searchParams) : `comando desconocido: ${name}`;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, result }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) }));
  }
});
control.listen(CONTROL_PORT, "127.0.0.1");

console.log(`\nSala de ensayo ${code}`);
console.log(`  desde esta computadora : http://127.0.0.1:${PORT}/sala/${code}`);
for (const ip of lan) console.log(`  desde celulares reales : http://${ip}:${PORT}/sala/${code}   (misma red wifi)`);
console.log(`  emulador de Android    : http://10.0.2.2:${PORT}/sala/${code}`);
console.log(`  panel de control       : http://127.0.0.1:${CONTROL_PORT}/state   (/start /open /converse /freire /next /pause /resume /reset /shot?path=…)`);
console.log("  Ctrl+C para terminar.\n");

const stop = async () => {
  control.close();
  await browser.close();
  await app.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
