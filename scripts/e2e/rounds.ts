/// <reference lib="dom" />
// Rondas con participación simultánea a través de la interfaz real: proyección de Vanessa + dos teléfonos que juegan, en contextos de
// navegador independientes, contra el build servido por el servidor real (`npm run build` antes).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";
import { loadProjectFromDisk } from "../../server/src/project";

const EVIDENCE = process.env.E2E_EVIDENCE ? resolve("docs/evidencia/rondas") : mkdtempSync(join(tmpdir(), "laboratorio-evidencia-"));
const dir = mkdtempSync(join(tmpdir(), "laboratorio-rondas-"));
const settings = loadSettings({}, { databasePath: join(dir, "r.sqlite"), port: 0, host: "127.0.0.1", distDir: resolve("dist") });
const project = loadProjectFromDisk(settings.publicDir);
const app = createServerApp({ settings, project });
const BASE = `http://127.0.0.1:${await app.listen(0)}`;
const browser = await chromium.launch();
const problems: string[] = [];
const check = (cond: unknown, m: string) => {
  if (!cond) throw new Error(`✖ ${m}`);
  console.log(`  ✔ ${m}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (page: Page, name: string) => page.screenshot({ path: join(EVIDENCE, name) });

async function open(name: string, viewport: { width: number; height: number }, path: string) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console.error: ${m.text()}`));
  await page.goto(`${BASE}${path}`);
  return { ctx, page };
}

/** Lo que Phaser tiene por dentro: el último estado visual que la aplicación le entregó. */
const visual = (page: Page) => page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.visual);
const waitVisual = (page: Page, pred: string, timeout = 8000) =>
  page.waitForFunction(`(() => { const v = window.__PHASER_GAME__?.registry.get("deps").bridge.visual; return !!v && (${pred}); })()`, undefined, { timeout });
const activeScenes = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const g = (window as any).__PHASER_GAME__;
    return ["LaboratoryScene", "ShadowsScene", "RampsScene", "TelescopeScene", "InventorScene"].filter((k) => g.scene.isActive(k));
  });
const scenesAre = async (page: Page, ...keys: string[]) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if ((await activeScenes(page)).join() === keys.join()) return true;
    await sleep(100);
  }
  console.log(`    (escenas activas: ${(await activeScenes(page)).join() || "ninguna"}; se esperaba ${keys.join()})`);
  return false;
};
/** Los textos que dibuja una escena de Phaser (rótulos): sirve para comprobar que no muestra medidas. */
const sceneTexts = (page: Page, key: string): Promise<string> =>
  page.evaluate((k) => (window as any).__PHASER_GAME__.scene.getScene(k).children.list.filter((o: any) => o.type === "Text").map((o: any) => o.text).join(" | "), key);
const config_prompt = () => project.config.inventor.prompt;
/** Abre un panel plegable de Vanessa sin importar si ya estaba abierto. */
/** Toca el laboratorio en un punto de MUNDO: calcula dónde cae en pantalla con la cámara real y hace un clic de verdad. */
async function tapWorld(page: Page, wx: number, wy: number): Promise<void> {
  await sleep(220); // la escena descarta toques demasiado seguidos
  const v = await page.evaluate(() => {
    const w = (window as any).__PHASER_GAME__.scene.getScene("LaboratoryScene").cameras.main.worldView;
    return { x: w.x, y: w.y, w: w.width, h: w.height };
  });
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + ((wx - v.x) / v.w) * box.width, box.y + ((wy - v.y) / v.h) * box.height);
}
/** Toca la máquina del inventor (su dibujo) en el laboratorio. */
async function tapInventor(page: Page): Promise<void> {
  const c = await page.evaluate(() => {
    const b = (window as any).__PHASER_GAME__.scene.getScene("LaboratoryScene").built.inventor.image.getBounds();
    return { x: b.centerX, y: b.centerY };
  });
  await tapWorld(page, c.x, c.y);
}
/**
 * Camina hasta un punto del laboratorio como lo haría una persona: en el celular la cámara sigue al personaje, así que si el destino no se
 * ve se toca el punto visible más cercano en esa dirección, se espera la llegada y se repite.
 */
async function walkTo(page: Page, at: { x: number; y: number }): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const st = await page.evaluate(() => {
      const g = (window as any).__PHASER_GAME__;
      const w = g.scene.getScene("LaboratoryScene").cameras.main.worldView;
      const b = g.registry.get("deps").bridge;
      const me = b.visual.viewer.me.character;
      const p = me.plan;
      const feet = p ? p.points[p.points.length - 1] : me.feet;
      return { view: { x: w.x, y: w.y, w: w.width, h: w.height }, feet, planId: p?.planId ?? "" };
    });
    if (Math.hypot(st.feet.x - at.x, st.feet.y - at.y) < 8) break;
    const m = 30;
    const tx = Math.min(Math.max(at.x, st.view.x + m), st.view.x + st.view.w - m);
    const ty = Math.min(Math.max(at.y, st.view.y + m), st.view.y + st.view.h - m);
    await tapWorld(page, tx, ty);
    await waitVisual(page, `(v.viewer.me.character.plan?.planId ?? "") !== ${JSON.stringify(st.planId)}`);
    await page.waitForFunction(
      () => {
        const b = (window as any).__PHASER_GAME__.registry.get("deps").bridge;
        const p = b.visual.viewer.me.character.plan;
        return p === null || b.clock.now() >= p.startActiveMs + (p.lengthTotal / p.speed) * 1000;
      },
      undefined,
      { timeout: 20000 },
    );
    await sleep(300); // la cámara termina de seguir al personaje
  }
}
const openPanel = (page: Page, title: RegExp) => page.locator("details.panel", { has: page.locator("summary", { hasText: title }) }).evaluate((el) => ((el as HTMLDetailsElement).open = true));

try {
  // ---- sala con proyección y dos teléfonos que juegan ----
  const admin = await open("admin", { width: 1280, height: 720 }, "/");
  await admin.page.getByRole("button", { name: "Crear sala" }).click();
  await admin.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.page.url().split("/").pop()!;
  await admin.page.goto(`${BASE}/sala/${code}?hooks`);
  await admin.page.getByText("Entra con tu celular").waitFor();
  const phone = { width: 390, height: 844 };
  const join = async (name: string) => {
    const p = await open(name.toLowerCase(), phone, `/sala/${code}?hooks`);
    await p.page.getByLabel("Tu nombre").fill(name);
    check((await p.page.getByRole("checkbox").count()) === 0 && (await p.page.getByText(/acompañar/i).count()) === 0, `${name} entra a jugar: la entrada no ofrece «solo acompañar»`);
    await p.page.getByRole("button", { name: "Entrar a la sala" }).click();
    return p;
  };
  const ana = await join("Ana");
  const beto = await join("Beto");
  await admin.page.getByText("2 personas conectadas", { exact: true }).waitFor(); // las dos ya abrieron su conexión
  await shot(admin.page, "01-bienvenida-vanessa.png");
  check((await admin.page.locator(".participant").count()) === 2, "Vanessa ve a las 2 personas conectadas");
  await admin.page.getByRole("button", { name: "Comenzar la aventura" }).click();
  await ana.page.locator("canvas").waitFor();
  await beto.page.locator("canvas").waitFor();
  await admin.page.locator("canvas").waitFor();
  await sleep(1200);
  // El nombre de cada persona está siempre encima de su avatar, también en la proyección.
  const nombres = (page: Page) => page.evaluate(() => {
    const sc = (window as any).__PHASER_GAME__.scene.getScene("LaboratoryScene");
    // Los rótulos de las mesas usan otro estilo y otro tamaño: los de personas son los que se pegan a un avatar (un Image de silueta).
    const siluetas = sc.children.list.filter((c: any) => c.type === "Image" && String(c.texture?.key).startsWith("silhouette."));
    return sc.children.list
      .filter((c: any) => c.type === "Text" && c.visible && siluetas.some((i: any) => Math.abs(i.x - c.x) < 1 && c.y < i.y && i.y - c.y < 120))
      .map((c: any) => c.text as string)
      .sort();
  });
  check(JSON.stringify(await nombres(admin.page)) === JSON.stringify(["Ana", "Beto"]), "la proyección rotula a cada jugador sobre su avatar (sin tocar nada): Ana y Beto");
  check(JSON.stringify(await nombres(ana.page)) === JSON.stringify(["Ana (tú)", "Beto"]), "en el celular de Ana se ve «Ana (tú)» y «Beto» sobre sus avatares");
  check(JSON.stringify(await nombres(beto.page)) === JSON.stringify(["Ana", "Beto (tú)"]), "y en el de Beto, «Beto (tú)» y «Ana»: cada jugador ve los nombres de los demás");
  await admin.page.locator(".projection__question").getByText(project.config.project.entryQuestion).waitFor();
  check((await admin.page.locator(".projection__question").count()) === 1 && (await admin.page.getByText(project.config.activities.sombras!.openingQuestion).count()) === 0, "al comenzar solo se proyecta la pregunta de entrada: la de Sombras aparece al abrir la mesa");
  await shot(ana.page, "02-telefono-preparacion.png");
  await shot(admin.page, "03-proyeccion-pregunta-entrada.png");

  // ================= SOMBRAS =================
  console.log("\nSombras");
  check((await ana.page.getByText("Mesas", { exact: true }).count()) === 1, "el celular de quien juega tiene el mapa y la barra «Mesas · piezas · Cuaderno»");
  await admin.page.getByRole("button", { name: "Abrir mesa: Sombras" }).click();
  await admin.page.getByText("0 de 2 listos").first().waitFor();
  check(true, "al abrir la mesa, el contador cuenta a quienes juegan: «0 de 2 listos»");
  await admin.page.locator(".projection__question").getByText("¿Qué cambiará si acercamos o alejamos la linterna?").waitFor();
  check((await admin.page.getByText(project.config.project.entryQuestion).count()) === 0, "al abrir Sombras la proyección muestra su pregunta a la derecha, en lugar de la de entrada");
  await ana.page.getByText("Mesas", { exact: true }).click();
  await ana.page.getByRole("button", { name: "Ir a la mesa actual" }).click();
  await ana.page.getByRole("heading", { name: "Sombras" }).waitFor();
  await beto.page.getByText("Mesas", { exact: true }).click();
  await beto.page.getByRole("button", { name: "Ir a la mesa actual" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor();
  check((await scenesAre(ana.page, "ShadowsScene")) && (await scenesAre(beto.page, "ShadowsScene")), "las dos personas exploran a la vez, cada una en su escena de Sombras");
  check((await scenesAre(admin.page, "LaboratoryScene")), "la proyección sigue mostrando el laboratorio compartido");
  await sleep(500);
  await shot(ana.page, "04-sombras-telefono.png");
  await shot(admin.page, "05-sombras-proyeccion-exploracion.png");

  // Ana mueve la linterna a dos posiciones: el juego las registra solo (no hay botón «Anotar»).
  check((await ana.page.getByRole("button", { name: /Anotar/ }).count()) === 0 && (await ana.page.getByText(/Tengo una pregunta|Entendido|Compartir con el grupo/).count()) === 0, "no hay formularios, modalidades ni botones de «Anotar»/«Entendido»/«Tengo una pregunta»");
  const slider = ana.page.getByRole("slider", { name: "Distancia de la linterna al objeto" });
  await slider.fill("30"); // el slider crece hacia «más cerca»: 10 + 60 − 30 = 40 cm, «lejos»
  await waitVisual(ana.page, `v.viewer.me.activities.sombras.samples.length === 1`);
  await ana.page.getByText("Explorando · 1 de 2").waitFor();
  check(true, "al terminar el ajuste, la posición queda registrada sola, sin pulsar nada");
  // Lo que se ve en el panel (sin el texto reservado a lectores de pantalla, que sí describe la sombra a quien no puede verla).
  const panelSombras = await ana.page.locator(".personal").evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".visually-hidden").forEach((x) => x.remove());
    return copy.textContent ?? "";
  });
  check(!/cm|centímetro/.test(panelSombras) && !/cm/.test(await sceneTexts(ana.page, "ShadowsScene")), "Sombras compara tamaños sin medidas: ni el panel ni la escena muestran centímetros");
  check(!/sombra es|sombra (muy )?grande|sombra pequeña|sombra mediana|Posición \d/.test(panelSombras), "la pantalla no le dice a Ana qué tan grande es la sombra ni lista sus posiciones: lo observa ella en la escena");
  await slider.fill("45"); // 25 cm, «cerca»
  await waitVisual(ana.page, `v.viewer.me.activities.sombras.samples.length === 2`);
  await ana.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("1 de 2").first().waitFor();
  check(true, "con dos posiciones separadas Ana queda «Lista para conversar» y el contador de Vanessa dice «1 de 2»");
  check((await beto.page.getByText("Explorando · 0 de 2").count()) === 1, "Beto sigue explorando: su avance es independiente del de Ana");
  check((await ana.page.getByRole("button", { name: "Volver al mapa" }).count()) === 1 && (await beto.page.getByRole("button", { name: "Volver al mapa" }).count()) === 0, "«Volver al mapa» aparece solo para quien ya completó la mesa (Ana), no para Beto");
  await shot(ana.page, "06-sombras-lista-telefono.png");

  // Conversemos con una persona pendiente: pide confirmación y deja claro que es excepcional.
  await admin.page.getByRole("button", { name: "Conversemos" }).click();
  const pendientes = admin.page.getByRole("alertdialog", { name: "Todavía hay personas explorando" });
  await pendientes.getByRole("list", { name: "Personas que aún no terminan" }).getByText("Beto").waitFor();
  check((await pendientes.innerText()).includes("Ya terminaron 1 de 2"), "«Conversemos» con alguien pendiente abre un diálogo que dice cuántas terminaron y nombra a Beto");
  // El diálogo se abre desde la barra oscura de la consola: su texto no hereda el color claro de la barra (se leía en blanco sobre crema).
  const colores = await pendientes.evaluate((el) => ({ texto: getComputedStyle(el.querySelector("h2")!).color, fondo: getComputedStyle(el).backgroundColor }));
  check(colores.texto === "rgb(59, 42, 26)" && colores.texto !== colores.fondo, `el texto del diálogo se lee: oscuro sobre el fondo claro (${colores.texto} sobre ${colores.fondo})`);
  await shot(admin.page, "07-conversemos-con-pendientes.png");
  await pendientes.getByRole("button", { name: "Conversar ahora" }).click();
  await ana.page.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.").first().waitFor();
  await beto.page.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.").first().waitFor();
  check((await ana.page.getByRole("slider").count()) === 0 && (await beto.page.getByRole("slider").count()) === 0, "en la conversación los teléfonos dejan de ofrecer controles y mandan a mirar la proyección");
  await admin.page.locator(".projection__question").getByText(/¿Qué cambió cuando movieron la linterna\? ¿Qué observación nos ayuda a revisar la primera explicación\?/).waitFor();
  check((await admin.page.locator(".projection__freire").count()) === 0, "la frase de Freire todavía no se proyecta: Vanessa decide cuándo");

  // Vanessa proyecta los resultados de Ana, muestra la frase de Freire y guarda lo que el grupo piensa.
  check((await admin.page.getByRole("button", { name: /Proyectar resultados/ }).count()) === 0 && (await admin.page.locator(".comparison").count()) === 0, "no existe proyectar los resultados de una persona: la conversación parte de lo que el grupo observó");
  check((await admin.page.getByRole("button", { name: /Abrir siguiente mesa|Pasar al inventor/ }).count()) === 0, "antes de mostrar la frase de Freire no se ofrece abrir la siguiente mesa");
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await admin.page.getByRole("button", { name: "Abrir siguiente mesa: Rampas" }).waitFor();
  check((await admin.page.getByRole("button", { name: /Freire/ }).count()) === 0, "al mostrar la frase, ese botón desaparece y en su lugar aparece «Abrir siguiente mesa: Rampas»");
  await admin.page.locator(".projection__freire").getByText("Freire propone volver más rigurosa nuestra curiosidad al observar, comparar y buscar razones.").waitFor();
  check(true, "«Mostrar la frase de Freire» proyecta la frase de Sombras");
  // Al aparecer la pregunta junto al laboratorio el escenario cambia de tamaño: el lienzo lo sigue y el mapa queda centrado y entero.
  const fits = () => admin.page.evaluate(() => {
    const c = document.querySelector(".game-host canvas") as HTMLCanvasElement;
    const host = document.querySelector(".game-host") as HTMLElement;
    return Math.abs(c.getBoundingClientRect().width - host.getBoundingClientRect().width) <= 1 && Math.abs(c.getBoundingClientRect().height - host.getBoundingClientRect().height) <= 1;
  });
  await sleep(700);
  console.log("   debug2", await admin.page.evaluate(() => { const g = (window as any).__PHASER_GAME__; const before = [g.scale.gameSize.width, g.scale.gameSize.height]; g.scale.refresh(); const after = [g.scale.gameSize.width, g.scale.gameSize.height, g.scale.displaySize.width, g.scale.displaySize.height, g.scale.parentSize.width, g.scale.parentSize.height, g.scale.zoom, g.scale.autoCenter, g.scale.minSize?.width, g.scale.maxSize?.width]; return JSON.stringify({ before, after, canvasStyle: g.canvas.style.cssText }); }));
  check(await fits(), "el lienzo de la proyección ocupa exactamente su hueco aunque la pregunta ocupe parte de la pantalla");
  await shot(admin.page, "08-conversacion-proyeccion.png");
  await openPanel(admin.page, /Cuaderno del grupo/);
  await admin.page.getByLabel("Idea inicial del grupo").fill("La luz estira la sombra");
  await admin.page.getByRole("button", { name: "Guardar la idea inicial" }).click();
  await admin.page.getByLabel(/Idea del grupo \(síntesis/).fill("Cuanto más cerca está la luz, más grande es la sombra");
  await admin.page.getByRole("button", { name: "Guardar la idea", exact: true }).click();
  await admin.page.locator(".records .record__text", { hasText: "Cuanto más cerca está la luz" }).waitFor();
  const notes = (await visual(admin.page)).group.notebook;
  check(notes.some((n: any) => n.kind === "initialIdea" && n.text === "La luz estira la sombra") && notes.some((n: any) => n.kind === "synthesis"), "el cuaderno del grupo guarda aparte la idea inicial y la síntesis («Idea del grupo»)");
  await ana.page.getByText("Cuaderno", { exact: true }).click().catch(() => undefined);

  // Abrir siguiente mesa: la pieza se incorpora ahora y todos vuelven al mapa.
  check((await visual(admin.page)).group.pieces.length === 0, "mientras se conversa, la pieza todavía no está en el inventor");
  await admin.page.getByRole("button", { name: "Abrir siguiente mesa: Rampas" }).click();
  await waitVisual(admin.page, `v.group.pieces.includes("lupa") && v.group.round.index === 1`);
  await admin.page.getByText("Mesa 2 de 3: Rampas").waitFor();
  check(true, "«Abrir siguiente mesa» incorpora la pieza Lupa y pasa a la preparación de Rampas");
  check((await scenesAre(ana.page, "LaboratoryScene")) && (await scenesAre(beto.page, "LaboratoryScene")), "todas las personas vuelven al laboratorio para recibir la siguiente mesa");
  await admin.page.locator(".projection").waitFor({ state: "detached" });
  check((await admin.page.locator(".adventure__activity").count()) === 0, "antes de abrir Rampas no se proyecta ninguna pregunta: el laboratorio ocupa toda la pantalla");
  await shot(ana.page, "10-telefono-rampas-preparacion.png");

  // ================= RAMPAS =================
  console.log("\nRampas");
  await ana.page.getByText("Mesas", { exact: true }).click();
  check(await ana.page.getByRole("button", { name: "Ir a la mesa actual" }).isDisabled(), "en la preparación nadie puede abrir la mesa todavía: «Ir a la mesa actual» está desactivado");
  await ana.page.getByText("Mesas", { exact: true }).click();
  await admin.page.getByRole("button", { name: "Abrir mesa: Rampas" }).click();
  await admin.page.locator(".projection__question").getByText("¿Qué creen que cambiará si inclinamos más esta rampa? ¿Cómo podríamos comprobarlo?").waitFor();
  check(true, "al abrir Rampas su pregunta aparece a la derecha");
  await shot(admin.page, "09-rampas-pregunta-proyeccion.png");
  const goTable = async (p: Page, title: string) => {
    await p.getByText("Mesas", { exact: true }).click();
    await p.getByRole("button", { name: "Ir a la mesa actual" }).click();
    await p.getByRole("heading", { name: title }).waitFor();
  };
  await goTable(ana.page, "Rampas");
  await goTable(beto.page, "Rampas");
  check((await scenesAre(ana.page, "RampsScene")) && (await scenesAre(beto.page, "RampsScene")) && (await scenesAre(admin.page, "LaboratoryScene")), "Rampas abre su escena para cada persona, sin escena de docente, y la proyección sigue en el laboratorio");
  const angle = (p: Page) => p.getByRole("slider", { name: "Inclinación de la rampa" });
  const release = (p: Page) => p.getByRole("button", { name: "Soltar la pelota" });
  // Las dos sueltan a la vez: cada pelota es suya y no se estorban.
  await angle(ana.page).fill("0"); // «La menos empinada»
  await angle(beto.page).fill("1"); // «Poco empinada»
  check((await angle(ana.page).getAttribute("max")) === "5" && (await angle(ana.page).getAttribute("aria-valuetext")) === "La menos empinada", "Rampas ofrece seis inclinaciones, nombradas sin grados");
  await release(ana.page).click();
  await release(beto.page).click();
  await waitVisual(ana.page, `v.viewer.me.activities.rampas.trials.length === 1`);
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials.length === 1`);
  check(await angle(ana.page).isDisabled() && await ana.page.getByRole("button", { name: "La pelota está rodando…" }).isDisabled(), "con la pelota rodando no se puede cambiar la inclinación ni soltar otra");
  await shot(ana.page, "11-rampas-pelota-rodando.png");
  check(!/°|\d+[,.]\d+ ?s\b|simulación/.test(await sceneTexts(ana.page, "RampsScene")) && !/°|segundos|simulación/.test(await ana.page.locator(".personal").innerText()), "mientras la pelota rueda no se muestra ningún tiempo ni grado: cuánto demora es la pregunta");
  await waitVisual(ana.page, `v.viewer.me.activities.rampas.trials[0].state === "finished"`, 12000);
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials[0].state === "finished"`, 12000);
  check(true, "las dos pruebas terminaron solas y se registraron sin pulsar nada («Anotar» no existe)");
  await angle(ana.page).fill("5"); // «La más empinada»
  await release(ana.page).click();
  await waitVisual(ana.page, `v.viewer.me.activities.rampas.trials.length === 2 && v.viewer.me.activities.rampas.trials[1].state === "finished"`, 12000);
  await ana.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("1 de 2").first().waitFor();
  const anaTrials = await ana.page.getByRole("list", { name: "Tus pruebas de la rampa" }).locator("li").allInnerTexts();
  check(anaTrials.join(" / ") === "Prueba 1: la menos empinada / Prueba 2: la más empinada", "Ana queda lista con dos inclinaciones distintas y su lista las nombra, sin tiempos");
  await angle(beto.page).fill("2"); // «Algo empinada»: la siguiente a la que ya probó, también cuenta
  await release(beto.page).click();
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials.length === 2 && v.viewer.me.activities.rampas.trials[1].state === "finished"`, 12000);
  await beto.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("2 de 2").first().waitFor();
  check(true, "Beto queda listo con dos inclinaciones vecinas y el contador dice «2 de 2»");
  // Una prueba en marcha se cancela al reunir al grupo.
  await angle(beto.page).fill("5");
  await release(beto.page).click();
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials.length === 3`);
  await admin.page.getByRole("button", { name: "Conversemos" }).click();
  await beto.page.getByText("Ya exploramos: deja los controles y mira la proyección para escuchar lo que descubrieron los demás.").first().waitFor();
  const betoTrials = (await visual(beto.page)).viewer.me.activities.rampas.trials;
  check(betoTrials[2].state === "cancelled" && betoTrials.filter((t: any) => t.state === "finished").length === 2, "con todas listas «Conversemos» no pide confirmación y cancela la prueba que seguía rodando (no cuenta como terminada)");
  await admin.page.locator(".projection__question").getByText("¿Qué observaron y qué resultado apoya su explicación? ¿Alguien quiere añadir algo a lo que dijo su compañero?").waitFor();
  check(true, "en la conversación de Rampas la proyección hace la pregunta de la guía de Vanessa");
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await admin.page.locator(".projection__freire").getByText(/Para Freire, dialogar incluye preguntar y escuchar/).waitFor();
  check(true, "se proyecta la frase de Freire de Rampas");
  await shot(admin.page, "12-rampas-conversacion-proyeccion.png");
  await admin.page.getByRole("button", { name: "Abrir siguiente mesa: El observatorio" }).click();
  await waitVisual(admin.page, `v.group.pieces.includes("dialogo") && v.group.round.index === 2`);
  check(true, "al abrir la siguiente mesa se incorpora la pieza Diálogo");

  // ================= EL OBSERVATORIO =================
  console.log("\nEl observatorio");
  await admin.page.getByRole("button", { name: "Abrir mesa: El observatorio" }).click();
  await admin.page.locator(".projection__question").getByText(/Tenemos un telescopio para mirar el cielo/).waitFor();
  check(true, "al abrir El observatorio su pregunta aparece a la derecha");
  await goTable(ana.page, "El observatorio");
  await goTable(beto.page, "El observatorio");
  check((await scenesAre(ana.page, "TelescopeScene")) && (await scenesAre(beto.page, "TelescopeScene")) && (await scenesAre(admin.page, "LaboratoryScene")), "cada persona mira por su propio telescopio y la proyección sigue en el laboratorio");
  const scope = async (page: Page) => (await visual(page)).viewer.me.activities.cajas;
  check((await scope(ana.page)).zoom === 0 && (await scope(ana.page)).observed.length === 0 && (await scope(ana.page)).curtain === "open", "el visor empieza en el cielo, con el aumento general");
  // La descripción de lo que se ve existe solo para lectores de pantalla: a la vista, cada persona hace sus propias observaciones.
  const readout = (page: Page) => page.locator(".personal p.visually-hidden[role=status]");
  const seen = (page: Page) =>
    page.locator(".personal").evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".visually-hidden").forEach((x) => x.remove());
      return copy.textContent ?? "";
    });
  check((await ana.page.getByRole("button", { name: /^(Luna|Estrellas|Horizonte|Volver al cielo)$|espiar|casa|ventana/i }).count()) === 0, "no hay atajos: ni «Luna», «Estrellas», «Horizonte» o «Volver al cielo», ni nada que lleve a la casa");
  // Solo flechas y aumento (rutas calculadas con el mismo dominio): U, D, L, R, + y −.
  const KEYS: Record<string, string> = { U: "Mirar más arriba", D: "Mirar más abajo", L: "Mirar a la izquierda", R: "Mirar a la derecha", "+": "Acercar la vista: aumento cercano", "-": "Alejar la vista: aumento general" };
  const steer = async (p: Page, route: string) => {
    for (const k of route) await p.getByRole("button", { name: KEYS[k]!, exact: true }).click();
  };

  // Ana: la Luna de cerca y después el grupo de estrellas, moviendo el telescopio ella misma.
  await steer(ana.page, "LL+");
  await readout(ana.page).getByText(/La Luna de cerca: zonas claras y oscuras/).waitFor({ state: "attached" });
  check(!/cráteres|zonas claras|Luna de cerca/.test(await seen(ana.page)), "la pantalla no describe la Luna: Ana la observa en el visor (la descripción queda para lectores de pantalla)");
  await ana.page.getByText("✓ Luna observada").waitFor();
  await shot(ana.page, "13-observatorio-luna-telefono.png");
  await steer(ana.page, "-RRRRRRRRR");
  await ana.page.getByText("✓ Estrellas observadas").waitFor();
  await ana.page.getByText("✓ Listo para conversar").waitFor();
  check((await scope(ana.page)).curtain === "open" && !(await ana.page.locator(".personal").innerText()).includes("Galaxia"), "Ana observa la Luna de cerca y el grupo de estrellas con las flechas y queda lista sin acercarse a la casa; la galaxia no se anuncia");

  // Ana arrastra el visor (lo dibuja su escena al instante).
  const box = (await ana.page.locator("canvas").first().boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const before = await ana.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.local.telescope);
  await ana.page.mouse.move(cx, cy);
  await ana.page.mouse.down();
  await ana.page.mouse.move(cx - 60, cy + 40, { steps: 6 });
  await ana.page.mouse.up();
  const after = await ana.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.local.telescope);
  check(after.x > before.x && after.y < before.y, "arrastrar dentro del visor mueve el cielo con el dedo, como un mapa (a la izquierda y abajo: la vista va a la derecha y arriba)");

  // Beto llega a la casa con las flechas.
  await steer(beto.page, "DDDRRRR+DD");
  await readout(beto.page).getByText("Ventana iluminada; dos siluetas gesticulan como si discutieran.").waitFor({ state: "attached" });
  check(!/siluetas|Ventana iluminada/.test(await seen(beto.page)), "tampoco describe la casa a la vista");
  await shot(beto.page, "14-observatorio-siluetas-telefono.png");
  await waitVisual(beto.page, `v.viewer.me.activities.cajas.curtain === "closed"`);
  await readout(beto.page).getByText("Una persona cierra la cortina.").waitFor({ state: "attached" });
  check((await scope(ana.page)).curtain === "open", "la ventana de cerca hace que una silueta cierre la cortina para Beto, y solo para él");
  check((await scope(beto.page)).observed.length === 0 && (await beto.page.getByText("✓ Listo para conversar").count()) === 0, "mirar la casa no suma ni resta nada");
  await sleep(2200); // la animación de la cortina termina
  await shot(beto.page, "15-observatorio-cortina-telefono.png");
  await steer(beto.page, "-+DD"); // se aleja y vuelve
  await readout(beto.page).getByText("La ventana tiene la cortina cerrada.").waitFor({ state: "attached" });
  check((await scope(beto.page)).curtain === "closed", "al alejarse y volver, la cortina sigue cerrada: no se repite");
  await steer(beto.page, "-LLLLLLUUU+");
  await beto.page.getByText("✓ Luna observada").waitFor();
  await steer(beto.page, "-RRRRRRRRR");
  await beto.page.getByText("✓ Listo para conversar").waitFor();
  // Más allá de las estrellas, Beto encuentra la galaxia: un hallazgo que nadie le pidió.
  await steer(beto.page, "RRR+RRRUUU");
  await beto.page.getByText("✓ Galaxia observada").waitFor();
  check((await scope(beto.page)).observed.includes("galaxy"), "explorando más allá de las estrellas, Beto encuentra la galaxia y queda registrada como hallazgo");
  await shot(beto.page, "16-observatorio-galaxia-telefono.png");
  await admin.page.getByText("2 de 2").first().waitFor();
  await admin.page.getByText("✓ Todas las personas están listas").waitFor();
  check(!/casa|ventana|cortina/i.test((await admin.page.locator("ul.participants").textContent()) ?? ""), "la consola avisa que todas están listas y no identifica quién miró la casa");

  // Conversación: «Mostrar la frase de Freire» proyecta a la vez la frase y la casa (las siluetas discuten y una cierra la cortina).
  await admin.page.getByRole("button", { name: "Conversemos" }).click();
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).waitFor();
  check((await admin.page.getByRole("button", { name: /Mostrar la casa|Volver al laboratorio/ }).count()) === 0 && (await scenesAre(admin.page, "LaboratoryScene")), "antes de la frase la proyección sigue en el laboratorio y no hay botones para la casa");
  await admin.page.locator(".projection__question").getByText("¿Qué descubrieron en el cielo al acercar la vista?").waitFor();
  check((await admin.page.getByText(/cortina/).count()) === 0, "primero se pregunta qué descubrieron en el cielo: nada se adelanta a la casa");
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await admin.page.locator(".projection__freire").getByText(/no nos da derecho a invadir la privacidad/).waitFor();
  check(await scenesAre(admin.page, "TelescopeScene"), "con la frase de Freire la proyección muestra la casa con las siluetas discutiendo");
  await admin.page.locator(".projection__question").getByText(/¿Qué nos hizo entender el gesto de cerrar la cortina\?/).waitFor();
  check(true, "con la casa, la pregunta pasa a ser la de la cortina");
  await shot(admin.page, "17-observatorio-demostracion-siluetas.png");
  await sleep(3000 + 2200); // las siluetas, el giro y la cortina
  await shot(admin.page, "18-observatorio-demostracion-cortina.png");
  check((await scope(beto.page)).curtain === "closed" && (await scope(ana.page)).curtain === "open", "la demostración tiene su propio estado: no cambia la cortina de nadie");
  check((await admin.page.getByRole("button", { name: /Volver al laboratorio|Freire/ }).count()) === 0 && (await scenesAre(admin.page, "TelescopeScene")), "la casa se queda en la proyección (sin «Volver al laboratorio») y solo queda «Pasar al inventor»");
  await shot(admin.page, "19-observatorio-conversacion-proyeccion.png");
  await openPanel(admin.page, /Cuaderno del grupo/);
  await admin.page.getByLabel("Pregunta que el grupo quiere conservar").fill("¿Cómo podemos investigar respetando lo que otras personas quieren guardar?");
  await admin.page.getByRole("button", { name: "Guardar la pregunta" }).click();
  await admin.page.locator(".records .record__text", { hasText: "respetando lo que otras personas" }).waitFor();
  await admin.page.getByRole("button", { name: "Pasar al inventor" }).click();
  await waitVisual(admin.page, `v.group.pieces.length === 3 && v.group.round.stage === "closing"`);

  // ================= EL INVENTOR, COMO UNA MESA =================
  console.log("\nEl inventor");
  check((await scenesAre(admin.page, "LaboratoryScene")) && (await scenesAre(ana.page, "LaboratoryScene")) && (await scenesAre(beto.page, "LaboratoryScene")), "al pasar al inventor todas las pantallas siguen en el laboratorio: hay que caminar hasta la máquina");
  await ana.page.getByText(project.config.ui.labels.closingPhone!).first().waitFor();
  await admin.page.getByText(config_prompt()).first().waitFor();
  check((await admin.page.getByText(/Preguntas del inventor/).count()) === 0, "las preguntas del inventor no aparecen en la consola hasta que Vanessa lo abre");
  // Ana camina hasta la máquina; tocarla antes de que Vanessa la abra solo explica que falta abrirla.
  // El punto de interacción queda en el borde de la máquina: se camina hasta justo encima de su dibujo (tocar el dibujo es «abrir»).
  const top = await ana.page.evaluate(() => (window as any).__PHASER_GAME__.scene.getScene("LaboratoryScene").built.inventor.image.getBounds().top as number);
  const inv = project.map.inventor!;
  await walkTo(ana.page, { x: inv.point.x, y: Math.min(inv.point.y, top) - 18 });
  await tapInventor(ana.page);
  await ana.page.getByText("Vanessa abrirá el inventor en un momento.").first().waitFor();
  check((await visual(ana.page)).viewer.me.view.kind === "map", "con el inventor cerrado, tocar la máquina lo explica y no entra");
  await shot(admin.page, "20-inventor-proyeccion.png");
  await shot(ana.page, "21-inventor-telefono.png");
  await admin.page.getByRole("button", { name: "Abrir inventor" }).click();
  await waitVisual(admin.page, `v.group.inventor.open === true`);
  check(await scenesAre(admin.page, "InventorScene"), "al abrir el inventor, la proyección muestra la máquina con sus tres piezas");
  await ana.page.getByText(project.config.ui.labels.inventorOpenPhone!).first().waitFor();
  await tapInventor(ana.page); // ya está junto a la máquina: tocarla la abre (el servidor valida la cercanía)
  await ana.page.getByRole("heading", { name: "El inventor de preguntas" }).waitFor();
  await beto.page.getByText("Mesas", { exact: true }).click();
  await beto.page.getByRole("button", { name: "Ir al inventor" }).click();
  await beto.page.getByRole("heading", { name: "El inventor de preguntas" }).waitFor();
  check((await scenesAre(ana.page, "InventorScene")) && (await scenesAre(beto.page, "InventorScene")), "cada persona entra al inventor y lo ve en su celular");
  check((await ana.page.getByRole("button", { name: "Volver al mapa" }).count()) === 0, "como en las mesas, no se vuelve al mapa antes de registrar la pregunta");
  const sugerida = project.config.inventor.questions.find((q) => q.id === "cajas-distancias")!;
  for (const titulo of ["Sombras", "Rampas", "El observatorio"]) await ana.page.getByRole("group", { name: titulo }).waitFor();
  await shot(ana.page, "22-inventor-preguntas-telefono.png");
  await ana.page.getByRole("radio", { name: sugerida.text }).check();
  await ana.page.getByRole("button", { name: "Registrar mi pregunta" }).click();
  await ana.page.getByText("✓ Tu pregunta quedó registrada").waitFor();
  await beto.page.getByRole("radio", { name: "Quiero escribir mi pregunta" }).check();
  await beto.page.getByLabel("Tu pregunta").fill("¿Por qué la Luna cambia de forma?");
  await beto.page.getByRole("button", { name: "Registrar mi pregunta" }).click();
  await beto.page.getByText("✓ Tu pregunta quedó registrada").waitFor();
  check((await beto.page.getByRole("button", { name: "Volver al mapa" }).count()) === 1, "con la pregunta registrada ya puede volver al mapa");
  check(!JSON.stringify(await visual(ana.page)).includes("Luna cambia de forma"), "la pregunta de Beto nunca llega al celular de Ana");

  // Vanessa ve las preguntas en su pantalla y elige la del grupo.
  console.log("\nCierre");
  await admin.page.getByText("Preguntas del inventor (2 de 2)").waitFor();
  check((await admin.page.locator("details.panel", { has: admin.page.getByText(/Preguntas del inventor/) }).getAttribute("open")) === null, "el panel «Preguntas del inventor» aparece cerrado: Vanessa lo abre cuando quiere");
  await openPanel(admin.page, /Preguntas del inventor/);
  const opcion = (texto: string | RegExp) => admin.page.locator("label.question-option", { hasText: texto });
  check((await opcion("¿Por qué la Luna cambia de forma?").innerText()).includes("Beto") && (await opcion(sugerida.text).innerText()).includes("Elegida por 1: Ana"), "Vanessa ve la pregunta que escribió Beto con su nombre y la sugerida que eligió Ana");
  check((await admin.page.locator("ul.participants").getByText("✓ Registró su pregunta").count()) === 2, "la lista de participantes dice quién ya registró su pregunta");
  await admin.page.getByRole("group", { name: "Escritas por las personas" }).scrollIntoViewIfNeeded();
  await shot(admin.page, "23-preguntas-del-inventor-vanessa.png");
  await opcion("¿Por qué la Luna cambia de forma?").locator("input").check();
  await admin.page.getByRole("button", { name: "Revisar y confirmar" }).click();
  await admin.page.getByRole("alertdialog").getByText("¿Por qué la Luna cambia de forma?").waitFor();
  check((await visual(admin.page)).group.inventor.finalQuestionId === undefined, "antes de confirmar, la pregunta no está impresa en el inventor");
  await shot(admin.page, "24-pregunta-final-confirmar.png");
  await admin.page.getByRole("button", { name: "Sí, imprimirla en el inventor" }).click();
  await waitVisual(admin.page, `v.phase === "finished" && !!v.group.inventor.finalQuestionId`);
  await admin.page.locator(".projection__question").getByText("¿Por qué la Luna cambia de forma?").waitFor();
  await ana.page.getByText("Terminamos la aventura. Puedes revisar tus resultados.").first().waitFor();
  await beto.page.getByText("Terminamos la aventura. Puedes revisar tus resultados.").first().waitFor();
  check((await scenesAre(ana.page, "InventorScene")) && (await scenesAre(beto.page, "InventorScene")), "al confirmar, la pregunta se imprime en la proyección, todas las pantallas ven el inventor y los teléfonos dicen que terminamos");
  await admin.page.getByText(project.config.inventor.closingQuestion).waitFor();
  check(true, "la proyección deja la reflexión y la invitación para seguir pensando");
  await shot(admin.page, "25-final-proyeccion.png");
  await admin.page.getByRole("button", { name: "Corregir un error de escritura" }).click();
  await admin.page.getByLabel("Corregir la pregunta final").fill("¿Por qué la Luna cambia de forma cada noche?");
  await admin.page.getByRole("button", { name: "Guardar la corrección" }).click();
  await waitVisual(admin.page, `v.group.notebook.find((n) => n.id === v.group.inventor.finalQuestionId).revision === 2`);
  check(true, "un error de escritura de la pregunta final se corrige y la versión anterior se conserva");

  // El cuaderno del celular: mis resultados + lo que anotó el grupo (solo lectura).
  await ana.page.getByText("Cuaderno", { exact: true }).click();
  await ana.page.getByText("Mis resultados").waitFor();
  check((await ana.page.locator(".notebook").getByText("Probaste la linterna en 2 posiciones distintas.").count()) === 1 && (await ana.page.locator(".notebook").getByText("Idea inicial del grupo").count()) === 1 && (await ana.page.locator(".notebook textarea").count()) === 0, "el cuaderno de Ana tiene sus resultados y las notas del grupo, sin ningún formulario");
  await shot(ana.page, "26-cuaderno-telefono.png");

  // Recarga de Vanessa: recupera la conducción con la sala pausada y todo lo anterior intacto.
  await admin.page.reload();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  check((await admin.page.getByRole("button", { name: "Reanudar" }).count()) === 1, "al recargar, Vanessa recupera la sala pausada con la aventura terminada");
  check(problems.length === 0, `sin errores de consola ni de página en los tres contextos${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de rondas con participación simultánea: OK");

} finally {
  console.log(`capturas en ${EVIDENCE}`);
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
