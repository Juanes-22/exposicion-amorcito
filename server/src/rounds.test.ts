import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoomState } from "../../shared/contracts/state";
import type { AdminAction } from "../../shared/contracts/actions";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../shared/domain/telescope";
import { beginExploration, inSync, joinRoom, setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

// Propuesta de rondas, etapas 1 a 4 de punta a punta contra el servidor real: todas las personas exploran a la vez con sus propias
// pruebas, Vanessa conduce la ronda (abrir, reunir, proyectar, avanzar) y el recorrido termina con la pregunta del grupo.

let server: TestServer;
let now = 10_000;
const clients: TestClient[] = [];
const track = <T extends TestClient>(c: T): T => (clients.push(c), c);

beforeEach(async () => {
  now = 10_000;
  // Reloj monotónico controlado y sin temporizador: las pruebas avanzan el tiempo y llaman a tick() a mano.
  server = await startServer({ mono: () => now, settings: { tickIntervalMs: 0 } });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.stop();
});

const state = (code: string): RoomState => server.app.service.inspect(code)!.state;
const persisted = (code: string): RoomState => server.app.repo.loadRooms().rooms.find((r) => r.state.code === code)!.state;

async function room(names = ["Ana", "Beto", "Carla"], options: { observers?: string[] } = {}) {
  const r = await setupRoom(server, names, options);
  for (const c of r.clients) track(c);
  const ids = r.people.map((p) => p.join.principalId);
  return { ...r, ids, cs: r.people.map((p) => p.client) };
}
type R = Awaited<ReturnType<typeof room>>;

/** Credencial de la persona número `i` (se guardó al entrar). */
const rejoinToken = async (r: R, i: number): Promise<string> => r.people[i]!.client.token!;

/** El contador de Vanessa: cuántas personas están listas y cuántas cuentan en la ronda. */
const counter = (r: R) => r.admin.presence!.round;
const personal = (r: R, i: number) => state(r.code).participants[r.ids[i]!]!;
const ok = async (p: Promise<{ ok: boolean }>, what: string) => expect(await p, what).toMatchObject({ ok: true });
/** Acción de Vanessa que debe aceptarse; espera a que todas las personas conozcan la ronda resultante antes de que actúen. */
const conduct = async (r: R, action: AdminAction, what: string) => {
  const res = await r.admin.admin(action);
  expect(res, what).toMatchObject({ ok: true });
  if (res.ok) await inSync(r, res.roundVersion);
  return res;
};

describe("exploración simultánea con pruebas personales (etapas 1 y 2)", () => {
  it("todas las personas se mueven a la vez sin bloquearse ni tomar el control de otra", async () => {
    const r = await room();
    await beginExploration(r);
    const target = { x: 640, y: 450 };
    const results = await Promise.all(r.cs.map((c) => c.act({ type: "player.moveTo", target })));
    expect(results.every((x) => x.ok)).toBe(true);
    for (const id of r.ids) expect(state(r.code).participants[id]!.character.plan).not.toBeNull();
    // Cada persona ve caminar a las demás.
    for (const c of [...r.cs, r.admin]) for (const id of r.ids) await c.until(() => c.characters.get(id)?.character.plan !== null, "todas ven caminar a todas");
  });

  it("dos personas obtienen resultados distintos y el servidor los conserva por separado", async () => {
    const r = await room(["Ana", "Beto"]);
    await beginExploration(r);
    const [ana, beto] = r.cs as [TestClient, TestClient];
    await ok(Promise.all([ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })]).then(([a]) => a), "abren la mesa");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 15 }), "Ana 15");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 45 }), "Ana 45");
    await ok(beto.act({ type: "shadows.sample", distanceCm: 30 }), "Beto 30");
    const samples = (i: number) => (personal(r, i).activities.sombras as { samples: Array<{ distanceCm: number; counts: boolean }> }).samples;
    expect(samples(0).map((s) => s.distanceCm)).toEqual([15, 45]);
    expect(samples(1).map((s) => [s.distanceCm, s.counts])).toEqual([[30, true]]);
    expect(persisted(r.code).participants[r.ids[0]!]!.activities.sombras).toEqual(personal(r, 0).activities.sombras); // durable
    // El contador de Vanessa distingue listos y pendientes y se actualiza con cada persona.
    await r.admin.until(() => counter(r).ready === 1 && counter(r).total === 2 && r.admin.presence!.participants.find((p) => p.displayName === "Beto")?.progress?.done === 1, "1 de 2 listos y el avance de Beto");
    expect(r.admin.presence!.participants.map((p) => [p.displayName, p.ready, p.progress])).toEqual([
      ["Ana", true, { done: 2, needed: 2 }],
      ["Beto", false, { done: 1, needed: 2 }],
    ]);
  });

  it("antes de abrir la mesa nadie puede abrirla; después, solo la de la ronda", async () => {
    const r = await room(["Ana"]);
    const [ana] = r.cs as [TestClient];
    await conduct(r, { type: "room.start" }, "comenzar");
    await ana.until(() => ana.group?.adventure.round.stage === "preparation", "preparación");
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    await ok(ana.act({ type: "player.moveTo", target: { x: 640, y: 450 } }), "caminar en la preparación");
    await conduct(r, { type: "round.open" }, "abrir");
    await ana.until(() => ana.group?.adventure.round.stage === "exploration", "exploración");
    expect(await ana.act({ type: "station.open", stationId: "rampas", origin: "quickNav" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" })).toMatchObject({ ok: true });
  });

  it("las pruebas de rampa de varias personas corren a la vez y terminan, cada una, en su instante exacto", async () => {
    const r = await room(["Ana", "Beto"]);
    await r.admin.admin({ type: "room.start" });
    // Atajo: llegar a la mesa de Rampas pasando las rondas anteriores con pendientes.
    for (let i = 0; i < 1; i++) {
      await conduct(r, { type: "round.open" }, "abrir");
      await conduct(r, { type: "round.converse", withPending: true }, "reunir");
      await conduct(r, { type: "round.next" }, "avanzar");
    }
    await conduct(r, { type: "round.open" }, "abrir Rampas");
    const [ana, beto] = r.cs as [TestClient, TestClient];
    for (const c of [ana, beto]) await ok(c.act({ type: "station.open", stationId: "rampas", origin: "quickNav" }), "abrir Rampas");
    await ok(ana.act({ type: "ramps.trial.start", angleDeg: 20 }), "Ana suelta");
    now += 1000;
    await ok(beto.act({ type: "ramps.trial.start", angleDeg: 40 }), "Beto suelta un segundo después");
    const trial = (i: number) => (personal(r, i).activities.rampas as { trials: Array<{ state: string; startActiveMs: number; durationMs: number; endedActiveMs?: number }> }).trials[0]!;
    expect(trial(0).startActiveMs).toBeLessThan(trial(1).startActiveMs);
    // Mientras rueda no se puede soltar otra.
    expect(await ana.act({ type: "ramps.trial.start", angleDeg: 30 })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    now += trial(0).durationMs - 1000; // la de Ana está por terminar
    await server.app.service.tick();
    expect(trial(0).state).toBe("finished");
    expect(trial(1).state).toBe("running"); // la de Beto, que empezó después, todavía no
    expect(trial(0).endedActiveMs! - trial(0).startActiveMs).toBeCloseTo(trial(0).durationMs, 6);
    now += 60_000;
    await server.app.service.tick();
    expect(trial(1).state).toBe("finished");
    // Cada una recibe solo su resultado, a su estado personal.
    await ana.until(() => (ana.me!.participant.activities.rampas as { trials: Array<{ state: string }> }).trials[0]!.state === "finished", "Ana recibe su resultado");
    expect(JSON.stringify(ana.mes)).not.toContain('"angleDeg":40');
    expect(persisted(r.code).participants[r.ids[0]!]!.activities.rampas).toEqual(personal(r, 0).activities.rampas);
  });
});

describe("conducción de la ronda por Vanessa (etapa 3)", () => {
  it("abrir fija la lista; reunir con pendientes exige confirmarlo y cierra las pruebas; avanzar incorpora la pieza y regresa a todas al mapa", async () => {
    const r = await room(["Ana", "Beto", "Carla"]);
    await beginExploration(r);
    const [ana, beto] = r.cs as [TestClient, TestClient, TestClient];
    expect(state(r.code).adventure.round.roster.sort()).toEqual([...r.ids].sort());
    await ok(ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "Ana abre");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 20 }), "m1");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 50 }), "m2");
    await ok(beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "Beto abre");
    await ok(beto.act({ type: "shadows.sample", distanceCm: 25 }), "una muestra");

    // Con pendientes, Vanessa debe decidirlo expresamente.
    expect(await r.admin.admin({ type: "round.converse" })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(state(r.code).adventure.round.stage).toBe("exploration");
    await conduct(r, { type: "round.converse", withPending: true }, "pasar con pendientes");
    expect(state(r.code).adventure.round.stage).toBe("conversation");
    expect([...state(r.code).adventure.round.pendingAtConversation].sort()).toEqual([r.ids[1], r.ids[2]].sort());
    for (const c of r.cs) await c.until(() => c.group?.adventure.round.stage === "conversation", "todas ven la conversación");
    // Los controles se detienen y el trabajo parcial se conserva sin concederles finalización.
    expect(await beto.act({ type: "shadows.sample", distanceCm: 55 })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect((personal(r, 1).activities.sombras as { samples: unknown[] }).samples).toHaveLength(1);
    await r.admin.until(() => counter(r).ready === 1 && counter(r).total === 3, "1 de 3 listos al reunir");

    // Una acción tardía de la ronda anterior se rechaza.
    expect(await ana.act({ type: "adventure.returnToMap" }, { roundVersion: 1 })).toMatchObject({ ok: false, code: "STALE_ROUND" });

    // Avanzar incorpora la pieza una sola vez y regresa a todas al mapa.
    expect(state(r.code).adventure.pieces).toEqual([]);
    await conduct(r, { type: "round.next" }, "abrir la siguiente mesa");
    expect(state(r.code).adventure).toMatchObject({ pieces: ["lupa"], completed: ["sombras"], round: { index: 1, stage: "preparation", roster: [] } });
    for (const c of r.cs) await c.until(() => c.group?.adventure.round.index === 1, "todas reciben la siguiente mesa");
    expect(personal(r, 0).view).toEqual({ kind: "map" });
    const effects = ana.groups.flatMap((g) => g.effects).filter((e) => e.kind === "piece.earned");
    expect(effects).toEqual([expect.objectContaining({ pieceId: "lupa", activityId: "sombras", effectId: `1:piece:lupa` })]);
    expect(await r.admin.admin({ type: "round.next" })).toMatchObject({ ok: false }); // no se incorpora dos veces
    expect(persisted(r.code).adventure.pieces).toEqual(["lupa"]);
  });

  it("la conversación cancela las pruebas en curso, que no cuentan como terminadas", async () => {
    const r = await room(["Ana"]);
    await r.admin.admin({ type: "room.start" });
    await conduct(r, { type: "round.open" }, "abrir");
    await conduct(r, { type: "round.converse", withPending: true }, "reunir");
    await conduct(r, { type: "round.next" }, "avanzar a Rampas");
    await conduct(r, { type: "round.open" }, "abrir Rampas");
    const [ana] = r.cs as [TestClient];
    await ok(ana.act({ type: "station.open", stationId: "rampas", origin: "quickNav" }), "abrir");
    await ok(ana.act({ type: "ramps.trial.start", angleDeg: 20 }), "soltar");
    await conduct(r, { type: "round.converse", withPending: true }, "reunir con la pelota rodando");
    const trials = (personal(r, 0).activities.rampas as { trials: Array<{ state: string }> }).trials;
    expect(trials.map((t) => t.state)).toEqual(["cancelled"]);
    now += 60_000;
    await server.app.service.tick();
    expect((personal(r, 0).activities.rampas as { trials: Array<{ state: string }> }).trials[0]!.state).toBe("cancelled");
  });

  it("Vanessa proyecta los resultados de una persona; se conservan en el cuaderno común sin alterar los originales", async () => {
    const r = await room(["Ana", "Beto"]);
    await beginExploration(r);
    const [ana, beto] = r.cs as [TestClient, TestClient];
    await ok(ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "Ana abre");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 20 }), "m1");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 50 }), "m2");
    await conduct(r, { type: "round.converse", withPending: true }, "reunir");
    expect(await r.admin.admin({ type: "present.select", principalId: r.ids[1]! })).toMatchObject({ ok: false, code: "INVALID_STEP" }); // Beto no tiene resultados
    await conduct(r, { type: "present.select", principalId: r.ids[0]! }, "proyectar a Ana");
    for (const c of [beto, r.admin]) await c.until(() => c.group?.adventure.presentedNoteId !== null, "todas ven la comparación");
    const note = r.admin.group!.adventure.notebook.find((n) => n.id === r.admin.group!.adventure.presentedNoteId)!;
    expect(note).toMatchObject({ kind: "comparison", comparison: { authorName: "Ana", data: { type: "shadows", samples: [{ distanceCm: 20 }, { distanceCm: 50 }] } } });
    expect((personal(r, 0).activities.sombras as { samples: unknown[] }).samples).toHaveLength(2); // el original no se tocó
    await conduct(r, { type: "present.clear" }, "quitar");
    await beto.until(() => beto.group?.adventure.presentedNoteId === null, "se quita de la proyección");
    expect(state(r.code).adventure.notebook.filter((n) => n.kind === "comparison")).toHaveLength(1); // se conserva
  });

  it("la frase de Freire se muestra a todas durante la conversación", async () => {
    const r = await room(["Ana"]);
    await beginExploration(r);
    await conduct(r, { type: "round.converse", withPending: true }, "reunir");
    await conduct(r, { type: "round.showFreire" }, "mostrar");
    await r.cs[0]!.until(() => r.cs[0]!.group?.adventure.round.freireShown === true, "la persona ve la frase mostrada");
  });

  it("Vanessa guarda la idea inicial y la síntesis del grupo, las corrige sin perder la versión anterior y no necesita tomar ningún control", async () => {
    const r = await room(["Ana"]);
    await r.admin.admin({ type: "room.start" });
    await conduct(r, { type: "note.save", activityId: "sombras", kind: "initialIdea", text: "La luz estira la sombra" }, "idea inicial");
    await conduct(r, { type: "round.open" }, "abrir");
    await conduct(r, { type: "round.converse", withPending: true }, "reunir");
    await conduct(r, { type: "note.save", activityId: "sombras", kind: "synthesis", text: "Cerca la sombra es mayor" }, "síntesis");
    const [idea] = state(r.code).adventure.notebook;
    await conduct(r, { type: "note.edit", noteId: idea!.id, expectedRevision: 1, text: "La luz cambia la sombra" }, "corregir");
    expect(state(r.code).adventure.notebook[0]).toMatchObject({ kind: "initialIdea", revision: 2, text: "La luz cambia la sombra", history: [expect.objectContaining({ text: "La luz estira la sombra" })] });
    expect(await r.admin.admin({ type: "note.edit", noteId: idea!.id, expectedRevision: 1, text: "otra" })).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    // Las participantes ven el cuaderno del grupo (solo lo que Vanessa guardó) y nada de lo privado.
    await r.cs[0]!.until(() => r.cs[0]!.group?.adventure.notebook.length === 2, "la persona ve las notas del grupo");
  });

  it("quien llega después acompaña la ronda sin alterar el contador; Vanessa puede incluirla; en la siguiente ronda cuenta", async () => {
    const r = await room(["Ana"]);
    await beginExploration(r);
    const late = await joinRoom(server.url, r.code, "Tardía", "rosa");
    const lateClient = track(await new TestClient(server.url, late.body.token).ready());
    await lateClient.until(() => lateClient.me !== null, "su estado personal");
    await r.admin.until(() => r.admin.presence!.participants.length === 2, "Vanessa ve a la persona nueva");
    expect(counter(r)).toEqual({ ready: 0, total: 1 });
    expect(r.admin.presence!.participants.find((p) => p.displayName === "Tardía")).toMatchObject({ inRound: false, connected: true });
    await ok(lateClient.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "acompaña explorando");
    expect(counter(r).total).toBe(1);
    await conduct(r, { type: "round.include", principalId: late.body.principalId }, "incluirla");
    await r.admin.until(() => counter(r).total === 2, "ahora cuenta");
    await conduct(r, { type: "round.converse", withPending: true }, "reunir");
    await conduct(r, { type: "round.next" }, "avanzar");
    await conduct(r, { type: "round.open" }, "abrir la siguiente");
    expect(state(r.code).adventure.round.roster).toHaveLength(2);
  });

  it("una desconexión no reduce el total ni borra lo hecho: la persona aparece sin conexión y, al volver, sigue donde estaba", async () => {
    const r = await room(["Ana", "Beto"]);
    await beginExploration(r);
    const [ana, beto] = r.cs as [TestClient, TestClient];
    await ok(beto.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "abrir");
    await ok(beto.act({ type: "shadows.sample", distanceCm: 20 }), "una muestra");
    beto.close();
    await r.admin.until(() => r.admin.presence!.participants.find((p) => p.displayName === "Beto")?.connected === false, "Beto sin conexión");
    expect(counter(r).total).toBe(2); // el total no baja en silencio
    await ana.until(() => ana.characters.get(r.ids[1]!)?.connected === false, "las demás ven su personaje sin conexión");
    expect(state(r.code).phase).toBe("running"); // las demás continúan
    // Beto vuelve con su misma identidad y recupera sus pruebas.
    const back = track(await new TestClient(server.url, r.people[1] ? (await rejoinToken(r, 1)) : undefined).ready());
    await back.until(() => back.me !== null, "recupera su estado personal");
    expect((back.me!.participant.activities.sombras as { samples: Array<{ distanceCm: number }> }).samples.map((x) => x.distanceCm)).toEqual([20]);
    await r.admin.until(() => r.admin.presence!.participants.find((p) => p.displayName === "Beto")?.connected === true, "Beto vuelve a aparecer conectado");
    expect(counter(r).total).toBe(2);
  });
});

describe("El observatorio (mesa 3)", () => {
  it("cada persona mira con su propio telescopio: lo observado y la cortina llegan solo a ella, y Vanessa ve el avance, no quién miró la casa", async () => {
    const r = await room(["Ana", "Beto"]);
    await r.admin.admin({ type: "room.start" });
    for (let i = 0; i < 2; i++) {
      await conduct(r, { type: "round.open" }, `abrir ${i}`);
      await conduct(r, { type: "round.converse", withPending: true }, `reunir ${i}`);
      await conduct(r, { type: "round.next" }, `avanzar ${i}`);
    }
    await conduct(r, { type: "round.open" }, "abrir el observatorio");
    const [ana, beto] = r.cs as [TestClient, TestClient];
    for (const c of [ana, beto]) await ok(c.act({ type: "station.open", stationId: "cajas", origin: "quickNav" }), "abrir el telescopio");
    const { moon, stars, window: win } = TELESCOPE_TARGETS;
    await ok(ana.act({ type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "Ana se acerca a la ventana");
    await ok(beto.act({ type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "Beto, la Luna");
    await ok(beto.act({ type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "Beto, las estrellas");
    expect(personal(r, 0).activities.cajas).toMatchObject({ x: win.x, y: win.y, zoom: CLOSE_ZOOM, observed: [], curtain: "closed" });
    expect(personal(r, 1).activities.cajas).toMatchObject({ observed: ["moon", "stars"], curtain: "open" }); // la cortina de Ana no cierra la casa de Beto
    await beto.until(() => (beto.me!.participant.activities.cajas as { observed: string[] }).observed.length === 2, "Beto recibe sus observaciones");
    expect(JSON.stringify(beto.mes)).not.toContain('"curtain":"closed"');
    expect(JSON.stringify(beto.mes)).not.toContain(`"x":${win.x}`);

    // La consola muestra el avance; ni el visor ni la cortina de nadie le llegan.
    await r.admin.until(() => counter(r).ready === 1 && counter(r).total === 2, "1 de 2 listos");
    expect(r.admin.presence!.participants.map((p) => [p.displayName, p.ready, p.progress])).toEqual([
      ["Ana", false, { done: 0, needed: 2 }],
      ["Beto", true, { done: 2, needed: 2 }],
    ]);
    expect(r.admin.mes).toEqual([]);
    expect(JSON.stringify([r.admin.groups, r.admin.presence])).not.toMatch(/curtain|telescope/);

    // Lo de Ana es durable y vuelve igual al reconectar: la cortina sigue cerrada.
    expect(persisted(r.code).participants[r.ids[0]!]!.activities.cajas).toEqual(personal(r, 0).activities.cajas);
    ana.close();
    const back = track(await new TestClient(server.url, await rejoinToken(r, 0)).ready());
    await back.until(() => back.me !== null, "recupera su estado personal");
    expect(back.me!.participant.activities.cajas).toMatchObject({ x: win.x, y: win.y, zoom: CLOSE_ZOOM, curtain: "closed" });

    // En la conversación no se proyecta la exploración de nadie: se proyecta la demostración de Vanessa.
    // (Ana volvió con otra conexión: aquí se espera solo a Beto en lugar de a todo el grupo.)
    await ok(r.admin.admin({ type: "round.converse", withPending: true }), "reunir");
    await beto.until(() => beto.group?.adventure.round.stage === "conversation", "Beto ve la conversación");
    expect(await r.admin.admin({ type: "present.select", principalId: r.ids[1]! })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(await beto.act({ type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM })).toMatchObject({ ok: false, code: "INVALID_STEP" });
    await ok(r.admin.admin({ type: "round.next" }), "al inventor");
    expect(state(r.code).adventure.pieces).toEqual(["lupa", "dialogo", "corazon"]);
  });
});

describe("cierre, pregunta final y reinicio (etapa 4)", () => {
  async function toClosing(r: R) {
    await r.admin.admin({ type: "room.start" });
    for (let i = 0; i < 3; i++) {
      await ok(r.admin.admin({ type: "round.open" }), `abrir ${i}`);
      await ok(r.admin.admin({ type: "round.converse", withPending: true }), `reunir ${i}`);
      await ok(r.admin.admin({ type: "round.next" }), `avanzar ${i}`);
    }
  }

  it("tras la tercera conversación el inventor recibe las tres piezas sin colocarlas a mano y todas ven el cierre", async () => {
    const r = await room(["Ana", "Beto"]);
    await toClosing(r);
    expect(state(r.code).adventure).toMatchObject({ pieces: ["lupa", "dialogo", "corazon"], round: { stage: "closing" } });
    const ana = r.cs[0]!;
    await ana.until(() => ana.group?.adventure.round.stage === "closing", "cierre visible");
    expect(ana.groups.flatMap((g) => g.effects).map((e) => e.kind)).toEqual(expect.arrayContaining(["piece.earned", "inventor.activated"]));
    expect(ana.groups.flatMap((g) => g.effects).filter((e) => e.kind === "piece.earned")).toHaveLength(3);
  });

  it("la pregunta final se confirma una sola vez, cierra la aventura y puede corregirse un error de escritura", async () => {
    const r = await room(["Ana"]);
    await r.admin.admin({ type: "room.start" });
    await conduct(r, { type: "round.open" }, "abrir");
    await conduct(r, { type: "round.converse", withPending: true }, "reunir");
    await conduct(r, { type: "note.save", activityId: "sombras", kind: "question", text: "¿Qué pasaría si movemos el objeto?" }, "guardar pregunta");
    for (let i = 0; i < 3; i++) {
      await ok(r.admin.admin({ type: "round.next" }), `avanzar ${i}`);
      if (i < 2) {
        await ok(r.admin.admin({ type: "round.open" }), `abrir ${i}`);
        await ok(r.admin.admin({ type: "round.converse", withPending: true }), `reunir ${i}`);
      }
    }
    expect(await r.admin.admin({ type: "final.confirm", value: { kind: "saved", noteId: "n99" } })).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    const q = state(r.code).adventure.notebook.find((n) => n.kind === "question")!;
    await conduct(r, { type: "final.confirm", value: { kind: "saved", noteId: q.id } }, "confirmar");
    expect(state(r.code).phase).toBe("finished");
    const ana = r.cs[0]!;
    await ana.until(() => ana.summary?.phase === "finished", "la persona ve que terminó");
    // El resumen y el estado de grupo con sus efectos son mensajes distintos: el segundo puede llegar un instante después del primero.
    await ana.until(() => ana.groups.some((g) => g.effects.some((e) => e.kind === "adventure.finished")), "recibe el efecto de que la aventura terminó");
    expect(ana.groups.flatMap((g) => g.effects).map((e) => e.kind)).toContain("adventure.finished");
    expect(await r.admin.admin({ type: "final.confirm", value: { kind: "written", text: "otra" } })).toMatchObject({ ok: false });
    await conduct(r, { type: "final.correct", expectedRevision: 1, text: "¿Qué pasaría si movemos el objeto de lugar?" }, "corregir");
    expect(state(r.code).adventure.notebook.find((n) => n.kind === "finalQuestion")).toMatchObject({ revision: 2, text: "¿Qué pasaría si movemos el objeto de lugar?" });
    expect(await ana.act({ type: "player.moveTo", target: { x: 640, y: 450 } })).toMatchObject({ ok: false });
  });

  it("reiniciar la sala borra el recorrido y las pruebas, conserva a las personas y devuelve sus personajes a la entrada", async () => {
    const r = await room(["Ana", "Beto"]);
    await beginExploration(r);
    const [ana] = r.cs as [TestClient, TestClient];
    await ok(ana.act({ type: "station.open", stationId: "sombras", origin: "quickNav" }), "abrir");
    await ok(ana.act({ type: "shadows.sample", distanceCm: 20 }), "muestra");
    await conduct(r, { type: "room.reset", confirm: true }, "reiniciar");
    await ana.until(() => ana.summary?.phase === "welcome" && ana.summary.roomGeneration === 2, "generación nueva");
    expect(Object.keys(state(r.code).participants).sort()).toEqual([...r.ids].sort());
    expect(personal(r, 0)).toMatchObject({ view: { kind: "map" }, activities: { sombras: { samples: [] } } });
    await ana.until(() => (ana.me?.participant.activities.sombras as { samples: unknown[] }).samples.length === 0, "su estado personal se repone");
    expect(state(r.code).adventure).toMatchObject({ completed: [], pieces: [], notebook: [] });
  });

  it("las acciones de una generación anterior a un reinicio se rechazan", async () => {
    const r = await room(["Ana"]);
    await beginExploration(r);
    const [ana] = r.cs as [TestClient];
    const stale = ana.participantEnvelope({ type: "adventure.returnToMap" });
    await conduct(r, { type: "room.reset", confirm: true }, "reiniciar");
    expect(await ana.rawParticipant(stale)).toMatchObject({ ok: false, code: "STALE_GENERATION" });
  });
});
