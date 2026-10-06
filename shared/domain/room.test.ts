import { describe, expect, it } from "vitest";
import type { AdminAction } from "../contracts/actions";
import type { RoomState } from "../contracts/state";
import * as drive from "../testing/drive";
import { bundle, Driver, finishBoxes, finishRamps, finishShadows } from "../testing/drive";
import { applyAdminAction, applyAdventureAction, checkGeneration, checkTurn, createRoomState, isPlayable, expireRoom, onAdminLost, onControllerLost, recoverAfterRestart, tickRoom, type PresenceView, type RoomChange } from "./room";

const { config, map, nav } = bundle;
const connected = new Set<string>(["admin", "p1", "p2", "p3"]);
const presence: PresenceView = { isConnected: (id) => connected.has(id), isParticipant: (id) => id.startsWith("p") };
const adminCtx = { adminId: "admin", presence, config, map, fingerprint: { configHash: bundle.configHash, mapHash: bundle.mapHash } };
const mk = (): RoomState => createRoomState({ roomId: "room-1", code: "ABC234", config, map, configHash: bundle.configHash, mapHash: bundle.mapHash, nowIso: "2026-10-05T12:00:00.000Z" });
const admin = (room: RoomState, action: AdminAction): RoomState => {
  const r = applyAdminAction(room, action, adminCtx);
  if (!r.ok) throw new Error(`${action.type}: ${r.code} ${r.message}`);
  return r.room;
};
const refused = (r: RoomChange) => (r.ok ? "ok" : r.code);
const adventureCtx = (room: RoomState) => ({ config, map, nav, actor: { principalId: room.controlOwner!.principalId, role: room.controlOwner!.role === "admin" ? ("admin" as const) : ("participant" as const), name: "Ana" }, roomGeneration: room.roomGeneration, nowIso: "2026-10-05T12:01:00.000Z", activeMs: room.adventure.timeline.activeMs });

const running = (): RoomState => admin(admin(mk(), { type: "control.assign", principalId: "p1" }), { type: "room.start" });

describe("sala nueva", () => {
  it("empieza en bienvenida, sin propietario, generación 1 y huellas de configuración y mapa", () => {
    const r = mk();
    expect(r).toMatchObject({ phase: "welcome", resumePhase: null, controlOwner: null, roomGeneration: 1, contentSetId: "laboratorio-cosas-cotidianas", configRevision: config.configRevision });
    expect(r.configHash).toBe(bundle.configHash);
    expect(r.mapHash).toBe(bundle.mapHash);
  });
  it("ni credenciales ni sockets forman parte del estado (invariante 7)", () => {
    expect(JSON.stringify(mk())).not.toMatch(/token|secret|socket|credential/i);
  });
});

describe("comenzar y turnos", () => {
  it("no se puede comenzar sin controlador elegido ni con el controlador desconectado", () => {
    expect(refused(applyAdminAction(mk(), { type: "room.start" }, adminCtx))).toBe("INVALID_STEP");
    const withOwner = admin(mk(), { type: "control.assign", principalId: "p1" });
    connected.delete("p1");
    expect(refused(applyAdminAction(withOwner, { type: "room.start" }, adminCtx))).toBe("INVALID_STEP");
    connected.add("p1");
    expect(admin(withOwner, { type: "room.start" }).phase).toBe("running");
  });
  it("dar control reemplaza atómicamente al propietario, sube turnVersion y habilita a uno solo (CA-07)", () => {
    const a = running();
    const b = admin(a, { type: "control.assign", principalId: "p2" });
    expect(b.controlOwner).toEqual({ role: "participant", principalId: "p2" });
    expect(b.turnVersion).toBe(a.turnVersion + 1);
    expect(b.phase).toBe("running");
    expect(checkTurn(b, "p1", b.turnVersion)?.code).toBe("NOT_AUTHORIZED");
    expect(checkTurn(b, "p2", b.turnVersion)).toBeNull();
  });
  it("selecciones administrativas rápidas conservan la última confirmada y nunca dejan dos propietarios (CA-10)", () => {
    let room = running();
    for (const id of ["p2", "p3", "p1", "p2", "p3"]) {
      room = admin(room, { type: "control.assign", principalId: id });
      expect([room.controlOwner].filter(Boolean)).toHaveLength(1);
    }
    expect(room.controlOwner).toEqual({ role: "participant", principalId: "p3" });
  });
  it("solo se asigna a un participante conectado de esta sala: no a la administradora, ajenos ni desconectados", () => {
    expect(refused(applyAdminAction(mk(), { type: "control.assign", principalId: "admin" }, adminCtx))).toBe("INVALID_PAYLOAD");
    expect(refused(applyAdminAction(mk(), { type: "control.assign", principalId: "otra-sala" }, adminCtx))).toBe("INVALID_PAYLOAD");
    connected.delete("p2");
    expect(refused(applyAdminAction(mk(), { type: "control.assign", principalId: "p2" }, adminCtx))).toBe("INVALID_PAYLOAD");
    connected.add("p2");
  });
  it("asignar al mismo propietario no cambia nada (sin versión nueva)", () => {
    const a = running();
    const r = applyAdminAction(a, { type: "control.assign", principalId: "p1" }, adminCtx);
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.ok && r.room).toBe(a);
  });
  it("tomar control habilita a Vanessa y revoca al participante (CA-13)", () => {
    const a = running();
    const b = admin(a, { type: "control.take" });
    expect(b.controlOwner).toEqual({ role: "admin", principalId: "admin" });
    expect(b.turnVersion).toBe(a.turnVersion + 1);
    expect(checkTurn(b, "p1", b.turnVersion)?.code).toBe("NOT_AUTHORIZED");
    expect(checkTurn(b, "admin", b.turnVersion)).toBeNull();
  });
});

describe("pausa", () => {
  it("pausar conserva al propietario, congela el reloj y bloquea las acciones (ROOM_PAUSED)", () => {
    const a = running();
    const p = admin(a, { type: "room.pause" });
    expect(p).toMatchObject({ phase: "paused", resumePhase: "running", controlOwner: { principalId: "p1" } });
    expect(isPlayable(p)).toBe(false);
    expect(refused(applyAdventureAction(p, { type: "station.open", stationId: "sombras", origin: "quickNav" }, adventureCtx(p)))).toBe("ROOM_PAUSED");
    expect(tickRoom(p, 99_999, config).changed).toBe(false);
  });
  it("dar o tomar control durante la pausa no reanuda (CA-12)", () => {
    const p = admin(running(), { type: "room.pause" });
    const q = admin(p, { type: "control.assign", principalId: "p2" });
    expect(q).toMatchObject({ phase: "paused", resumePhase: "running", controlOwner: { principalId: "p2" } });
    const t = admin(q, { type: "control.take" });
    expect(t.phase).toBe("paused");
  });
  it("reanudar vuelve a la fase anterior y exige propietario conectado", () => {
    const p = admin(running(), { type: "room.pause" });
    expect(admin(p, { type: "room.resume" })).toMatchObject({ phase: "running", resumePhase: null });
    const noOwner = admin(p, { type: "control.revoke" });
    expect(refused(applyAdminAction(noOwner, { type: "room.resume" }, adminCtx))).toBe("INVALID_STEP");
    connected.delete("p1");
    expect(refused(applyAdminAction(p, { type: "room.resume" }, adminCtx))).toBe("INVALID_STEP");
    connected.add("p1");
  });
  it("pausar tiene sentido solo en curso o terminada, y no dos veces", () => {
    expect(refused(applyAdminAction(mk(), { type: "room.pause" }, adminCtx))).toBe("INVALID_STEP");
    const p = admin(running(), { type: "room.pause" });
    expect(refused(applyAdminAction(p, { type: "room.pause" }, adminCtx))).toBe("INVALID_STEP");
    expect(refused(applyAdminAction(running(), { type: "room.resume" }, adminCtx))).toBe("INVALID_STEP");
  });
  it("pausar y reanudar una aventura terminada regresa a «finished»", () => {
    const f = { ...running(), phase: "finished" as const };
    const p = admin(f, { type: "room.pause" });
    expect(p.resumePhase).toBe("finished");
    expect(admin(p, { type: "room.resume" }).phase).toBe("finished");
  });
  it("retirar control deja el propietario vacío y pausa una aventura en curso; en bienvenida solo retira", () => {
    const r = admin(running(), { type: "control.revoke" });
    expect(r).toMatchObject({ controlOwner: null, phase: "paused", resumePhase: "running" });
    const w = admin(admin(mk(), { type: "control.assign", principalId: "p1" }), { type: "control.revoke" });
    expect(w).toMatchObject({ controlOwner: null, phase: "welcome" });
  });
});

describe("acciones de aventura y su autorización", () => {
  it("solo el propietario actúa; el turno antiguo y la generación antigua se rechazan sin tocar el progreso (CA-08, CA-09)", () => {
    const a = running();
    const b = admin(a, { type: "control.assign", principalId: "p2" });
    expect(checkTurn(b, "p1", a.turnVersion)?.code).toBe("STALE_TURN"); // llegó tarde, con el turno anterior
    expect(checkTurn(b, "p3", b.turnVersion)?.code).toBe("NOT_AUTHORIZED"); // espera
    expect(checkGeneration(b, b.roomGeneration + 1)?.code).toBe("STALE_GENERATION");
    expect(checkGeneration(b, b.roomGeneration)).toBeNull();
  });
  it("en bienvenida no hay aventura que jugar", () => {
    const w = admin(mk(), { type: "control.assign", principalId: "p1" });
    expect(refused(applyAdventureAction(w, { type: "station.open", stationId: "sombras", origin: "quickNav" }, adventureCtx(w)))).toBe("INVALID_STEP");
  });
  it("una acción válida sube stateVersion; una sin cambios no", () => {
    const a = running();
    const r = applyAdventureAction(a, { type: "station.open", stationId: "sombras", origin: "quickNav" }, adventureCtx(a));
    expect(r).toMatchObject({ ok: true, changed: true });
    if (r.ok) {
      expect(r.room.stateVersion).toBe(a.stateVersion + 1);
      expect(r.room.adventure.view).toEqual({ kind: "activity", activityId: "sombras" });
      expect(a.adventure.view).toEqual({ kind: "map" }); // la sala anterior no se mutó
      const again = applyAdventureAction(r.room, { type: "adventure.returnToMap" }, adventureCtx(r.room));
      expect(again).toMatchObject({ ok: true, changed: true });
    }
    const noop = applyAdventureAction(a, { type: "adventure.returnToMap" }, adventureCtx(a));
    expect(noop).toMatchObject({ ok: true, changed: false });
  });
  it("confirmar la pregunta final cambia la fase a «finished» en la misma transición", () => {
    let room = running();
    const exec = (action: Parameters<typeof applyAdventureAction>[1]) => {
      const r = applyAdventureAction(room, action, adventureCtx(room));
      if (!r.ok) throw new Error(`${action.type}: ${r.code} ${r.message}`);
      room = r.room;
      return r;
    };
    // Atajo: completa las tres mesas escribiendo directamente el estado derivado de un recorrido real.
    const d = new Driver();
    finishShadows(d);
    finishRamps(d);
    finishBoxes(d);
    room = { ...room, adventure: d.state };
    exec({ type: "adventure.returnToMap" });
    exec({ type: "station.open", stationId: "inventor", origin: "quickNav" });
    exec({ type: "inventor.placePieces" });
    expect(room.phase).toBe("running");
    const r = exec({ type: "inventor.question.confirm", value: { modality: "oral" } });
    expect(room.phase).toBe("finished");
    expect(r.effects.map((e) => e.kind)).toEqual(["adventure.finished"]);
    // Aún se permiten revisitas en «finished».
    exec({ type: "adventure.returnToMap" });
    expect(applyAdventureAction(room, { type: "station.open", stationId: "rampas", origin: "quickNav" }, adventureCtx(room)).ok).toBe(true);
  });
});


describe("reiniciar y cerrar", () => {
  it("reiniciar avance vuelve a bienvenida, sube la generación, quita el control y borra el avance (CT-12)", () => {
    let room = running();
    const r = applyAdventureAction(room, { type: "station.open", stationId: "sombras", origin: "quickNav" }, adventureCtx(room));
    if (r.ok) room = r.room;
    const reset = admin(room, { type: "room.reset", confirm: true });
    expect(reset).toMatchObject({ phase: "welcome", controlOwner: null, roomGeneration: room.roomGeneration + 1 });
    expect(reset.adventure.view).toEqual({ kind: "map" });
    expect(reset.adventure.notebook).toEqual([]);
    expect(reset.stateVersion).toBeGreaterThan(room.stateVersion); // la versión de estado nunca retrocede
    expect(reset.turnVersion).toBeGreaterThan(room.turnVersion);
    expect(checkGeneration(reset, room.roomGeneration)?.code).toBe("STALE_GENERATION"); // mensajes del recorrido anterior
  });
  it("cerrar revoca el control y toda acción posterior es ROOM_UNAVAILABLE (CA-29)", () => {
    const closed = admin(running(), { type: "room.close", confirm: true });
    expect(closed).toMatchObject({ phase: "closed", controlOwner: null });
    for (const action of [{ type: "room.start" }, { type: "control.take" }, { type: "room.reset", confirm: true }] as AdminAction[]) expect(refused(applyAdminAction(closed, action, adminCtx))).toBe("ROOM_UNAVAILABLE");
    expect(refused(applyAdventureAction(closed, { type: "adventure.returnToMap" }, adventureCtx({ ...closed, controlOwner: { role: "admin", principalId: "admin" } })))).toBe("ROOM_UNAVAILABLE");
    expect(checkGeneration(closed, closed.roomGeneration)?.code).toBe("ROOM_UNAVAILABLE");
  });
});

describe("desconexiones y recuperación", () => {
  it("el controlador que pierde conexión pausa y pierde el control (CA-24); sin propietario no hay cambio", () => {
    const r = onControllerLost(running());
    expect(r).toMatchObject({ ok: true, changed: true, room: { phase: "paused", controlOwner: null, resumePhase: "running" } });
    expect(onControllerLost(mk())).toMatchObject({ ok: true, changed: false });
  });
  it("si Vanessa pierde la conexión se pausa y se conserva el propietario; no se cede la administración", () => {
    const r = onAdminLost(running());
    expect(r).toMatchObject({ ok: true, changed: true, room: { phase: "paused", controlOwner: { principalId: "p1" } } });
    expect(onAdminLost(mk())).toMatchObject({ ok: true, changed: false });
  });
  it("tras reiniciar el servicio la sala queda pausada, sin propietario y con turnVersion nuevo (CA-27)", () => {
    const a = running();
    const r = recoverAfterRestart(a);
    expect(r).toMatchObject({ phase: "paused", resumePhase: "running", controlOwner: null });
    expect(r.turnVersion).toBeGreaterThan(a.turnVersion);
    expect(recoverAfterRestart(mk())).toMatchObject({ phase: "welcome", controlOwner: null });
    expect(recoverAfterRestart({ ...a, phase: "closed" })).toMatchObject({ phase: "closed" });
  });
});

describe("vencimiento por inactividad (SPECS 6.3)", () => {
  it("deja la sala terminal y sin propietario en una sola transición, sea cual sea la fase", () => {
    for (const room of [mk(), running(), admin(running(), { type: "room.pause" })]) {
      const r = expireRoom(room);
      expect(r).toMatchObject({ ok: true, changed: true });
      if (!r.ok) continue;
      expect(r.room).toMatchObject({ phase: "expired", controlOwner: null, resumePhase: null });
      expect(r.room.stateVersion).toBe(room.stateVersion + 1);
      expect(r.room.turnVersion).toBe(room.turnVersion + 1); // un turno anterior ya no sirve
      expect(isPlayable(r.room)).toBe(false);
    }
  });
  it("no toca el avance, los registros ni las piezas (los datos se conservan hasta la limpieza)", () => {
    const room = running();
    const r = expireRoom(room);
    expect(r.ok && r.room.adventure).toEqual(room.adventure);
  });
  it("una sala ya terminal no vuelve a cambiar (vencer dos veces no sube versiones)", () => {
    const first = expireRoom(running());
    if (!first.ok) throw new Error("no venció");
    expect(expireRoom(first.room)).toMatchObject({ ok: true, changed: false, room: first.room });
    const closed = admin(running(), { type: "room.close", confirm: true });
    expect(expireRoom(closed)).toMatchObject({ changed: false, room: closed });
  });
  it("tras vencer, todo comando se rechaza con «la sala venció» y reiniciar o cerrar ya no son posibles", () => {
    const r = expireRoom(running());
    if (!r.ok) throw new Error("no venció");
    for (const action of [{ type: "room.start" }, { type: "control.take" }, { type: "room.pause" }, { type: "room.reset", confirm: true }, { type: "room.close", confirm: true }] as AdminAction[]) {
      const res = applyAdminAction(r.room, action, adminCtx);
      expect(refused(res), action.type).toBe("ROOM_UNAVAILABLE");
      expect(!res.ok && res.message).toMatch(/venció/);
    }
    expect(checkGeneration(r.room, r.room.roomGeneration)).toMatchObject({ code: "ROOM_UNAVAILABLE", message: expect.stringMatching(/venció/) });
  });
});

describe("reloj", () => {
  it("avanza solo con la sala jugable: con pausa o sin propietario no pasa el tiempo", () => {
    const a = running();
    const t = tickRoom(a, 1000, config);
    expect(t.room.adventure.timeline.activeMs).toBe(1000);
    expect(t.changed).toBe(false); // solo pasó el tiempo: no es progreso, no sube stateVersion
    expect(t.room.stateVersion).toBe(a.stateVersion);
    for (const frozen of [admin(a, { type: "room.pause" }), admin(a, { type: "control.revoke" }), mk()]) {
      const r = tickRoom(frozen, 5000, config);
      expect(r.room).toBe(frozen);
      expect(r.changed).toBe(false);
    }
  });
  it("termina la prueba de rampa en su instante exacto y eso sí es progreso", () => {
    const { Driver, finishShadows } = drive;
    const d = new Driver();
    finishShadows(d);
    d.state.view = { kind: "map" };
    d.do({ type: "station.open", stationId: "rampas", origin: "quickNav" });
    d.do({ type: "ramps.question.open" });
    d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    d.do({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    d.do({ type: "ramps.trial.start" });
    const room: RoomState = { ...running(), adventure: d.state };
    const before = tickRoom(room, d.activeMs + 100, config);
    expect(before.changed).toBe(false);
    const after = tickRoom(room, d.activeMs + 60_000, config);
    expect(after.changed).toBe(true);
    expect(after.room.stateVersion).toBe(room.stateVersion + 1);
    const trial = (after.room.adventure.activities.rampas as any).trials[0];
    expect(trial).toMatchObject({ state: "finished", endedActiveMs: trial.startActiveMs + trial.durationMs });
  });
});
