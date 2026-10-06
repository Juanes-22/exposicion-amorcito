import type { SimulationFrame } from "../contracts/events";
import type { AdventureState, RampTrial, RoomState } from "../contracts/state";
import { playerAt, runningTrial } from "./adventure";
import { isPlayable } from "./room";

/** La prueba de rampa en marcha, de la mesa que sea (solo hay una a la vez). */
export function findRunningTrial(adv: AdventureState): RampTrial | undefined {
  for (const st of Object.values(adv.activities)) {
    if (st.type !== "ramps") continue;
    const t = runningTrial(st);
    if (t) return t;
  }
  return undefined;
}

/** ¿Hay algo que simular? Solo con la sala jugable (pausa o sin propietario congelan el reloj) y un plan o una prueba en marcha. */
export function isSimulating(room: RoomState): boolean {
  return isPlayable(room) && (room.adventure.player.plan !== null || findRunningTrial(room.adventure) !== undefined);
}

/**
 * Muestra visual efímera (SPECS 5.6): reloj, movimiento y prueba actuales. No es un comando confirmado; los snapshots siempre
 * permiten reconstruir el estado sin haber recibido todos los frames. `null` si no hay nada en movimiento en ese instante.
 */
export function buildSimulationFrame(room: RoomState, activeMs: number, frameSeq: number): SimulationFrame | null {
  const adv = room.adventure;
  const p = playerAt(adv, activeMs);
  const trial = findRunningTrial(adv);
  if (!p.moving && !trial) return null;
  return {
    roomGeneration: room.roomGeneration,
    turnVersion: room.turnVersion,
    stateVersion: room.stateVersion,
    frameSeq,
    activeMs,
    player: { feet: p.feet, facing: p.facing, moving: p.moving, planId: adv.player.plan?.planId ?? null },
    trial: trial ? { trialId: trial.trialId, elapsedMs: Math.min(Math.max(0, activeMs - trial.startActiveMs), trial.durationMs), durationMs: trial.durationMs } : null,
  };
}
