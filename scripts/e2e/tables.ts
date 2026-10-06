/// <reference lib="dom" />
// Fase 4 (P4): las tres mesas a través de la interfaz real. Tres contextos de navegador independientes (proyección + dos teléfonos)
// contra el build servido por el servidor real (`npm run build` antes). Comprueba lo que las pruebas del dominio no pueden: que el
// teléfono muestre el formulario correcto, que la proyección solo lea, que los borradores no salgan del dispositivo y que el
// teclado no tape el botón de compartir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServerApp } from "../../server/src/app";
import { loadSettings } from "../../server/src/config";
import { loadProjectFromDisk } from "../../server/src/project";

const EVIDENCE = process.env.E2E_EVIDENCE ? resolve("docs/evidencia/fase4") : mkdtempSync(join(tmpdir(), "laboratorio-evidencia-"));
const dir = mkdtempSync(join(tmpdir(), "laboratorio-mesas-"));
const settings = loadSettings({}, { databasePath: join(dir, "t.sqlite"), port: 0, host: "127.0.0.1", distDir: resolve("dist") });
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

const opened: Record<string, Page> = {};
const wsPayloads: Record<string, string[]> = {};

async function open(name: string, viewport: { width: number; height: number }, path: string) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  opened[name] = page;
  wsPayloads[name] = [];
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console.error: ${m.text()}`));
  // Todo lo que llega a esta página por WebSocket: sirve para demostrar qué NO se transmitió (borradores).
  page.on("websocket", (ws) => ws.on("framereceived", (f) => typeof f.payload === "string" && wsPayloads[name]!.push(f.payload)));
  await page.goto(`${BASE}${path}`);
  return { ctx, page };
}

const adv = (page: Page) => page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.adventure);
const waitAdv = (page: Page, pred: string, timeout = 8000) =>
  page.waitForFunction(`(() => { const a = window.__PHASER_GAME__?.registry.get("deps").bridge.snapshot?.state.adventure; return !!a && (${pred}); })()`, undefined, { timeout });
const activeScenes = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const g = (window as any).__PHASER_GAME__;
    return ["LaboratoryScene", "ShadowsScene", "RampsScene", "BoxesScene", "InventorScene"].filter((k) => g.scene.isActive(k));
  });
/** Espera a que las escenas activas sean exactamente estas (cambiar de escena es asíncrono: stop/start al siguiente fotograma). */
const scenesAre = async (page: Page, ...keys: string[]) => {
  const deadline = Date.now() + 6000;
  let now: string[] = [];
  while (Date.now() < deadline) {
    now = await activeScenes(page);
    if (now.join() === keys.join()) return true;
    await sleep(100);
  }
  const status = await page.evaluate(() => (window as any).__PHASER_GAME__.scene.scenes.map((sc: any) => `${sc.sys.settings.key}:${sc.sys.settings.status}`).join(" "));
  console.log(`    (escenas activas: ${now.join() || "ninguna"}; se esperaba ${keys.join()}; estados: ${status})`);
  return false;
};
const sceneTexts = (page: Page, key: string): Promise<string[]> =>
  page.evaluate((k) => {
    const s = (window as any).__PHASER_GAME__.scene.getScene(k);
    return s.children.list.filter((c: any) => c.type === "Text" && c.visible).map((c: any) => c.text as string);
  }, key);
/** Reintenta una condición asíncrona hasta que se cumple (la interfaz de cada teléfono se actualiza un instante después del snapshot). */
const until = async (cond: () => Promise<boolean>, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await sleep(80);
  }
  return false;
};
const canvases = (page: Page) => page.locator("canvas").count();

try {
  // ---- sala con proyección y dos teléfonos ----
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
    await p.page.getByRole("button", { name: "Entrar a la sala" }).click();
    await p.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
    return p;
  };
  const ana = await join("Ana");
  const beto = await join("Beto");
  await admin.page.locator(".participant").nth(1).waitFor();
  await admin.page.getByRole("button", { name: "Dar el turno a Ana", exact: true }).click();
  await admin.page.getByRole("button", { name: "Comenzar con Ana" }).click();
  await ana.page.getByText("Es tu turno, Ana").waitFor();
  await ana.page.locator("canvas").waitFor();
  await admin.page.locator("canvas").waitFor();
  await waitAdv(ana.page, "true");
  await waitAdv(admin.page, "true");
  await admin.page.getByText(/Participantes \(/).click(); // el panel queda abierto: cambiar de turno es un clic

  const turnTo = async (who: "Ana" | "Beto") => {
    const p = who === "Ana" ? ana.page : beto.page;
    await admin.page.getByRole("button", { name: `Dar el turno a ${who}` }).click();
    await p.getByText(`Es tu turno, ${who}`).waitFor();
    await p.locator("canvas").waitFor();
    await waitAdv(p, "true");
  };
  const openStation = async (page: Page, title: string) => {
    await page.getByText("Mesas", { exact: true }).click();
    await page.getByRole("button", { name: title, exact: true }).click();
    await page.getByRole("heading", { name: title }).waitFor();
  };
  const share = async (page: Page, text: string) => {
    await page.getByLabel("Tu respuesta").fill(text);
    await page.getByRole("button", { name: "Compartir con el grupo" }).click();
  };

  // ================= SOMBRAS =================
  console.log("\nSombras");
  await openStation(ana.page, "Sombras");
  await admin.page.getByRole("heading", { name: "Sombras" }).waitFor();
  await waitAdv(admin.page, `a.view.kind === "activity"`);
  await sleep(600);
  check((await scenesAre(ana.page, "ShadowsScene")) && (await scenesAre(admin.page, "ShadowsScene")), "al abrir la mesa, teléfono y proyección cambian a la escena de Sombras dentro del mismo juego (y el laboratorio se detiene)");
  check((await canvases(ana.page)) === 1 && (await canvases(admin.page)) === 1, "sigue habiendo un solo canvas en cada vista");
  await ana.page.getByText("Esta idea se compartirá con el grupo").waitFor();
  check(true, "antes del primer formulario se avisa: «Esta idea se compartirá con el grupo»");
  await ana.page.getByText("Paso 1 de 4").waitFor();
  check(true, "el teléfono muestra «Paso 1 de 4»");
  check((await admin.page.locator(".adventure__activity textarea, .adventure__activity input").count()) === 0 && (await admin.page.locator(".adventure__activity button").count()) === 0, "la proyección solo lee: ni campos ni botones en la mesa");
  await shot(ana.page, "01-sombras-primera-idea-telefono.png");
  await shot(admin.page, "02-sombras-primera-idea-proyeccion.png");

  // Borrador local: no sale del teléfono.
  const DRAFT = "Creo que la luz estira la sombra";
  await ana.page.getByLabel("Tu respuesta").fill(DRAFT);
  await sleep(700);
  check(!(await admin.page.content()).includes(DRAFT) && !wsPayloads.admin!.some((p) => p.includes("estira")) && !wsPayloads.beto!.some((p) => p.includes("estira")), "el borrador NO aparece en la proyección ni viaja por la red a nadie más (CA-20)");

  // Cambio de turno con texto sin compartir.
  await turnTo("Beto");
  await ana.page.getByText(/Quedó un texto sin compartir en tu borrador/).first().waitFor();
  check(true, "al perder el turno con un borrador sin compartir, Ana recibe el aviso");
  check((await beto.page.getByLabel("Tu respuesta").inputValue()) === "", "Beto recibe la mesa con el formulario vacío: el borrador de Ana no se transfiere");
  check(await scenesAre(beto.page, "ShadowsScene"), "Beto abre directamente en la escena de la mesa en curso (no pasa por el mapa)");
  await turnTo("Ana");
  check((await ana.page.getByLabel("Tu respuesta").inputValue()) === DRAFT, "al recuperar el turno, el borrador de Ana sigue en SU teléfono");

  // Teclado del móvil: la ventana se reduce y el campo y el botón siguen al alcance.
  await ana.page.setViewportSize({ width: 390, height: 430 });
  await ana.page.getByLabel("Tu respuesta").focus();
  await sleep(900);
  // «A la vista» no basta: tiene que estar dentro de la ventana Y no tapado por otro elemento (el escenario, un aviso…).
  const inView = async (page: Page, loc: ReturnType<Page["locator"]>) => {
    const b = (await loc.boundingBox())!;
    const vp = page.viewportSize()!;
    if (!(b.y >= 0 && b.y + b.height <= vp.height + 1)) {
      console.log(`    (fuera de la ventana: y=${Math.round(b.y)} alto=${Math.round(b.height)} ventana=${vp.height})`);
      return false;
    }
    const covered = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top === el || el.contains(top) ? null : `${top?.tagName}.${top?.className}`;
    });
    if (covered) console.log(`    (tapado por ${covered})`);
    return covered === null;
  };
  check(await inView(ana.page, ana.page.getByLabel("Tu respuesta")), "con la ventana reducida por el teclado (390×430), el campo enfocado queda a la vista y sin nada encima");
  await ana.page.getByRole("button", { name: "Compartir con el grupo" }).focus();
  await sleep(900);
  check(await inView(ana.page, ana.page.getByRole("button", { name: "Compartir con el grupo" })), "y el botón «Compartir con el grupo» también, sin nada encima");
  check((await ana.page.evaluate(() => window.scrollY)) === 0 && (await ana.page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight)), "y la página no se desplaza: el aviso «Es tu turno» sigue en su sitio (nada del panel desborda la ventana)");
  await shot(ana.page, "03-sombras-teclado-abierto.png");
  // Teléfono girado: escenario a la izquierda y controles a la derecha, ambos a la vista y sin recrear el canvas.
  await ana.page.setViewportSize({ width: 844, height: 390 });
  await sleep(600);
  const stageBox = (await ana.page.locator("canvas").boundingBox())!;
  const panelBox = (await ana.page.locator(".adventure__activity").boundingBox())!;
  check(stageBox.width > 380 && panelBox.x >= stageBox.x + stageBox.width - 2 && (await canvases(ana.page)) === 1, `en horizontal (844×390) el escenario (${Math.round(stageBox.width)} px) queda a la izquierda y los controles a la derecha, con un solo canvas`);
  await shot(ana.page, "03b-sombras-telefono-horizontal.png");
  await ana.page.setViewportSize(phone);
  await sleep(300);

  await ana.page.getByRole("button", { name: "Compartir con el grupo" }).click();
  await admin.page.locator(".adventure__activity .record--first").waitFor();
  check((await admin.page.locator(".adventure__activity .record--first").innerText()).includes(DRAFT) && (await admin.page.locator(".adventure__activity .record--first").innerText()).includes("Ana"), "al compartir, la proyección muestra la primera idea con su autora");
  await ana.page.getByText("Paso 2 de 4").waitFor();
  check(true, "y avanza a «Paso 2 de 4»");
  check((await ana.page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("borrador") && localStorage.getItem(k)))).length === 0, "el borrador se borra del teléfono una vez compartido");
  await shot(admin.page, "04-sombras-explorar-proyeccion.png");

  // ---- explorar: la linterna se mueve en el teléfono y la proyección la ve igual ----
  const slider = ana.page.getByRole("slider", { name: "Distancia de la linterna al objeto" });
  await slider.waitFor();
  const has = async (page: Page, key: string, text: string) => (await sceneTexts(page, key)).some((t) => t.includes(text));
  check((await has(ana.page, "ShadowsScene", "d = 10 cm")) && (await has(admin.page, "ShadowsScene", "d = 10 cm")), "la linterna empieza cerca (d = 10 cm), con la sombra más grande, en teléfono y proyección");
  await slider.fill("40"); // el slider crece hacia «más cerca»: 10 + 60 − 40 = 30 cm
  await waitAdv(admin.page, `a.activities.sombras.distanceCm === 30`);
  await sleep(300);
  check((await has(ana.page, "ShadowsScene", "d = 30 cm")) && (await has(admin.page, "ShadowsScene", "d = 30 cm")), "al mover el slider a 30 cm, la proyección dibuja la misma posición");
  const sombraAna = (await sceneTexts(ana.page, "ShadowsScene")).find((t) => t.startsWith("sombra:"));
  const sombraAdmin = (await sceneTexts(admin.page, "ShadowsScene")).find((t) => t.startsWith("sombra:"));
  check(sombraAna === sombraAdmin && sombraAna !== undefined, `y la medida de la sombra coincide en ambas (${sombraAna})`);
  await shot(ana.page, "05-sombras-explorar-telefono.png");
  await shot(admin.page, "06-sombras-explorar-proyeccion.png");
  await ana.page.getByRole("button", { name: "Anotar esta posición" }).click();
  await waitAdv(admin.page, `a.activities.sombras.samples.length === 1`);

  // Reiniciar el experimento repone la linterna, pero no borra la primera idea ni las posiciones ya anotadas.
  await ana.page.getByRole("button", { name: "Reiniciar experimento" }).click();
  await waitAdv(admin.page, `a.activities.sombras.distanceCm === 10`);
  const afterReset = await adv(admin.page);
  check(afterReset.activities.sombras.samples.length === 1 && afterReset.notebook.length === 1 && afterReset.activities.sombras.step === "explore", "«Reiniciar experimento» repone la linterna sin borrar la primera idea ni la posición anotada");

  // Pausa en pleno experimento: los controles se retiran y nada del experimento cambia.
  await admin.page.getByRole("button", { name: "Pausar" }).click();
  await ana.page.getByRole("heading", { name: "En pausa" }).waitFor();
  check((await ana.page.getByRole("slider").count()) === 0, "en pausa, el teléfono no ofrece controles del experimento");
  await admin.page.getByRole("button", { name: "Reanudar" }).click();
  await ana.page.getByRole("heading", { name: "En pausa" }).waitFor({ state: "detached" });
  await slider.waitFor();
  await slider.fill("20"); // 50 cm
  await waitAdv(admin.page, `a.activities.sombras.distanceCm === 50`);
  await ana.page.getByRole("button", { name: "Anotar esta posición" }).click();
  await waitAdv(admin.page, `a.activities.sombras.step === "observation"`);
  await ana.page.getByText("Paso 3 de 4").waitFor();
  check(true, "con dos posiciones distintas anotadas pasa a «Paso 3 de 4»");
  await share(ana.page, "Cuando acerco la linterna la sombra se hace más grande");
  await waitAdv(admin.page, `a.activities.sombras.step === "nextQuestion"`);
  await ana.page.getByRole("radio", { name: "Elegir una pregunta" }).check();
  await ana.page.getByRole("radio", { name: "¿Qué pasaría si movemos el objeto?" }).check();
  await ana.page.getByRole("button", { name: "Compartir con el grupo" }).click();
  await waitAdv(admin.page, `a.activities.sombras.step === "completed"`);
  await admin.page.getByText(/Conseguimos una pieza: Lupa/).waitFor();
  const a1 = await adv(admin.page);
  check(a1.pieces.includes("lupa") && a1.notebook.filter((r: any) => r.activityId === "sombras").length === 3, "al completar Sombras el servidor concede la pieza «Lupa» y el cuaderno tiene sus tres registros");
  check((await admin.page.locator(".adventure__activity .record--first").count()) === 1 && (await admin.page.locator(".adventure__activity .record--first").innerText()).includes(DRAFT), "la primera idea sigue destacada en la proyección después de completar");
  await shot(admin.page, "07-sombras-completada-proyeccion.png");
  await ana.page.getByRole("button", { name: "Volver al mapa" }).click();
  await scenesAre(ana.page, "LaboratoryScene");
  check(await scenesAre(ana.page, "LaboratoryScene"), "«Volver al mapa» regresa a la escena del laboratorio");

  // ================= RAMPAS =================
  console.log("\nRampas");
  await openStation(ana.page, "Rampas");
  await waitAdv(admin.page, `a.view.kind === "activity" && a.view.activityId === "rampas"`);
  check((await scenesAre(ana.page, "RampsScene")) && (await scenesAre(admin.page, "RampsScene")), "Rampas abre su propia escena en teléfono y proyección");
  check((await ana.page.getByRole("slider").count()) === 0 && (await ana.page.getByRole("button", { name: "Soltar la pelota" }).count()) === 0, "en la respuesta cerrada del docente los controles de la rampa no existen");
  check(await has(admin.page, "RampsScene", "Copia el resultado de la guía") , "la guía que el docente ficticio pide copiar se ve en la proyección");
  await shot(ana.page, "08-rampas-respuesta-cerrada-telefono.png");
  await shot(admin.page, "09-rampas-respuesta-cerrada-proyeccion.png");
  await ana.page.getByRole("button", { name: "Tengo una pregunta" }).click();
  await waitAdv(admin.page, `a.activities.rampas.step === "question"`);
  await share(ana.page, "¿Por qué la pelota baja más rápido cuando está más inclinada?");
  await waitAdv(admin.page, `a.activities.rampas.step === "prediction"`);
  // Cambio de turno DESPUÉS de confirmar: Beto sigue en el paso siguiente.
  await turnTo("Beto");
  await beto.page.getByText("Paso 3 de 5").waitFor();
  check(await scenesAre(beto.page, "RampsScene"), "tras confirmar la pregunta, el turno pasa a Beto y encuentra el paso siguiente («Paso 3 de 5»)");
  await beto.page.getByText("¿Cómo podríamos comprobarlo?").first().waitFor();
  check(true, "con la invitación del docente a comprobarlo");
  await beto.page.getByRole("radio", { name: "Todavía no sé" }).check();
  await beto.page.getByRole("button", { name: "Compartir con el grupo" }).click();
  await waitAdv(admin.page, `a.activities.rampas.step === "trials"`);
  const preds = (await adv(admin.page)).notebook.filter((r: any) => r.field === "prediction");
  check(preds.length === 1 && preds[0].modality === "uncertain" && preds[0].authorName.startsWith("Beto"), "la predicción «Todavía no sé» queda registrada a nombre de Beto");
  await admin.page.locator(".adventure__activity").getByText("Todavía no tenemos una explicación").waitFor();
  check(true, "la proyección la muestra con el texto de incertidumbre, no vacía");
  await turnTo("Ana");
  const angleSlider = ana.page.getByRole("slider", { name: "Inclinación de la rampa" });
  await angleSlider.waitFor();
  await angleSlider.fill("0"); // 15°
  await waitAdv(admin.page, `a.activities.rampas.angleDeg === 15`);
  await ana.page.getByRole("button", { name: "Soltar la pelota" }).click();
  await waitAdv(admin.page, `a.activities.rampas.trials.length === 1`);
  check(await until(async () => (await angleSlider.isDisabled()) && (await ana.page.getByRole("button", { name: "La pelota está rodando…" }).isDisabled())), "con la pelota rodando no se puede cambiar la inclinación ni soltar otra");
  // Pausa con la pelota en marcha: el reloj se congela y la prueba sigue «en curso».
  await admin.page.getByRole("button", { name: "Pausar" }).click();
  await admin.page.getByRole("heading", { name: "En pausa" }).waitFor();
  await sleep(300);
  const clockA = await admin.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.clock.now());
  await sleep(2200); // más que lo que queda de la prueba si el reloj siguiera corriendo
  const clockB = await admin.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.clock.now());
  const midState = (await adv(admin.page)).activities.rampas.trials[0].state;
  check(midState === "running" && Math.abs(clockB - clockA) < 1, "en pausa la prueba sigue «en curso» y el reloj de la simulación no avanza (no termina mientras está detenida)");
  await shot(admin.page, "10-rampas-pausa-con-la-pelota-rodando.png");
  await admin.page.getByRole("button", { name: "Reanudar" }).click();
  await waitAdv(admin.page, `a.activities.rampas.trials[0].state === "finished"`, 12000);
  const t1 = (await adv(admin.page)).activities.rampas.trials[0];
  check(t1.endedActiveMs - t1.startActiveMs === t1.durationMs, "al reanudar la prueba termina a su hora exacta de simulación, sin contar el tiempo en pausa");
  await angleSlider.fill("6"); // 45°
  await waitAdv(admin.page, `a.activities.rampas.angleDeg === 45`);
  await ana.page.getByRole("button", { name: "Soltar la pelota" }).click();
  await waitAdv(admin.page, `a.activities.rampas.step === "observation"`, 12000);
  const rows = await admin.page.locator("table.trials tbody tr").allInnerTexts();
  check(rows.length === 2 && rows[0]!.includes("15°") && rows[1]!.includes("45°"), `la proyección muestra la tabla de pruebas (${rows.map((r) => r.replace(/\s+/g, " ")).join(" | ")})`);
  check((await ana.page.locator("table.trials tbody tr").count()) === 2, "y el teléfono, la misma");
  await shot(ana.page, "11-rampas-comparar-telefono.png");
  await shot(admin.page, "12-rampas-comparar-proyeccion.png");
  await share(ana.page, "Con más inclinación la pelota llega antes: 45° tardó menos que 15°");
  await waitAdv(admin.page, `a.activities.rampas.step === "completed"`);
  await admin.page.getByText(/Conseguimos una pieza: Bocadillo/).waitFor();
  check((await adv(admin.page)).pieces.includes("dialogo"), "al completar Rampas se concede la pieza «Bocadillo»");
  await ana.page.getByRole("button", { name: "Volver al mapa" }).click();
  await scenesAre(ana.page, "LaboratoryScene");

  // ================= LA CAJA DE LAS SORPRESAS =================
  console.log("\nLa caja de las sorpresas");
  await openStation(ana.page, "La caja de las sorpresas");
  await waitAdv(admin.page, `a.view.kind === "activity" && a.view.activityId === "cajas"`);
  check((await scenesAre(ana.page, "BoxesScene")) && (await scenesAre(admin.page, "BoxesScene")), "la caja abre su propia escena");
  await ana.page.getByRole("button", { name: "Abrir la caja para explorar" }).click();
  await waitAdv(admin.page, `a.activities.cajas.sharedOpen === true`);
  await ana.page.getByRole("button", { name: "Campanita" }).click();
  await waitAdv(admin.page, `a.activities.cajas.inspected.includes("campanita")`);
  await sleep(300);
  check(await has(admin.page, "BoxesScene", "Una campanita pequeña. Cuando se mueve, suena."), "al mirar un objeto, la proyección muestra la descripción en la escena");
  await ana.page.getByText("Una campanita pequeña. Cuando se mueve, suena.").waitFor();
  check(true, "y el teléfono, el mismo texto equivalente");
  await shot(ana.page, "13-cajas-explorar-telefono.png");
  await shot(admin.page, "14-cajas-explorar-proyeccion.png");
  await waitAdv(admin.page, `a.activities.cajas.step === "askPermission"`);
  await ana.page.getByRole("button", { name: "Pedir permiso para abrir la caja personal" }).click();
  await waitAdv(admin.page, `a.activities.cajas.step === "refusal"`);
  await turnTo("Beto");
  await beto.page.getByText("Prefiero guardar esas cosas para mí").waitFor();
  await admin.page.getByText("Prefiero guardar esas cosas para mí").first().waitFor();
  check(await has(admin.page, "BoxesScene", "Prefiero guardar esas cosas para mí"), "la negativa de la compañera se ve en la escena y en el panel; Beto, con el turno, la lee antes de seguir");
  await shot(admin.page, "15-cajas-negativa-proyeccion.png");
  await beto.page.getByRole("button", { name: "Entendido" }).click();
  await waitAdv(admin.page, `a.activities.cajas.step === "respect"`);
  await beto.page.getByRole("button", { name: "Respetar y seguir explorando" }).click();
  await waitAdv(admin.page, `a.activities.cajas.step === "nextQuestion"`);
  // Tocar la caja personal: solo un mensaje local; ningún comando, ningún cambio de estado.
  const versionBefore = (await admin.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.stateVersion)) as number;
  await beto.page.getByRole("button", { name: /Caja personal/ }).click();
  await beto.page.getByText("Su contenido es personal. Podemos seguir explorando los objetos compartidos.").waitFor();
  await sleep(500);
  const versionAfter = (await admin.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.stateVersion)) as number;
  check(versionAfter === versionBefore && (await admin.page.getByText("Su contenido es personal.").count()) === 0, "tocar la caja personal solo muestra un mensaje en ese teléfono: no cambia el estado de la sala y la proyección no lo recibe");
  check(!JSON.stringify(await adv(admin.page)).toLowerCase().includes("contenido de la caja personal"), "el snapshot no contiene nada sobre el interior de la caja personal");
  await beto.page.getByRole("button", { name: "Lupa" }).click();
  await beto.page.getByRole("radio", { name: "Escribir" }).check();
  await beto.page.getByLabel("Tu respuesta").fill("¿Por qué las cosas se ven más grandes con una lupa?");
  await beto.page.getByRole("radio", { name: "Lupa" }).check();
  await beto.page.getByRole("button", { name: "Compartir con el grupo" }).click();
  await waitAdv(admin.page, `a.activities.cajas.step === "completed"`);
  await admin.page.getByText(/Conseguimos una pieza: Corazón/).waitFor();
  const a2 = await adv(admin.page);
  const q = a2.notebook.find((r: any) => r.activityId === "cajas" && r.field === "question");
  check(a2.pieces.length === 3 && q?.objectId === "lupa" && q.authorName.startsWith("Beto"), "la pregunta queda vinculada al objeto «Lupa», a nombre de Beto, y con ella las tres piezas están conseguidas");
  await shot(admin.page, "16-cajas-completada-proyeccion.png");
  await beto.page.getByRole("button", { name: "Volver al mapa" }).click();
  await beto.page.getByText("Mesas", { exact: true }).click();
  check(await beto.page.getByRole("button", { name: "El inventor" }).isEnabled(), "con las tres mesas completadas, el inventor queda disponible");
  check((await canvases(admin.page)) === 1 && (await canvases(beto.page)) === 1 && (await canvases(ana.page)) === 0, "al final de las mesas hay un canvas por vista activa y ninguno en la espera");

  // ================= PIEZAS Y CUADERNO =================
  console.log("\nPiezas y cuaderno");
  await beto.page.getByText("Mesas", { exact: true }).click(); // cierra el menú
  await beto.page.getByLabel("Tenemos las tres piezas").waitFor();
  await admin.page.getByLabel("Tenemos las tres piezas").waitFor();
  check(true, "el teléfono del controlador y la proyección muestran las tres piezas conseguidas, con texto");
  const version = () => beto.page.evaluate(() => (window as any).__PHASER_GAME__.registry.get("deps").bridge.snapshot.state.stateVersion as number);
  const v0 = await version();
  await admin.page.getByText(/^Cuaderno \(/).click();
  const adminNotes = admin.page.locator(".adventure__panels .notebook");
  await adminNotes.waitFor();
  const groups = await adminNotes.locator("h3").allInnerTexts();
  check(groups.join("|") === "Sombras|Rampas|La caja de las sorpresas", `el panel de Vanessa agrupa el cuaderno por mesa (${groups.join(", ")})`);
  const text = await adminNotes.innerText();
  check(text.includes("Ana") && text.includes("Beto") && text.includes(DRAFT), "con contribuciones de varias personas y su autor");
  check((await adminNotes.locator(".record--first").count()) === 1, "la primera idea de Sombras aparece distinguida");
  await sleep(400);
  check((await version()) === v0 && (await scenesAre(beto.page, "LaboratoryScene")), "abrir y leer el cuaderno en el panel de Vanessa no cambia la escena ni el estado de quien explora");
  await shot(admin.page, "17-cuaderno-panel-de-vanessa.png");

  // Beto corrige la observación de Ana desde el cuaderno de su teléfono; el original queda en el historial.
  await beto.page.locator(".notebook-menu > summary").click();
  const obsRow = beto.page.locator(".notebook-menu .record", { hasText: "Cuando acerco la linterna" });
  await obsRow.getByRole("button", { name: "Corregir" }).click();
  await obsRow.getByLabel("Tu respuesta").fill("Cuando acerco la linterna la sombra crece mucho");
  await shot(beto.page, "18-cuaderno-corregir-telefono.png");
  await obsRow.getByRole("button", { name: "Guardar la corrección" }).click();
  const adminObs = adminNotes.locator(".record", { hasText: "la sombra crece mucho" });
  await adminObs.waitFor();
  const edited = await adminObs.innerText();
  check(edited.includes("Ana") && edited.includes("editada por Beto"), "la proyección muestra la corrección, con la autora original y quién la editó");
  await adminObs.getByText("Versiones anteriores (1)").click();
  check((await adminObs.innerText()).includes("Cuando acerco la linterna la sombra se hace más grande"), "la versión anterior queda en el historial");
  check((await adminNotes.locator(".record--first").innerText()).includes(DRAFT), "y la primera idea no cambió");
  // Un borrador de corrección sin enviar: se usará más abajo para comprobar que el reinicio lo borra.
  const anyRow = beto.page.locator(".notebook-menu .record", { hasText: "la pelota llega antes" });
  await anyRow.getByRole("button", { name: "Corregir" }).click();
  const editingRow = beto.page.locator(".notebook-menu .record:has(textarea)"); // el texto del registro deja de ser el filtro al escribir
  await editingRow.getByLabel("Tu respuesta").fill("Texto a medias que nadie debe ver");
  check((await beto.page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("borrador") && localStorage.getItem(k)).length)) === 1, "la corrección sin enviar es un borrador local del teléfono de Beto");
  await editingRow.getByRole("button", { name: "Cancelar" }).click();
  await beto.page.locator(".notebook-menu > summary").click();

  // ================= INVENTOR Y FINAL =================
  console.log("\nInventor y final");
  await openStation(beto.page, "El inventor");
  await waitAdv(admin.page, `a.view.kind === "final"`);
  check((await scenesAre(beto.page, "InventorScene")) && (await scenesAre(admin.page, "InventorScene")), "el inventor tiene su propia escena en teléfono y proyección");
  check(await beto.page.getByText("Paso 1 de 2: colocar las piezas").isVisible(), "primero hay que colocar las piezas");
  check((await beto.page.getByRole("radio").count()) === 0, "y todavía no se puede elegir la pregunta");
  await admin.page.getByRole("heading", { name: "El inventor" }).waitFor();
  check((await admin.page.locator(".adventure__activity button:not(summary)").count()) === 0, "la proyección solo lee");
  await sleep(400);
  await shot(admin.page, "19-inventor-apagado-proyeccion.png");
  await beto.page.getByRole("button", { name: "Colocar las piezas" }).click();
  await waitAdv(admin.page, `a.inventor.piecesPlaced === true`);
  await sleep(3200); // la animación: tres piezas, ~2 s
  check((await has(admin.page, "InventorScene", "Lupa\nObservar y probar.")) && (await has(beto.page, "InventorScene", "Corazón\nInvestigar con respeto.")), "al colocar las piezas, cada una viaja a su espacio y se identifica con su mensaje (teléfono y proyección)");
  await shot(admin.page, "20-inventor-encendido-proyeccion.png");
  await shot(beto.page, "21-inventor-pregunta-telefono.png");
  await beto.page.getByText("Paso 2 de 2: elegir la pregunta").waitFor();
  await beto.page.getByRole("radio", { name: "Elegir una pregunta del cuaderno" }).check();
  const options = await beto.page.locator(".record-form__options .option").allInnerTexts();
  check(options.length === 3 && options.every((o) => o.includes("?") || o.includes("voz alta")), `se ofrecen las ${options.length} preguntas guardadas, no las ideas ni las observaciones`);
  await beto.page.locator(".record-form__options .option", { hasText: "lupa" }).locator("input").check();
  await beto.page.getByRole("button", { name: "Compartir la pregunta final" }).click();
  await waitAdv(admin.page, `a.inventor.finalQuestionId !== undefined`);
  await admin.page.getByText("Terminó la aventura").waitFor();
  check(true, "al elegir la pregunta final, la sala pasa a «Terminó la aventura»");
  const finalA = await adv(admin.page);
  const finalQ = finalA.notebook.find((r: any) => r.field === "finalQuestion");
  check(finalQ?.sourceRecordId !== undefined && finalQ.authorName.startsWith("Beto"), "la pregunta final queda ligada a la pregunta guardada de la que salió");
  await beto.page.getByText("Cada descubrimiento puede abrir otra pregunta.").waitFor();
  await admin.page.getByText("Cada descubrimiento puede abrir otra pregunta.").waitFor();
  check((await admin.page.getByText("Aprender comienza con preguntas.").count()) > 0, "teléfono y proyección muestran el mensaje de cierre y la reflexión");
  await sleep(500);
  check((await has(admin.page, "InventorScene", "Nuestra pregunta")) && (await has(admin.page, "InventorScene", finalQ.text)), "y la máquina imprime la tarjeta con la pregunta elegida");
  await shot(admin.page, "22-final-proyeccion.png");
  await shot(beto.page, "23-final-telefono.png");
  check((await beto.page.getByRole("button", { name: "Compartir la pregunta final" }).count()) === 0 && (await beto.page.getByRole("button", { name: "Colocar las piezas" }).count()) === 0, "ya no hay forma de elegir otra pregunta ni de colocar las piezas otra vez");

  // Revisita en `finished`: se puede volver a mirar y explorar, sin copias de piezas.
  const piecesBefore = JSON.stringify(finalA.pieces);
  await beto.page.getByRole("button", { name: "Revisar: Sombras" }).click();
  await beto.page.getByRole("heading", { name: "Sombras" }).waitFor();
  check((await scenesAre(beto.page, "ShadowsScene")) && (await beto.page.getByText("Mesa completada").isVisible()), "terminada la aventura se puede revisar una mesa completada");
  const slider2 = beto.page.getByRole("slider", { name: "Distancia de la linterna al objeto" });
  await slider2.waitFor();
  await slider2.fill("30");
  await waitAdv(admin.page, `a.activities.sombras.distanceCm === 40`);
  check(true, "y explorarla de nuevo (la linterna se mueve en las dos vistas)");
  await beto.page.getByRole("button", { name: "Volver al mapa" }).click();
  await waitAdv(admin.page, `a.view.kind === "map"`);
  const finalB = await adv(admin.page);
  check(JSON.stringify(finalB.pieces) === piecesBefore && finalB.pieces.length === 3 && finalB.notebook.filter((r: any) => r.field === "finalQuestion").length === 1, "revisitar no concede otra pieza ni duplica la pregunta final");
  await admin.page.getByText("Terminó la aventura").waitFor();
  check(true, "y la sala sigue en «Terminó la aventura»");

  // Reiniciar la sala: vuelve a la bienvenida, conserva a las personas y borra lo guardado en los teléfonos.
  await beto.page.getByText("Mesas", { exact: true }).click();
  await beto.page.getByText("Mesas", { exact: true }).click();
  await beto.page.locator(".notebook-menu > summary").click();
  const row2 = beto.page.locator(".notebook-menu .record", { hasText: "la pelota llega antes" });
  await row2.getByRole("button", { name: "Corregir" }).click();
  await beto.page.locator(".notebook-menu .record:has(textarea)").getByLabel("Tu respuesta").fill("Otro texto sin enviar");
  await admin.page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await admin.page.getByRole("button", { name: "Sí, reiniciar" }).click();
  await admin.page.getByText("Entra con tu celular").waitFor();
  await beto.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  await ana.page.getByText("Estás en la sala. Sigue la aventura en la proyección").waitFor();
  check(true, "al reiniciar, la proyección vuelve a la bienvenida y los teléfonos a la espera");
  check((await admin.page.locator(".participant").count()) === 2, "las dos personas siguen en la sala");
  check((await beto.page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("borrador")).length)) === 0, "los borradores de la aventura anterior se borraron de los teléfonos");

  check(problems.length === 0, `sin errores de consola ni de página${problems.length ? `: ${problems.join(" | ")}` : ""}`);
  console.log("\nE2E de las tres mesas, el cuaderno y el inventor (fases 4 y 5): OK");
} catch (e) {
  const where = process.env.E2E_FAIL_DIR ?? tmpdir();
  for (const [name, page] of Object.entries(opened)) await page.screenshot({ path: join(where, `fallo-mesas-${name}.png`) }).catch(() => undefined);
  console.error(`Capturas del fallo en ${where}/fallo-mesas-*.png`);
  throw e;
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
