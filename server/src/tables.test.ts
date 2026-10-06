import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdventureAction, CommandResult } from "../../shared/contracts/actions";
import type { AdventureState, BoxesState, NotebookRecord, RampsState, ShadowsState } from "../../shared/contracts/state";
import { setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

// P4-05: cada mesa se reparte entre 2 o 3 identidades reales (sockets y credenciales distintos). Lo que se comprueba aquí es que el
// avance es de la SALA, no de quien lo empezó: el cambio de turno antes o después de confirmar no pierde ni duplica nada, solo quien
// tiene el turno puede actuar, y una pausa o un reinicio de experimento no borran lo ya compartido.

let server: TestServer;
let now = 10_000;
const clients: TestClient[] = [];
const track = <T extends TestClient>(c: T): T => (clients.push(c), c);

beforeEach(async () => {
  now = 10_000;
  server = await startServer({ mono: () => now, settings: { tickIntervalMs: 0 } });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.stop();
});

const state = (code: string) => server.app.service.inspect(code)!.state;
const adv = (code: string): AdventureState => state(code).adventure;
const persisted = (code: string) => server.app.repo.loadRooms().rooms.find((r) => r.state.code === code)!.state;

async function running() {
  const r = await setupRoom(server, ["Ana", "Beto", "Cata"]);
  for (const c of r.clients) track(c);
  const people = { Ana: r.people[0]!, Beto: r.people[1]!, Cata: r.people[2]! };
  const who = (n: keyof typeof people) => people[n].client;
  const giveTurn = async (n: keyof typeof people) => {
    expect(await r.admin.admin({ type: "control.assign", principalId: people[n].join.principalId })).toMatchObject({ ok: true });
    await who(n).until(() => who(n).summary?.self.isController === true && who(n).turnVersion === state(r.code).turnVersion, `${n} tiene el turno`);
  };
  await giveTurn("Ana");
  await r.admin.admin({ type: "room.start" });
  await who("Ana").until(() => who("Ana").summary?.phase === "running", "sala en curso");
  /** Ejecuta una acción como `n` y exige que el servidor la acepte. */
  const ok = async (n: keyof typeof people, a: AdventureAction) => expect(await who(n).adventure(a), `${n}: ${JSON.stringify(a)}`).toMatchObject({ ok: true });
  const denied = async (n: keyof typeof people, a: AdventureAction, code: string): Promise<CommandResult> => {
    const res = await who(n).adventure(a);
    expect(res, `${n}: ${JSON.stringify(a)}`).toMatchObject({ ok: false, code });
    return res;
  };
  const tick = async (ms: number) => {
    now += ms;
    await server.app.service.tick();
  };
  return { ...r, who, giveTurn, ok, denied, tick };
}
type Room = Awaited<ReturnType<typeof running>>;

const records = (code: string, activityId: string): NotebookRecord[] => adv(code).notebook.filter((r) => r.activityId === activityId);
const written = (text: string) => ({ modality: "written" as const, text });
const completeShadows = async (r: Room) => {
  await r.ok("Ana", { type: "station.open", stationId: "sombras", origin: "quickNav" });
  await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
  await r.ok("Ana", { type: "shadows.light.set", distanceCm: 15, commitSample: true });
  await r.ok("Ana", { type: "shadows.light.set", distanceCm: 45, commitSample: true });
  await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "uncertain" } });
  await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } });
  await r.ok("Ana", { type: "adventure.returnToMap" });
};

describe("Sombras repartida entre tres identidades (P4-01, CA-14, CA-15)", () => {
  it("el turno cambia ANTES de confirmar la primera idea, entre sus muestras y tras la observación; cada registro conserva a su autora", async () => {
    const r = await running();
    await r.ok("Ana", { type: "station.open", stationId: "sombras", origin: "quickNav" });
    await r.ok("Ana", { type: "shadows.surprise.ack" });
    // Ana pasa el turno sin haber compartido nada: Beto encuentra la mesa en el mismo paso y la primera idea es SUYA.
    await r.giveTurn("Beto");
    expect((adv(r.code).activities.sombras as ShadowsState).step).toBe("firstIdea");
    await r.denied("Ana", { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: written("la mía") }, "NOT_AUTHORIZED");
    expect(records(r.code, "sombras")).toHaveLength(0);
    await r.ok("Beto", { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: written("Porque la luz estira la sombra") });
    const first = records(r.code, "sombras")[0]!;
    expect(first).toMatchObject({ field: "firstIdea", modality: "written", text: "Porque la luz estira la sombra" });
    expect(first.authorName).toContain("Beto");

    // Cata explora: dos posiciones distintas. Arrastrar (commitSample:false) comparte la posición, pero no cuenta como exploración.
    await r.giveTurn("Cata");
    await r.ok("Cata", { type: "shadows.light.set", distanceCm: 30, commitSample: false });
    expect((adv(r.code).activities.sombras as ShadowsState).samples).toHaveLength(0);
    expect((adv(r.code).activities.sombras as ShadowsState).distanceCm).toBe(30);
    await r.ok("Cata", { type: "shadows.light.set", distanceCm: 30, commitSample: true });
    await r.ok("Cata", { type: "shadows.light.set", distanceCm: 32, commitSample: true }); // demasiado parecida: no cuenta
    expect((adv(r.code).activities.sombras as ShadowsState).step).toBe("explore");
    await r.ok("Cata", { type: "shadows.light.set", distanceCm: 50, commitSample: true });
    const st = adv(r.code).activities.sombras as ShadowsState;
    expect(st.step).toBe("observation");
    expect(st.samples.map((s) => s.counts)).toEqual([true, false, true]);

    // Tras confirmar la observación vuelve a cambiar el turno: el paso siguiente sigue disponible para quien llegue.
    await r.giveTurn("Ana");
    await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "observation", value: written("De cerca la sombra es más grande") });
    await r.giveTurn("Beto");
    await r.ok("Beto", { type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "suggested", optionId: "mover-objeto" } });
    expect(adv(r.code).activities.sombras).toMatchObject({ step: "completed" });
    expect(adv(r.code).pieces).toEqual(["lupa"]);

    const all = records(r.code, "sombras");
    expect(all.map((x) => [x.field, x.authorName.split(" ")[0]])).toEqual([["firstIdea", "Beto"], ["observation", "Ana"], ["nextQuestion", "Beto"]]);
    expect(all.find((x) => x.field === "nextQuestion")!.text).toBe("¿Qué pasaría si movemos el objeto?"); // el servidor resuelve el texto sugerido
    expect(persisted(r.code).adventure.notebook).toEqual(adv(r.code).notebook); // y todo está ya en disco
  });

  it("la primera idea permanece identificable aunque se revise después: la edición añade versión, no la sustituye (CA-15)", async () => {
    const r = await running();
    await r.ok("Ana", { type: "station.open", stationId: "sombras", origin: "quickNav" });
    await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: written("Creo que es magia") });
    const id = records(r.code, "sombras")[0]!.id;
    await r.giveTurn("Beto");
    await r.ok("Beto", { type: "record.edit", recordId: id, expectedRevision: 1, value: written("Creo que la luz tiene que ver") });
    const edited = records(r.code, "sombras")[0]!;
    expect(edited).toMatchObject({ id, field: "firstIdea", revision: 2, text: "Creo que la luz tiene que ver" });
    expect(edited.authorName).toContain("Ana"); // la autora original no cambia
    expect(edited.lastEditor?.name).toContain("Beto");
    expect(edited.history).toHaveLength(1);
    expect(edited.history[0]).toMatchObject({ revision: 1, text: "Creo que es magia" });
    // Editar con una revisión vieja se rechaza sin pisar nada.
    await r.denied("Beto", { type: "record.edit", recordId: id, expectedRevision: 1, value: written("tarde") }, "REVISION_CONFLICT");
    expect(records(r.code, "sombras")[0]!.text).toBe("Creo que la luz tiene que ver");
  });

  it("reiniciar el experimento repone la linterna y NO borra la primera idea, las posiciones anotadas ni las piezas (SPECS 3.5)", async () => {
    const r = await running();
    await completeShadows(r);
    await r.ok("Ana", { type: "station.open", stationId: "sombras", origin: "quickNav" });
    const before = JSON.stringify({ notebook: adv(r.code).notebook, pieces: adv(r.code).pieces, samples: (adv(r.code).activities.sombras as ShadowsState).samples });
    await r.ok("Ana", { type: "shadows.light.set", distanceCm: 55, commitSample: false });
    await r.ok("Ana", { type: "experiment.reset" });
    const st = adv(r.code).activities.sombras as ShadowsState;
    expect(st.distanceCm).toBe(10);
    expect(st.step).toBe("completed");
    expect(JSON.stringify({ notebook: adv(r.code).notebook, pieces: adv(r.code).pieces, samples: st.samples })).toBe(before);
  });
});

describe("Rampas repartida entre tres identidades (P4-02, CA-16, CA-17, CA-11)", () => {
  async function toTrials(r: Room) {
    await completeShadows(r);
    await r.ok("Ana", { type: "station.open", stationId: "rampas", origin: "quickNav" });
    await r.denied("Ana", { type: "ramps.trial.start" }, "INVALID_STEP"); // con la respuesta cerrada no hay experimento
    await r.denied("Ana", { type: "ramps.angle.set", angleDeg: 25 }, "INVALID_STEP");
    await r.ok("Ana", { type: "ramps.question.open" });
    await r.ok("Ana", { type: "record.confirm", activityId: "rampas", field: "question", value: written("¿Por qué baja más rápido?") });
    await r.giveTurn("Beto");
    await r.ok("Beto", { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } });
    expect((adv(r.code).activities.rampas as RampsState).step).toBe("trials");
  }

  it("la pregunta es de Ana, la predicción de Beto y las pruebas de Cata; el turno cambia con una prueba en marcha y esta sigue siendo de la sala", async () => {
    const r = await running();
    await toTrials(r);
    await r.giveTurn("Cata");
    await r.ok("Cata", { type: "ramps.angle.set", angleDeg: 15 });
    await r.ok("Cata", { type: "ramps.trial.start" });
    const ramps = () => adv(r.code).activities.rampas as RampsState;
    const t1 = ramps().trials[0]!;
    expect(t1).toMatchObject({ state: "running", angleDeg: 15 });
    // Mientras rueda: ni otra prueba ni cambiar la inclinación, y reiniciar la cancela sin contarla.
    await r.denied("Cata", { type: "ramps.trial.start" }, "INVALID_STEP");
    await r.denied("Cata", { type: "ramps.angle.set", angleDeg: 25 }, "INVALID_STEP");

    await tick1(r, t1.durationMs / 2);
    await r.giveTurn("Ana"); // cambio de turno en pleno movimiento
    expect(ramps().trials[0]!.state).toBe("running");
    await r.denied("Cata", { type: "ramps.trial.start" }, "NOT_AUTHORIZED");
    await tick1(r, t1.durationMs); // pasa de sobra
    expect(ramps().trials[0]).toMatchObject({ state: "finished", startedBy: r.people[2]!.join.principalId, endedActiveMs: t1.startActiveMs + t1.durationMs });

    await r.ok("Ana", { type: "ramps.angle.set", angleDeg: 45 });
    await r.ok("Ana", { type: "ramps.trial.start" });
    await tick1(r, ramps().trials[1]!.durationMs + 1);
    const finished = ramps().trials.filter((t) => t.state === "finished");
    expect(finished.map((t) => t.angleDeg)).toEqual([15, 45]);
    expect(finished[1]!.durationMs).toBeLessThan(finished[0]!.durationMs); // más inclinación, menos tiempo (modelo ideal)
    expect(ramps().step).toBe("observation");
    await r.ok("Ana", { type: "record.confirm", activityId: "rampas", field: "observation", value: written("Con 45° llegó antes") });
    expect(ramps().step).toBe("completed");
    expect(adv(r.code).pieces).toEqual(["lupa", "dialogo"]);
    expect(records(r.code, "rampas").map((x) => x.field)).toEqual(["question", "prediction", "observation"]);
  });

  it("pausa con la pelota rodando: la prueba no avanza ni termina en pausa, y al reanudar termina en su instante exacto aunque cambie el turno", async () => {
    const r = await running();
    await toTrials(r);
    await r.giveTurn("Cata");
    await r.ok("Cata", { type: "ramps.trial.start" });
    const ramps = () => adv(r.code).activities.rampas as RampsState;
    const trial = ramps().trials[0]!;
    await tick1(r, 1000);
    expect(await r.admin.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    const frozen = adv(r.code).timeline.activeMs;
    await tick1(r, 5 * 60_000); // cinco minutos de conversación
    expect(adv(r.code).timeline.activeMs).toBe(frozen);
    expect(ramps().trials[0]!.state).toBe("running");
    // En pausa nadie actúa: la sala no está en curso y la prueba sigue «en curso» (el servidor responde antes por el turno o por la fase).
    expect(await r.who("Cata").adventure({ type: "ramps.trial.start" })).toMatchObject({ ok: false });
    expect(ramps().trials).toHaveLength(1);
    expect(await r.admin.admin({ type: "room.resume" })).toMatchObject({ ok: true });
    await r.giveTurn("Ana");
    await tick1(r, trial.durationMs - 1000 + 5);
    expect(ramps().trials[0]).toMatchObject({ state: "finished", endedActiveMs: trial.startActiveMs + trial.durationMs });
  });

  it("reiniciar el experimento con una prueba rodando la marca cancelada (no cuenta); las terminadas, el cuaderno y las piezas se conservan", async () => {
    const r = await running();
    await toTrials(r);
    const ramps = () => adv(r.code).activities.rampas as RampsState;
    await r.giveTurn("Beto");
    await r.ok("Beto", { type: "ramps.angle.set", angleDeg: 20 });
    await r.ok("Beto", { type: "ramps.trial.start" });
    await tick1(r, ramps().trials[0]!.durationMs + 1);
    await r.ok("Beto", { type: "ramps.angle.set", angleDeg: 40 });
    await r.ok("Beto", { type: "ramps.trial.start" });
    expect(ramps().step).toBe("trials"); // la segunda aún rueda: una sola prueba terminada no alcanza para comparar
    await tick1(r, 300);
    await r.ok("Beto", { type: "experiment.reset" });
    expect(ramps().trials.map((t) => t.state)).toEqual(["finished", "cancelled"]);
    expect(ramps().angleDeg).toBe(15);
    await tick1(r, 60_000); // la cancelada no «termina» después
    expect(ramps().trials.map((t) => t.state)).toEqual(["finished", "cancelled"]);
    expect(records(r.code, "rampas")).toHaveLength(2);
    expect(adv(r.code).pieces).toEqual(["lupa"]);
    // Se puede volver a probar y contar.
    await r.ok("Beto", { type: "ramps.trial.start" });
    await tick1(r, ramps().trials[2]!.durationMs + 1);
    expect(ramps().trials.filter((t) => t.state === "finished")).toHaveLength(2);
    expect(ramps().step).toBe("observation"); // la cancelada no cuenta; la repetida sí
  });
});

describe("La caja de las sorpresas repartida entre tres identidades (P4-03, CA-18, CA-19)", () => {
  async function toBoxes(r: Room) {
    await completeShadows(r);
    await r.ok("Ana", { type: "station.open", stationId: "rampas", origin: "quickNav" });
    await r.ok("Ana", { type: "ramps.question.open" });
    await r.ok("Ana", { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    await r.ok("Ana", { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    await r.ok("Ana", { type: "ramps.angle.set", angleDeg: 15 });
    await r.ok("Ana", { type: "ramps.trial.start" });
    await r.tick((adv(r.code).activities.rampas as RampsState).trials[0]!.durationMs + 1);
    await r.ok("Ana", { type: "ramps.angle.set", angleDeg: 35 });
    await r.ok("Ana", { type: "ramps.trial.start" });
    await r.tick((adv(r.code).activities.rampas as RampsState).trials[1]!.durationMs + 1);
    await r.ok("Ana", { type: "record.confirm", activityId: "rampas", field: "observation", value: { modality: "uncertain" } });
    await r.ok("Ana", { type: "adventure.returnToMap" });
    await r.ok("Ana", { type: "station.open", stationId: "cajas", origin: "quickNav" });
  }

  it("Ana abre y mira, Beto pide permiso, Cata lee la negativa y la respeta; la caja personal no tiene ninguna acción para abrirse", async () => {
    const r = await running();
    await toBoxes(r);
    const boxes = () => adv(r.code).activities.cajas as BoxesState;
    await r.denied("Ana", { type: "boxes.object.inspect", objectId: "campanita" }, "INVALID_STEP"); // la caja aún está cerrada
    await r.ok("Ana", { type: "boxes.shared.open" });
    await r.denied("Ana", { type: "boxes.permission.ask" }, "INVALID_STEP"); // primero explorar
    await r.ok("Ana", { type: "boxes.object.inspect", objectId: "campanita" });
    await r.denied("Ana", { type: "boxes.object.inspect", objectId: "caja-personal" }, "INVALID_PAYLOAD");
    expect(boxes()).toMatchObject({ step: "askPermission", inspected: ["campanita"], selectedObjectId: "campanita" });

    await r.giveTurn("Beto");
    await r.ok("Beto", { type: "boxes.permission.ask" });
    expect(boxes().step).toBe("refusal");
    await r.denied("Beto", { type: "boxes.refusal.respect" }, "INVALID_STEP"); // no se puede saltar la lectura de la negativa

    await r.giveTurn("Cata");
    await r.ok("Cata", { type: "boxes.refusal.ack" });
    await r.ok("Cata", { type: "boxes.refusal.respect" });
    expect(boxes().step).toBe("nextQuestion");

    // No existe forma de abrir la caja personal: ni acción propia ni un estado donde se guarde su interior (CA-18).
    for (const type of ["boxes.personal.open", "boxes.openPersonal", "openPersonalBox", "setState", "grantPiece"]) {
      const res = await r.who("Cata").rawAdventure(r.who("Cata").adventureEnvelope({ type } as unknown as AdventureAction));
      expect(res, type).toMatchObject({ ok: false });
    }
    expect(JSON.stringify(boxes())).not.toMatch(/personal/i);

    await r.giveTurn("Ana");
    await r.ok("Ana", { type: "boxes.object.inspect", objectId: "piedra" });
    await r.ok("Ana", { type: "record.confirm", activityId: "cajas", field: "question", value: written("¿Cómo se formó la piedra?"), objectId: "piedra" });
    expect(boxes().step).toBe("completed");
    expect(adv(r.code).pieces).toEqual(["lupa", "dialogo", "corazon"]);
    const q = records(r.code, "cajas")[0]!;
    expect(q).toMatchObject({ field: "question", objectId: "piedra" });
    expect(q.authorName).toContain("Ana");
  });

  it("una pregunta sugerida de Cajas trae el objeto de la sugerencia; una escrita sin objeto se rechaza", async () => {
    const r = await running();
    await toBoxes(r);
    await r.ok("Ana", { type: "boxes.shared.open" });
    await r.ok("Ana", { type: "boxes.object.inspect", objectId: "lupa" });
    await r.ok("Ana", { type: "boxes.permission.ask" });
    await r.ok("Ana", { type: "boxes.refusal.ack" });
    await r.ok("Ana", { type: "boxes.refusal.respect" });
    await r.denied("Ana", { type: "record.confirm", activityId: "cajas", field: "question", value: written("¿Por qué?") }, "INVALID_PAYLOAD");
    await r.ok("Ana", { type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "suggested", optionId: "sonido" } });
    expect(records(r.code, "cajas")[0]).toMatchObject({ objectId: "campanita", text: "¿Qué hace que la campanita suene?" });
  });
});

/** Avanza el reloj y deja que el servidor decida (las pruebas no terminan solas sin un tick). */
async function tick1(r: Room, ms: number) {
  await r.tick(ms);
}
