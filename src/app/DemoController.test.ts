import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdventureAction } from "../../shared/contracts/actions";
import type { RampsState } from "../../shared/contracts/state";
import { bundle, Driver, finishBoxes, finishRamps, finishShadows } from "../../shared/testing/drive";
import { DEMO_STORAGE_KEY, DemoController, type DemoStorage } from "./DemoController";

// La demostración usa el mismo dominio, sin red y con su propio almacenamiento (SPECS 6.4, CA-32, CT-14).
vi.mock("socket.io-client", () => ({
  io: () => {
    throw new Error("la demostración no debe abrir ningún socket");
  },
}));

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const touched = new Set<string>();
  const storage: DemoStorage & { data: Map<string, string>; touched: Set<string> } = {
    data,
    touched,
    getItem: (k) => (touched.add(k), data.get(k) ?? null),
    setItem: (k, v) => void (touched.add(k), data.set(k, v)),
    removeItem: (k) => void (touched.add(k), data.delete(k)),
  };
  return storage;
};

let now = 0;
const clock = { mono: () => now, now: () => new Date(1_700_000_000_000 + now) };
const make = (storage: DemoStorage | null = null, over: Partial<ConstructorParameters<typeof DemoController>[1]> = {}, b = bundle) => new DemoController(b, { storage, tickMs: 0, ...clock, ...over });
const advance = (c: DemoController, ms: number) => {
  now += ms;
  c.tick();
};
const adv = (c: DemoController) => c.getState().snapshot!.state.adventure;
const rampsState = (c: DemoController) => adv(c).activities.rampas as RampsState;

/** Las acciones del recorrido completo (idénticas a las que usa el dominio en sus pruebas). */
const ok = async (c: DemoController, a: AdventureAction) => {
  const r = await c.adventure(a);
  if (!r.ok) throw new Error(`${a.type}: ${r.code} ${r.message}`);
};
async function shadows(c: DemoController) {
  await ok(c, { type: "station.open", stationId: "sombras", origin: "quickNav" });
  await ok(c, { type: "shadows.surprise.ack" });
  await ok(c, { type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Será por la luz" } });
  await ok(c, { type: "shadows.light.set", distanceCm: 20, commitSample: true });
  await ok(c, { type: "shadows.light.set", distanceCm: 50, commitSample: true });
  await ok(c, { type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "uncertain" } });
  await ok(c, { type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "suggested", optionId: "mover-objeto" } });
  await ok(c, { type: "adventure.returnToMap" });
}
async function ramps(c: DemoController) {
  await ok(c, { type: "station.open", stationId: "rampas", origin: "quickNav" });
  await ok(c, { type: "ramps.question.open" });
  await ok(c, { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "suggested", optionId: "mas-inclinacion" } });
  await ok(c, { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
  for (const angle of [20, 40]) {
    await ok(c, { type: "ramps.angle.set", angleDeg: angle });
    await ok(c, { type: "ramps.trial.start" });
    advance(c, 5000);
  }
  await ok(c, { type: "record.confirm", activityId: "rampas", field: "observation", value: { modality: "written", text: "Con más inclinación llegó antes" } });
  await ok(c, { type: "adventure.returnToMap" });
}
async function boxes(c: DemoController) {
  await ok(c, { type: "station.open", stationId: "cajas", origin: "quickNav" });
  await ok(c, { type: "boxes.shared.open" });
  await ok(c, { type: "boxes.object.inspect", objectId: "campanita" });
  await ok(c, { type: "boxes.permission.ask" });
  await ok(c, { type: "boxes.refusal.ack" });
  await ok(c, { type: "boxes.refusal.respect" });
  await ok(c, { type: "boxes.object.inspect", objectId: "lupa" });
  await ok(c, { type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "suggested", optionId: "aumento" } });
  await ok(c, { type: "adventure.returnToMap" });
}
async function inventor(c: DemoController) {
  await ok(c, { type: "station.open", stationId: "inventor", origin: "quickNav" });
  await ok(c, { type: "inventor.placePieces" });
  await ok(c, { type: "inventor.question.confirm", value: { modality: "written", text: "¿Por qué el hielo flota?" } });
}

afterEach(() => {
  now = 0;
  vi.unstubAllGlobals();
});

describe("DemoController: mismo dominio, sin servidor (CA-32)", () => {
  it("recorre las tres mesas, el inventor y la pregunta final, y llega a `finished` con las tres piezas", async () => {
    const c = make();
    expect(c.getState().summary).toMatchObject({ phase: "running", code: "DEMO", self: { role: "admin", isController: true } });
    await shadows(c);
    await ramps(c);
    await boxes(c);
    await inventor(c);
    expect(c.getState().summary?.phase).toBe("finished");
    expect(adv(c).pieces).toEqual(["lupa", "dialogo", "corazon"]);
    expect(adv(c).notebook.find((r) => r.field === "finalQuestion")?.text).toBe("¿Por qué el hielo flota?");
  });

  it("produce el MISMO resultado que el dominio puro con las mismas acciones (no es otra implementación)", async () => {
    const c = make();
    await shadows(c);
    await ramps(c);
    await boxes(c);
    const d = new Driver();
    finishShadows(d);
    d.do({ type: "adventure.returnToMap" });
    finishRamps(d);
    d.do({ type: "adventure.returnToMap" });
    finishBoxes(d);
    const shape = (a: typeof d.state) => ({ pieces: a.pieces, steps: Object.fromEntries(Object.entries(a.activities).map(([k, v]) => [k, v.step])), fields: a.notebook.map((r) => [r.activityId, r.field]) });
    // Las dos recorren las tres mesas: mismos pasos completados, mismas piezas y los mismos campos confirmados.
    expect(shape(adv(c))).toEqual(shape(d.state));
  });

  it("las reglas del servidor se cumplen: no se salta el orden, y un rechazo avisa con el motivo del dominio", async () => {
    const c = make();
    const r = await c.adventure({ type: "station.open", stationId: "rampas", origin: "quickNav" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_STEP" });
    expect(c.getState().notice).toMatchObject({ kind: "error", text: "Primero hay que completar la mesa anterior." });
    expect(adv(c).view).toEqual({ kind: "map" });
    expect(await c.adventure({ type: "grantPiece" } as unknown as AdventureAction)).toMatchObject({ ok: false });
    expect(adv(c).pieces).toEqual([]);
  });

  it("no abre sockets ni hace peticiones de red en todo el recorrido", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("la demostración no debe usar la red");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("WebSocket", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", fetchSpy);
    const c = make(memoryStorage());
    await shadows(c);
    await ramps(c);
    await boxes(c);
    await inventor(c);
    await c.admin({ type: "room.pause" });
    await c.restart();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("estado y almacenamiento aislados de cualquier sala (CT-14)", () => {
  it("usa solo su clave, sin credenciales ni IDs de sala compartida, y no toca lo de una sala real", async () => {
    const credentialKey = "laboratorio-cosas-cotidianas:v1:sala:ABC234";
    const draftKey = "laboratorio-cosas-cotidianas:v1:borrador:ABC234:sombras:firstIdea";
    const storage = memoryStorage({ [credentialKey]: '{"token":"SECRETO-DE-LA-SALA"}', [draftKey]: "borrador de la sala" });
    storage.touched.clear();
    const c = make(storage);
    await shadows(c);
    await c.restart();
    c.dispose();
    expect([...storage.touched].sort()).toEqual([DEMO_STORAGE_KEY]); // solo su espacio: ni siquiera LEE el de una sala
    expect(storage.data.get(credentialKey)).toBe('{"token":"SECRETO-DE-LA-SALA"}');
    expect(storage.data.get(draftKey)).toBe("borrador de la sala");
    const saved = storage.data.get(DEMO_STORAGE_KEY)!;
    expect(saved).not.toMatch(/token|SECRETO/i);
    expect(JSON.parse(saved).room).toMatchObject({ roomId: "demo", code: "DEMO" });
  });

  it("al reiniciar la demostración solo se borra el avance de la demostración", async () => {
    const storage = memoryStorage({ otraClave: "intacta" });
    const c = make(storage);
    await shadows(c);
    expect(adv(c).notebook.length).toBeGreaterThan(0);
    await c.restart();
    expect(adv(c).notebook).toEqual([]);
    expect(c.getState().summary).toMatchObject({ phase: "running", roomGeneration: 2 });
    expect(adv(c).view).toEqual({ kind: "map" });
    expect(storage.data.get("otraClave")).toBe("intacta");
  });

  it("recargar la página conserva lo confirmado, vuelve en pausa y no suma el tiempo transcurrido", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await shadows(a);
    await ok(a, { type: "station.open", stationId: "rampas", origin: "quickNav" });
    await ok(a, { type: "ramps.question.open" });
    await ok(a, { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    await ok(a, { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    await ok(a, { type: "ramps.trial.start" });
    advance(a, 1000);
    const activeBefore = adv(a).timeline.activeMs;
    a.dispose();

    now += 10 * 60_000; // diez minutos con la pestaña cerrada
    const b = make(storage);
    expect(adv(b).notebook.map((r) => r.field)).toEqual(adv(a).notebook.map((r) => r.field));
    expect(b.getState().summary).toMatchObject({ phase: "paused", controller: { displayName: "Vanessa" } });
    expect(Math.abs(adv(b).timeline.activeMs - activeBefore)).toBeLessThan(1500);
    expect(rampsState(b).trials[0]!.state).toBe("running");
    await b.admin({ type: "room.resume" });
    advance(b, 60_000);
    expect(rampsState(b).trials[0]).toMatchObject({ state: "finished" });
    expect(rampsState(b).trials[0]!.endedActiveMs! - rampsState(b).trials[0]!.startActiveMs).toBe(rampsState(b).trials[0]!.durationMs);
  });

  it("si el contenido cambió (otro hash), o lo guardado está dañado, o el almacenamiento falla, empieza de cero sin romperse", async () => {
    const storage = memoryStorage();
    const a = make(storage);
    await shadows(a);
    a.dispose();
    const changed = { ...bundle, configHash: "otro-contenido" };
    expect(adv(make(storage, {}, changed)).notebook).toEqual([]);
    storage.data.set(DEMO_STORAGE_KEY, "{no es json");
    expect(adv(make(storage)).notebook).toEqual([]);
    storage.data.set(DEMO_STORAGE_KEY, JSON.stringify({ v: 1, configHash: bundle.configHash, mapHash: bundle.mapHash, room: { roomId: "otra-sala", code: "XYZ789" } }));
    expect(adv(make(storage)).notebook).toEqual([]);
    const broken: DemoStorage = { getItem: () => { throw new Error("sin almacenamiento"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => undefined };
    const c = make(broken);
    await shadows(c);
    expect(adv(c).notebook.length).toBeGreaterThan(0); // sigue funcionando en memoria
  });
});

describe("reloj y pausa de la demostración (CA-11)", () => {
  it("pausar congela la prueba; reanudar no suma la conversación y termina en su instante exacto", async () => {
    const c = make();
    await shadows(c);
    await ok(c, { type: "station.open", stationId: "rampas", origin: "quickNav" });
    await ok(c, { type: "ramps.question.open" });
    await ok(c, { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    await ok(c, { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    await ok(c, { type: "ramps.trial.start" });
    const t = () => rampsState(c).trials[0]!;
    advance(c, 1000);
    expect(await c.admin({ type: "room.pause" })).toMatchObject({ ok: true });
    const frozen = adv(c).timeline.activeMs;
    advance(c, 90_000); // charla larga
    expect(adv(c).timeline.activeMs).toBe(frozen);
    expect(t().state).toBe("running");
    expect(await c.adventure({ type: "adventure.returnToMap" })).toMatchObject({ ok: false, code: "ROOM_PAUSED" });
    await c.admin({ type: "room.resume" });
    advance(c, t().durationMs - 1000 - 1);
    expect(t().state).toBe("running");
    advance(c, 2);
    expect(t()).toMatchObject({ state: "finished", endedActiveMs: t().startActiveMs + t().durationMs });
  });

  it("emite muestras visuales (frames) mientras algo se mueve y ninguna en pausa", async () => {
    const c = make();
    await shadows(c);
    await ok(c, { type: "station.open", stationId: "rampas", origin: "quickNav" });
    await ok(c, { type: "ramps.question.open" });
    await ok(c, { type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    await ok(c, { type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    const frames: Array<{ frameSeq: number; trial: { elapsedMs: number } | null }> = [];
    c.subscribeFrames((f) => frames.push(f));
    await ok(c, { type: "ramps.trial.start" });
    for (let i = 0; i < 5; i++) advance(c, 100);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames.map((f) => f.frameSeq)).toEqual([...frames.map((f) => f.frameSeq)].sort((a, b) => a - b));
    expect(frames.at(-1)!.trial!.elapsedMs).toBeGreaterThan(frames[0]!.trial!.elapsedMs);
    await c.admin({ type: "room.pause" });
    const n = frames.length;
    for (let i = 0; i < 5; i++) advance(c, 100);
    expect(frames.length).toBe(n);
  });

  it("el movimiento de Vanessa se simula igual: un destino termina por reloj sin servidor", async () => {
    const c = make();
    const spawn = adv(c).player.feet;
    const target = { x: bundle.map.stations[0]!.point.x, y: bundle.map.stations[0]!.point.y };
    await ok(c, { type: "player.moveTo", target });
    expect(adv(c).player.plan).not.toBeNull();
    advance(c, 60_000);
    expect(adv(c).player.plan).toBeNull();
    expect(Math.hypot(adv(c).player.feet.x - target.x, adv(c).player.feet.y - target.y)).toBeLessThan(2);
    expect(adv(c).player.feet).not.toEqual(spawn);
  });
});
