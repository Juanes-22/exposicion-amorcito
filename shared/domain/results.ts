import type { ActivityConfig, LaboratorioConfig, RampsActivityConfig } from "../contracts/config";
import type { ActivityState, ParticipantState, RampsState, RampTrial, ShadowSample, ShadowsState } from "../contracts/state";
import { REQUIRED_TARGETS, startView } from "./telescope";

/**
 * Resultados personales y criterios de finalización (propuesta de rondas, secciones 5–7). «Listo para conversar» se deduce de los
 * resultados que el servidor ya registró: nadie lo marca a mano ni lo confirma. Es monótono: seguir probando no lo quita.
 */

const EPS = 1e-9;

export const countedSamples = (s: ShadowsState): ShadowSample[] => s.samples.filter((x) => x.counts);
export const finishedTrials = (s: RampsState): RampTrial[] => s.trials.filter((t) => t.state === "finished");
export const runningTrial = (s: RampsState): RampTrial | undefined => s.trials.find((t) => t.state === "running");

/** Al menos `requiredTrials` pruebas terminadas, con inclinaciones que difieren al menos `minDistinctAngleDeg`. */
export function hasComparableTrials(r: RampsState, cfg: RampsActivityConfig): boolean {
  const done = finishedTrials(r);
  if (done.length < cfg.experiment.requiredTrials) return false;
  const angles = done.map((t) => t.angleDeg);
  return Math.max(...angles) - Math.min(...angles) >= cfg.experiment.minDistinctAngleDeg - EPS;
}

export function emptyActivityState(cfg: ActivityConfig): ActivityState {
  switch (cfg.type) {
    case "shadows":
      return { type: "shadows", samples: [] };
    case "ramps":
      return { type: "ramps", trials: [] };
    case "telescope":
      return { type: "telescope", ...startView(cfg.experiment), observed: [], curtain: "open" };
  }
}

export interface Readiness {
  done: number;
  needed: number;
  ready: boolean;
}

/** Cuánto lleva una persona de la exploración de una mesa y si ya cumplió el criterio de finalización. */
export function readiness(state: ActivityState | undefined, cfg: ActivityConfig): Readiness {
  switch (cfg.type) {
    case "shadows": {
      const needed = cfg.experiment.requiredSamples;
      const n = state?.type === "shadows" ? countedSamples(state).length : 0;
      return { done: Math.min(n, needed), needed, ready: n >= needed };
    }
    case "ramps": {
      const needed = cfg.experiment.requiredTrials;
      const st = state?.type === "ramps" ? state : undefined;
      const n = st ? finishedTrials(st).length : 0;
      const ready = st ? hasComparableTrials(st, cfg) : false;
      // Con las pruebas suficientes pero sin inclinaciones diferentes todavía falta una: no se muestra «2 de 2» sin estar lista.
      return { done: ready ? needed : Math.min(n, Math.max(0, needed - 1)), needed, ready };
    }
    case "telescope": {
      // La Luna y el grupo de estrellas. La galaxia es un hallazgo aparte, y encontrar la casa o la cortina no cuenta: no es un
      // requisito ni una respuesta.
      const needed = REQUIRED_TARGETS.length;
      const n = state?.type === "telescope" ? state.observed.filter((t) => REQUIRED_TARGETS.includes(t)).length : 0;
      return { done: Math.min(n, needed), needed, ready: n >= needed };
    }
  }
}

export function personReadiness(p: ParticipantState | undefined, activityId: string, config: LaboratorioConfig): Readiness {
  const cfg = config.activities[activityId];
  if (!cfg) return { done: 0, needed: 0, ready: false };
  return readiness(p?.activities[activityId], cfg);
}
