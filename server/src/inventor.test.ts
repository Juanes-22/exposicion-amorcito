import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdventureAction, CommandResult } from "../../shared/contracts/actions";
import type { RampsState } from "../../shared/contracts/state";
import { setupRoom, startServer, TestClient, type TestServer } from "./testing/harness";

// P5: piezas derivadas, inventor, final, revisitas y reinicio de sala, con Socket.IO real, SQLite temporal y reloj controlado.

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
const adv = (code: string) => state(code).adventure;
const persisted = (code: string) => server.app.repo.loadRooms().rooms.find((r) => r.state.code === code)!.state;

async function running() {
  const r = await setupRoom(server, ["Ana", "Beto"]);
  for (const c of r.clients) track(c);
  const people = { Ana: r.people[0]!, Beto: r.people[1]! };
  const who = (n: keyof typeof people) => people[n].client;
  const giveTurn = async (n: keyof typeof people) => {
    expect(await r.admin.admin({ type: "control.assign", principalId: people[n].join.principalId })).toMatchObject({ ok: true });
    await who(n).until(() => who(n).summary?.self.isController === true && who(n).turnVersion === state(r.code).turnVersion, `${n} tiene el turno`);
  };
  await giveTurn("Ana");
  await r.admin.admin({ type: "room.start" });
  await who("Ana").until(() => who("Ana").summary?.phase === "running", "sala en curso");
  const ok = async (n: keyof typeof people, a: AdventureAction) => expect(await who(n).adventure(a), `${n}: ${JSON.stringify(a)}`).toMatchObject({ ok: true });
  const denied = async (n: keyof typeof people, a: AdventureAction, code: string): Promise<CommandResult> => {
    const res = await who(n).adventure(a);
    expect(res, `${n}: ${JSON.stringify(a)}`).toMatchObject({ ok: false, code });
    return res;
  };
  /** Espera a que el cliente de `n` conozca la versión de turno vigente (pausar, reanudar o empezar la suben). */
  const settle = (n: keyof typeof people) => who(n).until(() => who(n).turnVersion === state(r.code).turnVersion, `${n} al día con el turno`);
  const tick = async (ms: number) => {
    now += ms;
    await server.app.service.tick();
  };
  return { ...r, people, who, giveTurn, settle, ok, denied, tick };
}
type Room = Awaited<ReturnType<typeof running>>;

/** Recorre las tres mesas con el dominio, repartiendo registros entre Ana y Beto. */
async function completeAllTables(r: Room) {
  await r.ok("Ana", { type: "station.open", stationId: "sombras", origin: "quickNav" });
  await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Por la luz" } });
  await r.ok("Ana", { type: "shadows.light.set", distanceCm: 15, commitSample: true });
  await r.ok("Ana", { type: "shadows.light.set", distanceCm: 45, commitSample: true });
  await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "written", text: "De cerca es más grande" } });
  await r.ok("Ana", { type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "written", text: "¿Y si movemos el objeto?" } });
  await r.ok("Ana", { type: "adventure.returnToMap" });
  await r.ok("Ana", { type: "station.open", stationId: "rampas", origin: "quickNav" });
  await r.ok("Ana", { type: "ramps.question.open" });
  await r.ok("Ana", { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
  await r.giveTurn("Beto");
  await r.ok("Beto", { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } });
  await r.ok("Beto", { type: "ramps.angle.set", angleDeg: 15 });
  await r.ok("Beto", { type: "ramps.trial.start" });
  await r.tick((adv(r.code).activities.rampas as RampsState).trials[0]!.durationMs + 1);
  await r.ok("Beto", { type: "ramps.angle.set", angleDeg: 35 });
  await r.ok("Beto", { type: "ramps.trial.start" });
  await r.tick((adv(r.code).activities.rampas as RampsState).trials[1]!.durationMs + 1);
  await r.ok("Beto", { type: "record.confirm", activityId: "rampas", field: "observation", value: { modality: "written", text: "Con 35° llegó antes" } });
  await r.ok("Beto", { type: "adventure.returnToMap" });
  await r.ok("Beto", { type: "station.open", stationId: "cajas", origin: "quickNav" });
  await r.ok("Beto", { type: "boxes.shared.open" });
  await r.ok("Beto", { type: "boxes.object.inspect", objectId: "lupa" });
  await r.ok("Beto", { type: "boxes.permission.ask" });
  await r.ok("Beto", { type: "boxes.refusal.ack" });
  await r.ok("Beto", { type: "boxes.refusal.respect" });
  await r.ok("Beto", { type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "suggested", optionId: "aumento" } });
  await r.ok("Beto", { type: "adventure.returnToMap" });
}

describe("piezas derivadas (P5-02, CA-22)", () => {
  it("no existe un comando para otorgar piezas; llegan solas al completar cada mesa, una vez, y el inventor se habilita con las tres", async () => {
    const r = await running();
    expect(adv(r.code).pieces).toEqual([]);
    for (const type of ["inventor.grantPiece", "grantPiece", "pieces.set"]) {
      const res = await r.who("Ana").rawAdventure(r.who("Ana").adventureEnvelope({ type } as unknown as AdventureAction));
      expect(res, type).toMatchObject({ ok: false });
    }
    await r.denied("Ana", { type: "station.open", stationId: "inventor", origin: "quickNav" }, "INVALID_STEP"); // sin las tres piezas
    await completeAllTables(r);
    expect(adv(r.code).pieces).toEqual(["lupa", "dialogo", "corazon"]);
    expect(persisted(r.code).adventure.pieces).toEqual(["lupa", "dialogo", "corazon"]);
  });
});

describe("inventor y final (P5-03, CA-22, CA-23)", () => {
  it("colocar las piezas es de quien tiene el turno y ocurre una sola vez; la pregunta final llega después y termina la aventura", async () => {
    const r = await running();
    await completeAllTables(r);
    await r.ok("Beto", { type: "station.open", stationId: "inventor", origin: "quickNav" });
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "oral" } }, "INVALID_STEP"); // primero las piezas
    await r.denied("Ana", { type: "inventor.placePieces" }, "NOT_AUTHORIZED");
    await r.ok("Beto", { type: "inventor.placePieces" });
    expect(adv(r.code).inventor.piecesPlaced).toBe(true);
    const version = state(r.code).stateVersion;
    await r.denied("Beto", { type: "inventor.placePieces" }, "INVALID_STEP"); // repetirlo no vuelve a colocar nada
    expect(state(r.code).stateVersion).toBe(version);

    // El turno cambia entre colocar y elegir: la pregunta la confirma otra persona.
    await r.giveTurn("Ana");
    expect(state(r.code).phase).toBe("running");
    const saved = adv(r.code).notebook.find((x) => x.field === "nextQuestion")!;
    await r.ok("Ana", { type: "inventor.question.confirm", value: { modality: "saved", recordId: saved.id } });
    const final = adv(r.code).notebook.find((x) => x.field === "finalQuestion")!;
    expect(final).toMatchObject({ activityId: "inventor", modality: "written", text: "¿Y si movemos el objeto?", sourceRecordId: saved.id });
    expect(final.authorName).toContain("Ana");
    expect(adv(r.code).inventor.finalQuestionId).toBe(final.id);
    expect(state(r.code).phase).toBe("finished");
    expect(persisted(r.code).phase).toBe("finished");

    // Reenviar o cambiar la pregunta final no la reemplaza ni la duplica.
    const after = state(r.code).stateVersion;
    await r.denied("Ana", { type: "inventor.question.confirm", value: { modality: "written", text: "otra" } }, "INVALID_STEP");
    expect(state(r.code).stateVersion).toBe(after);
    expect(adv(r.code).notebook.filter((x) => x.field === "finalQuestion")).toHaveLength(1);
  });

  it("valida la pregunta final: texto vacío o largo, sugerencia inexistente y «guardada» que no es una pregunta se rechazan", async () => {
    const r = await running();
    await completeAllTables(r);
    await r.ok("Beto", { type: "station.open", stationId: "inventor", origin: "quickNav" });
    await r.ok("Beto", { type: "inventor.placePieces" });
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "written", text: "   " } }, "INVALID_PAYLOAD");
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "written", text: "x".repeat(281) } }, "INVALID_PAYLOAD");
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "suggested", optionId: "no-existe" } }, "INVALID_PAYLOAD");
    const observation = adv(r.code).notebook.find((x) => x.field === "observation")!;
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "saved", recordId: observation.id } }, "INVALID_PAYLOAD");
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "saved", recordId: "r999" } }, "INVALID_PAYLOAD");
    await r.denied("Beto", { type: "inventor.question.confirm", value: { modality: "uncertain" } as never }, "INVALID_PAYLOAD");
    expect(adv(r.code).inventor.finalQuestionId).toBeUndefined();
    expect(state(r.code).phase).toBe("running");
  });

  it("el final oral no necesita texto: queda registrado como oral y también termina la aventura", async () => {
    const r = await running();
    await completeAllTables(r);
    await r.ok("Beto", { type: "station.open", stationId: "inventor", origin: "quickNav" });
    await r.ok("Beto", { type: "inventor.placePieces" });
    await r.ok("Beto", { type: "inventor.question.confirm", value: { modality: "oral" } });
    expect(adv(r.code).notebook.find((x) => x.field === "finalQuestion")).toMatchObject({ modality: "oral", text: null });
    expect(state(r.code).phase).toBe("finished");
  });
});

describe("revisitas y reinicios (P5-04, CA-23)", () => {
  async function finished() {
    const r = await running();
    await completeAllTables(r);
    await r.ok("Beto", { type: "station.open", stationId: "inventor", origin: "quickNav" });
    await r.ok("Beto", { type: "inventor.placePieces" });
    await r.ok("Beto", { type: "inventor.question.confirm", value: { modality: "suggested", optionId: "mas-inclinacion" } });
    return r;
  }

  it("en `finished` se puede revisitar y explorar una mesa completada sin conceder otra pieza ni tocar la pregunta final", async () => {
    const r = await finished();
    const before = JSON.stringify({ pieces: adv(r.code).pieces, notebook: adv(r.code).notebook, final: adv(r.code).inventor });
    await r.ok("Beto", { type: "adventure.returnToMap" });
    await r.ok("Beto", { type: "station.open", stationId: "sombras", origin: "quickNav" });
    await r.ok("Beto", { type: "shadows.light.set", distanceCm: 33, commitSample: true }); // explorar de nuevo
    await r.denied("Beto", { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } }, "INVALID_STEP"); // no se reabren los pasos
    await r.ok("Beto", { type: "adventure.returnToMap" });
    await r.ok("Beto", { type: "station.open", stationId: "rampas", origin: "quickNav" });
    await r.ok("Beto", { type: "ramps.trial.start" });
    await r.tick(60_000);
    expect(state(r.code).phase).toBe("finished");
    const after = { pieces: adv(r.code).pieces, notebook: adv(r.code).notebook, final: adv(r.code).inventor };
    expect(adv(r.code).pieces).toEqual(["lupa", "dialogo", "corazon"]); // sin copias
    expect(JSON.stringify(after.final)).toBe(JSON.stringify(JSON.parse(before).final));
    expect(JSON.stringify(after.notebook)).toBe(JSON.stringify(JSON.parse(before).notebook)); // los registros no cambian solos
    expect(JSON.stringify(after.pieces)).toBe(JSON.stringify(JSON.parse(before).pieces));
  });

  it("en `finished` se puede corregir un registro (con la revisión esperada), pero no la pregunta final", async () => {
    const r = await finished();
    const obs = adv(r.code).notebook.find((x) => x.field === "observation" && x.activityId === "sombras")!;
    await r.ok("Beto", { type: "record.edit", recordId: obs.id, expectedRevision: 1, value: { modality: "written", text: "De cerca la sombra crece" } });
    await r.denied("Beto", { type: "record.edit", recordId: obs.id, expectedRevision: 1, value: { modality: "written", text: "revisión vieja" } }, "REVISION_CONFLICT");
    const edited = adv(r.code).notebook.find((x) => x.id === obs.id)!;
    expect(edited).toMatchObject({ revision: 2, text: "De cerca la sombra crece" });
    expect(edited.history[0]).toMatchObject({ revision: 1, text: "De cerca es más grande" });
    const final = adv(r.code).notebook.find((x) => x.field === "finalQuestion")!;
    await r.denied("Beto", { type: "record.edit", recordId: final.id, expectedRevision: 1, value: { modality: "written", text: "cambiada" } }, "INVALID_STEP");
  });

  it("pausar y reanudar en `finished` vuelve a `finished`", async () => {
    const r = await finished();
    await r.admin.admin({ type: "room.pause" });
    expect(state(r.code).phase).toBe("paused");
    await r.settle("Beto");
    await r.denied("Beto", { type: "adventure.returnToMap" }, "ROOM_PAUSED");
    await r.admin.admin({ type: "room.resume" });
    expect(state(r.code).phase).toBe("finished");
  });

  it("reiniciar la sala borra avance, registros y piezas, conserva a las personas, y un mensaje viejo ya no sirve", async () => {
    const r = await finished();
    const ids = [r.people.Ana.join.principalId, r.people.Beto.join.principalId];
    const oldEnvelope = r.who("Beto").adventureEnvelope({ type: "adventure.returnToMap" }); // armado con la generación 1
    expect(await r.admin.admin({ type: "room.reset", confirm: true })).toMatchObject({ ok: true });
    const s = state(r.code);
    expect(s).toMatchObject({ phase: "welcome", roomGeneration: 2, controlOwner: null });
    expect(s.adventure.notebook).toEqual([]);
    expect(s.adventure.pieces).toEqual([]);
    expect(s.adventure.inventor).toEqual({ piecesPlaced: false });
    expect(s.adventure.view).toEqual({ kind: "map" });
    expect(persisted(r.code).roomGeneration).toBe(2);
    // Las personas siguen en la sala con sus credenciales.
    await r.admin.until(() => r.admin.presence?.participants.length === 2, "participantes conservados");
    expect(r.admin.presence!.participants.map((p) => p.principalId).sort()).toEqual([...ids].sort());
    // Un mensaje de la aventura anterior no se aplica a la nueva.
    expect(await r.who("Beto").rawAdventure(oldEnvelope)).toMatchObject({ ok: false });
    expect(state(r.code).adventure.view).toEqual({ kind: "map" });
    // Y el recorrido vuelve a empezar desde cero: el inventor sigue bloqueado.
    await r.giveTurn("Ana");
    await r.admin.admin({ type: "room.start" });
    await r.settle("Ana");
    await r.denied("Ana", { type: "station.open", stationId: "inventor", origin: "quickNav" }, "INVALID_STEP");
  });
});
