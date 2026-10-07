/// <reference lib="dom" />
// Rondas con participación simultánea a través de la interfaz real: proyección de Vanessa + dos teléfonos que juegan + una persona que
// observa, en contextos de navegador independientes, contra el build servido por el servidor real (`npm run build` antes).
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
    return ["LaboratoryScene", "ShadowsScene", "RampsScene", "BoxesScene", "InventorScene"].filter((k) => g.scene.isActive(k));
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
const canvases = (page: Page) => page.locator("canvas").count();
const config_prompt = () => project.config.inventor.prompt;
/** Abre un panel plegable de Vanessa sin importar si ya estaba abierto. */
const openPanel = (page: Page, title: RegExp) => page.locator("details.panel", { has: page.locator("summary", { hasText: title }) }).evaluate((el) => ((el as HTMLDetailsElement).open = true));

try {
  // ---- sala con proyección, dos teléfonos que juegan y una persona que observa ----
  const admin = await open("admin", { width: 1280, height: 720 }, "/");
  await admin.page.getByRole("button", { name: "Crear sala" }).click();
  await admin.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const code = admin.page.url().split("/").pop()!;
  await admin.page.goto(`${BASE}/sala/${code}?hooks`);
  await admin.page.getByText("Entra con tu celular").waitFor();
  const phone = { width: 390, height: 844 };
  const join = async (name: string, observer = false) => {
    const p = await open(name.toLowerCase(), phone, `/sala/${code}?hooks`);
    await p.page.getByLabel("Tu nombre").fill(name);
    if (observer) await p.page.getByLabel(/Solo quiero acompañar/).check();
    await p.page.getByRole("button", { name: observer ? "Entrar como observadora" : "Entrar a la sala" }).click();
    return p;
  };
  const ana = await join("Ana");
  const beto = await join("Beto");
  const vero = await join("Vero", true);
  await vero.page.getByText("Estás como observador").waitFor();
  check((await canvases(vero.page)) === 0, "quien observa no monta el mapa ni tiene personaje");
  await admin.page.locator(".participant").nth(2).waitFor();
  await shot(admin.page, "01-bienvenida-vanessa.png");
  check((await admin.page.getByText(/2 personas conectadas · 1 observa/).count()) === 1, "Vanessa ve 2 personas conectadas y 1 que observa");
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
  check(JSON.stringify(await nombres(admin.page)) === JSON.stringify(["Ana", "Beto"]), "la proyección rotula a cada jugador sobre su avatar (sin tocar nada): Ana y Beto; quien observa no tiene avatar");
  check(JSON.stringify(await nombres(ana.page)) === JSON.stringify(["Ana (tú)", "Beto"]), "en el celular de Ana se ve «Ana (tú)» y «Beto» sobre sus avatares");
  check(JSON.stringify(await nombres(beto.page)) === JSON.stringify(["Ana", "Beto (tú)"]), "y en el de Beto, «Beto (tú)» y «Ana»: cada jugador ve los nombres de los demás");
  await shot(ana.page, "02-telefono-preparacion.png");
  await shot(admin.page, "03-proyeccion-pregunta-sombras.png");

  // ================= SOMBRAS =================
  console.log("\nSombras");
  check((await ana.page.getByText("Mesas", { exact: true }).count()) === 1, "el celular de quien juega tiene el mapa y la barra «Mesas · piezas · Cuaderno»");
  await admin.page.getByRole("button", { name: "Abrir mesa: Sombras" }).click();
  await admin.page.getByText("0 de 2 listos").first().waitFor();
  check(true, "al abrir la mesa, el contador cuenta solo a quienes juegan: «0 de 2 listos» (Vero observa)");
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
  await slider.fill("30"); // el slider crece hacia «más cerca»: 10 + 60 − 30 = 40 cm
  await waitVisual(ana.page, `v.viewer.me.activities.sombras.samples.length === 1`);
  check((await ana.page.locator(".results li").count()) === 1, "al terminar el ajuste, la posición queda registrada con su sombra, sin pulsar nada");
  await slider.fill("45"); // 25 cm
  await waitVisual(ana.page, `v.viewer.me.activities.sombras.samples.length === 2`);
  await ana.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("1 de 2").first().waitFor();
  check(true, "con dos posiciones separadas Ana queda «Lista para conversar» y el contador de Vanessa dice «1 de 2»");
  check((await beto.page.getByText("Explorando · 0 de 2").count()) === 1, "Beto sigue explorando: su avance es independiente del de Ana");
  await shot(ana.page, "06-sombras-lista-telefono.png");

  // Conversemos con una persona pendiente: pide confirmación y deja claro que es excepcional.
  await admin.page.getByRole("button", { name: "Conversemos" }).click();
  await admin.page.getByRole("alertdialog").getByText(/Faltan 1 persona por terminar: Beto/).waitFor();
  check(true, "«Conversemos» con alguien pendiente abre «Pasar a conversación con pendientes» y nombra a Beto");
  await shot(admin.page, "07-conversemos-con-pendientes.png");
  await admin.page.getByRole("button", { name: "Pasar a conversación con pendientes" }).last().click();
  await ana.page.getByText("Miremos la proyección y compartamos lo que descubrimos.").first().waitFor();
  await beto.page.getByText("Miremos la proyección y compartamos lo que descubrimos.").first().waitFor();
  await vero.page.getByText("Miremos la proyección y compartamos lo que descubrimos.").first().waitFor();
  check((await ana.page.getByRole("slider").count()) === 0 && (await beto.page.getByRole("slider").count()) === 0, "en la conversación los teléfonos dejan de ofrecer controles y mandan a mirar la proyección");
  await admin.page.locator(".projection__question").getByText(/¿Qué cambió, qué permaneció igual/).waitFor();
  check((await admin.page.locator(".projection__freire").count()) === 0, "la frase de Freire todavía no se proyecta: Vanessa decide cuándo");

  // Vanessa proyecta los resultados de Ana, muestra la frase de Freire y guarda lo que el grupo piensa.
  await admin.page.getByRole("button", { name: "Proyectar resultados de Ana" }).click();
  await admin.page.locator(".comparison").waitFor();
  check((await admin.page.locator(".comparison__rows li").count()) === 2 && (await admin.page.locator(".comparison figcaption").innerText()).includes("Ana"), "la proyección muestra las dos posiciones y sombras de Ana, con su nombre");
  check((await admin.page.locator(".comparison__rows").innerText()).includes("Linterna a 40 cm") && (await admin.page.locator(".comparison__bar[aria-hidden=true]").count()) === 2, "los resultados están escritos (las barras son solo decoración para lectores de pantalla)");
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await admin.page.locator(".projection__freire").getByText("Freire propone volver más rigurosa nuestra curiosidad al observar, comparar y buscar razones.").waitFor();
  check(true, "«Mostrar la frase de Freire» proyecta la frase de Sombras (y el botón queda como «mostrada»)");
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
  check(notes.some((n: any) => n.kind === "initialIdea" && n.text === "La luz estira la sombra") && notes.some((n: any) => n.kind === "synthesis") && notes.some((n: any) => n.kind === "comparison"), "el cuaderno del grupo guarda aparte la idea inicial, la síntesis («Idea del grupo») y la comparación seleccionada");
  await ana.page.getByText("Cuaderno", { exact: true }).click().catch(() => undefined);

  // Abrir siguiente mesa: la pieza se incorpora ahora y todos vuelven al mapa.
  check((await visual(admin.page)).group.pieces.length === 0, "mientras se conversa, la pieza todavía no está en el inventor");
  await admin.page.getByRole("button", { name: "Abrir siguiente mesa: Rampas" }).click();
  await waitVisual(admin.page, `v.group.pieces.includes("lupa") && v.group.round.index === 1`);
  await admin.page.getByText("Mesa 2 de 3: Rampas").waitFor();
  check(true, "«Abrir siguiente mesa» incorpora la pieza Lupa y pasa a la preparación de Rampas");
  check((await scenesAre(ana.page, "LaboratoryScene")) && (await scenesAre(beto.page, "LaboratoryScene")), "todas las personas vuelven al laboratorio para recibir la siguiente mesa");
  await admin.page.locator(".projection__question").getByText(/¿Qué creen que pasa con la pelota/).first().waitFor().catch(() => undefined);
  await shot(admin.page, "09-rampas-pregunta-proyeccion.png");
  await shot(ana.page, "10-telefono-rampas-preparacion.png");

  // ================= RAMPAS =================
  console.log("\nRampas");
  await ana.page.getByText("Mesas", { exact: true }).click();
  check(await ana.page.getByRole("button", { name: "Ir a la mesa actual" }).isDisabled(), "en la preparación nadie puede abrir la mesa todavía: «Ir a la mesa actual» está desactivado");
  await ana.page.getByText("Mesas", { exact: true }).click();
  await admin.page.getByRole("button", { name: "Abrir mesa: Rampas" }).click();
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
  await angle(ana.page).fill("0"); // 15°
  await angle(beto.page).fill("1"); // 20°
  await release(ana.page).click();
  await release(beto.page).click();
  await waitVisual(ana.page, `v.viewer.me.activities.rampas.trials.length === 1`);
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials.length === 1`);
  check(await angle(ana.page).isDisabled() && await ana.page.getByRole("button", { name: "La pelota está rodando…" }).isDisabled(), "con la pelota rodando no se puede cambiar la inclinación ni soltar otra");
  await shot(ana.page, "11-rampas-pelota-rodando.png");
  await waitVisual(ana.page, `v.viewer.me.activities.rampas.trials[0].state === "finished"`, 12000);
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials[0].state === "finished"`, 12000);
  check(true, "las dos pruebas terminaron solas y se registraron sin pulsar nada («Anotar» no existe)");
  await angle(ana.page).fill("6"); // 45°
  await release(ana.page).click();
  await waitVisual(ana.page, `v.viewer.me.activities.rampas.trials.length === 2 && v.viewer.me.activities.rampas.trials[1].state === "finished"`, 12000);
  await ana.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("1 de 2").first().waitFor();
  check((await ana.page.locator("table.trials tbody tr").count()) === 2, "Ana queda lista con dos pruebas separadas 30° y su tabla muestra ambas");
  // Beto suelta una segunda prueba muy parecida a la primera: terminada, pero sin 5° de diferencia no basta.
  await angle(beto.page).fill("2"); // 25°, difiere 5° de 20°: sí cuenta
  await release(beto.page).click();
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials.length === 2 && v.viewer.me.activities.rampas.trials[1].state === "finished"`, 12000);
  await beto.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("2 de 2").first().waitFor();
  check(true, "Beto queda listo con 20° y 25° (5° de diferencia) y el contador dice «2 de 2»");
  // Una prueba en marcha se cancela al reunir al grupo.
  await angle(beto.page).fill("6");
  await release(beto.page).click();
  await waitVisual(beto.page, `v.viewer.me.activities.rampas.trials.length === 3`);
  await admin.page.getByRole("button", { name: "Conversemos" }).click();
  await beto.page.getByText("Miremos la proyección y compartamos lo que descubrimos.").first().waitFor();
  const betoTrials = (await visual(beto.page)).viewer.me.activities.rampas.trials;
  check(betoTrials[2].state === "cancelled" && betoTrials.filter((t: any) => t.state === "finished").length === 2, "con todas listas «Conversemos» no pide confirmación y cancela la prueba que seguía rodando (no cuenta como terminada)");
  await admin.page.getByRole("button", { name: "Proyectar resultados de Beto" }).click();
  await admin.page.locator(".comparison").getByText(/20° → |Inclinación de 20°/).first().waitFor().catch(() => undefined);
  await admin.page.locator(".comparison__rows li").first().waitFor();
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await admin.page.locator(".projection__freire").getByText(/Para Freire, dialogar incluye preguntar y escuchar/).waitFor();
  check(true, "se proyectan los resultados de Beto y la frase de Freire de Rampas");
  await shot(admin.page, "12-rampas-conversacion-proyeccion.png");
  await admin.page.getByRole("button", { name: "Abrir siguiente mesa: La caja de las sorpresas" }).click();
  await waitVisual(admin.page, `v.group.pieces.includes("dialogo") && v.group.round.index === 2`);
  check(true, "al abrir la siguiente mesa se incorpora la pieza Bocadillo");

  // ================= LA CAJA DE LAS SORPRESAS =================
  console.log("\nLa caja de las sorpresas");
  await admin.page.getByRole("button", { name: "Abrir mesa: La caja de las sorpresas" }).click();
  await goTable(ana.page, "La caja de las sorpresas");
  await goTable(beto.page, "La caja de las sorpresas");
  check((await scenesAre(ana.page, "BoxesScene")) && (await scenesAre(beto.page, "BoxesScene")), "una sola escena de La caja para todas las personas");
  check((await ana.page.getByRole("button", { name: /Abrir la caja personal|Abrir/ }).count()) === 0, "no existe ninguna acción para abrir la caja personal");
  await ana.page.getByRole("button", { name: "Campanita" }).click();
  await ana.page.getByText("✓ Listo para conversar").waitFor();
  check(true, "explorar un objeto compartido basta para quedar lista; pedir permiso es opcional");
  await ana.page.getByRole("button", { name: "Pedir permiso para abrir la caja personal" }).click();
  await ana.page.getByText("Prefiero guardar esas cosas para mí").waitFor();
  check(true, "quien pide permiso recibe la negativa completa: «Prefiero guardar esas cosas para mí»");
  check((await ana.page.getByText("La caja personal sigue cerrada").count()) === 1, "la caja personal sigue cerrada y se dice con texto");
  await shot(ana.page, "13-caja-negativa-telefono.png");
  await beto.page.getByRole("button", { name: "Lupa" }).click();
  await beto.page.getByText("✓ Listo para conversar").waitFor();
  await admin.page.getByText("2 de 2").first().waitFor();
  await admin.page.getByRole("button", { name: "Conversemos" }).click();
  await admin.page.getByRole("button", { name: "Proyectar resultados de Ana" }).click();
  await admin.page.locator(".comparison").getByText(/Pidió permiso para la caja personal/).waitFor();
  await admin.page.getByRole("button", { name: "Mostrar la frase de Freire" }).click();
  await admin.page.locator(".projection__freire").getByText(/curiosidad debe respetar la privacidad/).waitFor();
  check(true, "la proyección muestra qué exploró Ana, que pidió permiso y la frase de Freire sobre la privacidad");
  await shot(admin.page, "14-caja-conversacion-proyeccion.png");
  await openPanel(admin.page, /Cuaderno del grupo/);
  await admin.page.getByLabel("Pregunta que el grupo quiere conservar").fill("¿Cómo podemos investigar respetando lo que otras personas quieren guardar?");
  await admin.page.getByRole("button", { name: "Guardar la pregunta" }).click();
  await admin.page.locator(".records .record__text", { hasText: "respetando lo que otras personas" }).waitFor();
  await admin.page.getByRole("button", { name: "Pasar al inventor" }).click();
  await waitVisual(admin.page, `v.group.pieces.length === 3 && v.group.round.stage === "closing"`);
  check((await scenesAre(admin.page, "InventorScene")) && (await scenesAre(ana.page, "InventorScene")) && (await scenesAre(beto.page, "InventorScene")), "en el cierre todas las pantallas ven al inventor con sus tres piezas");
  await ana.page.getByText(/el inventor ya tiene sus tres piezas/).first().waitFor();
  await admin.page.getByText(config_prompt()).first().waitFor();
  await shot(admin.page, "15-inventor-proyeccion.png");
  await shot(ana.page, "16-inventor-telefono.png");


  // Pregunta final: Vanessa elige la pregunta que el grupo guardó y la confirma antes de imprimirla.
  console.log("\nCierre");
  await admin.page.getByText("Pregunta final", { exact: true }).waitFor();
  await admin.page.getByRole("button", { name: "Revisar y confirmar" }).click();
  await admin.page.getByRole("alertdialog").getByText(/respetando lo que otras personas/).waitFor();
  check((await visual(admin.page)).group.inventor.finalQuestionId === undefined, "antes de confirmar, la pregunta no está impresa en el inventor");
  await shot(admin.page, "17-pregunta-final-confirmar.png");
  await admin.page.getByRole("button", { name: "Sí, imprimirla en el inventor" }).click();
  await waitVisual(admin.page, `v.phase === "finished" && !!v.group.inventor.finalQuestionId`);
  await admin.page.locator(".projection__question").getByText(/respetando lo que otras personas/).waitFor();
  await ana.page.getByText("Terminamos la aventura. Puedes revisar tus resultados.").first().waitFor();
  await vero.page.getByText("Terminamos la aventura.", { exact: true }).first().waitFor();
  check(true, "al confirmar, la pregunta se imprime en la proyección y los teléfonos (también el de quien observa) dicen que terminamos");
  await shot(admin.page, "18-final-proyeccion.png");
  await admin.page.getByRole("button", { name: "Corregir un error de escritura" }).click();
  await admin.page.getByLabel("Corregir la pregunta final").fill("¿Cómo investigamos respetando lo que otras personas quieren guardar?");
  await admin.page.getByRole("button", { name: "Guardar la corrección" }).click();
  await waitVisual(admin.page, `v.group.notebook.find((n) => n.id === v.group.inventor.finalQuestionId).revision === 2`);
  check(true, "un error de escritura de la pregunta final se corrige y la versión anterior se conserva");

  // El cuaderno del celular: mis resultados + lo que anotó el grupo (solo lectura).
  await ana.page.getByText("Cuaderno", { exact: true }).click();
  await ana.page.getByText("Mis resultados").waitFor();
  check((await ana.page.locator(".notebook").getByText(/Posición 1: linterna a 40 cm/).count()) === 1 && (await ana.page.locator(".notebook").getByText("Idea inicial del grupo").count()) === 1 && (await ana.page.locator(".notebook textarea").count()) === 0, "el cuaderno de Ana tiene sus resultados y las notas del grupo, sin ningún formulario");
  await shot(ana.page, "19-cuaderno-telefono.png");

  // Recarga de Vanessa: recupera la conducción con la sala pausada y todo lo anterior intacto.
  await admin.page.reload();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  check((await admin.page.getByRole("button", { name: "Reanudar" }).count()) === 1, "al recargar, Vanessa recupera la sala pausada con la aventura terminada");
  check(problems.length === 0, `sin errores de consola ni de página en los cuatro contextos${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de rondas con participación simultánea: OK");

} finally {
  console.log(`capturas en ${EVIDENCE}`);
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
