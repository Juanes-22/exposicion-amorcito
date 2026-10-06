import { describe, expect, it } from "vitest";
import type { RoomState } from "../contracts/state";
import { bundle, Driver, finishShadows, openStation } from "../testing/drive";
import { buildSimulationFrame, findRunningTrial, isSimulating } from "./frames";
import { createRoomState } from "./room";

const { config, map } = bundle;
const running = (adventure = createRoomState({ roomId: "r", code: "ABC234", config, map, configHash: "h", mapHash: "m", nowIso: "2026-10-05T00:00:00.000Z" }).adventure): RoomState => ({
  ...createRoomState({ roomId: "r", code: "ABC234", config, map, configHash: "h", mapHash: "m", nowIso: "2026-10-05T00:00:00.000Z" }),
  phase: "running",
  controlOwner: { role: "participant", principalId: "p1" },
  adventure,
});

describe("simulation.frame", () => {
  it("sin plan ni prueba no hay nada que simular ni frame que enviar", () => {
    const room = running();
    expect(isSimulating(room)).toBe(false);
    expect(buildSimulationFrame(room, 1000, 1)).toBeNull();
  });

  it("con un plan en marcha emite posición, orientación, versiones y secuencia", () => {
    const d = new Driver();
    d.do({ type: "player.moveTo", target: map.stations[0]!.point });
    const room = { ...running(d.state), turnVersion: 4, stateVersion: 9, roomGeneration: 2 };
    expect(isSimulating(room)).toBe(true);
    const f = buildSimulationFrame(room, 500, 7)!;
    expect(f).toMatchObject({ roomGeneration: 2, turnVersion: 4, stateVersion: 9, frameSeq: 7, activeMs: 500, trial: null, player: { moving: true, planId: "m1" } });
    expect(f.player.feet).not.toEqual(map.spawns[config.world.initialSpawnId]); // ya se movió respecto del spawn
  });

  it("al terminar el plan deja de haber frame; los frames avanzan de forma monótona hacia el destino", () => {
    const d = new Driver();
    const target = map.stations[1]!.point;
    d.do({ type: "player.moveTo", target });
    const room = running(d.state);
    let prev = Infinity;
    for (let t = 0; t <= 3000; t += 250) {
      const f = buildSimulationFrame(room, t, t);
      if (!f) break;
      const dist = Math.hypot(f.player.feet.x - target.x, f.player.feet.y - target.y);
      expect(dist).toBeLessThanOrEqual(prev + 1e-9);
      prev = dist;
    }
    expect(buildSimulationFrame(room, 600_000, 1)).toBeNull();
  });

  it("con una prueba de rampa en marcha informa el tiempo transcurrido, acotado a su duración", () => {
    const d = new Driver();
    finishShadows(d);
    openStation(d, "rampas");
    d.do({ type: "ramps.question.open" });
    d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    d.do({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    d.do({ type: "ramps.angle.set", angleDeg: 30 });
    d.do({ type: "ramps.trial.start" });
    const room = running(d.state);
    const trial = findRunningTrial(room.adventure)!;
    expect(isSimulating(room)).toBe(true);
    expect(buildSimulationFrame(room, d.activeMs + 700, 1)!.trial).toEqual({ trialId: trial.trialId, elapsedMs: 700, durationMs: trial.durationMs });
    expect(buildSimulationFrame(room, d.activeMs + 999_999, 1)!.trial!.elapsedMs).toBe(trial.durationMs);
  });

  it("pausa o sin propietario congelan la simulación aunque haya un plan", () => {
    const d = new Driver();
    d.do({ type: "player.moveTo", target: map.stations[0]!.point });
    expect(isSimulating({ ...running(d.state), phase: "paused", resumePhase: "running" })).toBe(false);
    expect(isSimulating({ ...running(d.state), controlOwner: null })).toBe(false);
  });
});
