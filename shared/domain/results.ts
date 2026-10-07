import type { ActivityConfig, BoxesActivityConfig, LaboratorioConfig, RampsActivityConfig, ShadowsActivityConfig } from "../contracts/config";
import type { ActivityState, BoxesState, Comparison, ComparisonData, ParticipantState, RampsState, RampTrial, ShadowSample, ShadowsState } from "../contracts/state";

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
    case "boxes":
      return { type: "boxes", inspected: [], askedPermission: false };
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
    case "boxes": {
      const needed = cfg.requiredObjects;
      const n = state?.type === "boxes" ? state.inspected.length : 0;
      return { done: Math.min(n, needed), needed, ready: n >= needed };
    }
  }
}

export function personReadiness(p: ParticipantState | undefined, activityId: string, config: LaboratorioConfig): Readiness {
  const cfg = config.activities[activityId];
  if (!cfg) return { done: 0, needed: 0, ready: false };
  return readiness(p?.activities[activityId], cfg);
}

/**
 * Los resultados de una persona que Vanessa proyecta: una copia (seleccionar no altera el original). En Sombras, sus dos primeras
 * posiciones que cuentan; en Rampas, su prueba más lenta y su prueba más rápida entre las terminadas (el mayor contraste); en La caja,
 * los objetos que exploró y si pidió permiso. `null` si todavía no tiene nada que mostrar.
 */
export function buildComparisonData(p: ParticipantState, activityId: string, config: LaboratorioConfig): ComparisonData | null {
  const cfg = config.activities[activityId];
  const st = p.activities[activityId];
  if (!cfg || !st) return null;
  if (cfg.type === "shadows" && st.type === "shadows") {
    const samples = countedSamples(st)
      .slice(0, (cfg as ShadowsActivityConfig).experiment.requiredSamples)
      .map((s) => ({ distanceCm: s.distanceCm, shadowCm: s.shadowCm }));
    return samples.length > 0 ? { type: "shadows", samples } : null;
  }
  if (cfg.type === "ramps" && st.type === "ramps") {
    const done = finishedTrials(st);
    if (done.length === 0) return null;
    const byAngle = [...done].sort((a, b) => a.angleDeg - b.angleDeg || a.startActiveMs - b.startActiveMs);
    const chosen = byAngle.length >= 2 && byAngle[0]!.angleDeg !== byAngle.at(-1)!.angleDeg ? [byAngle[0]!, byAngle.at(-1)!] : byAngle.slice(0, 1);
    return { type: "ramps", trials: chosen.map((t) => ({ angleDeg: t.angleDeg, durationMs: t.durationMs })) };
  }
  if (cfg.type === "boxes" && st.type === "boxes") {
    const b = st as BoxesState;
    return b.inspected.length > 0 || b.askedPermission ? { type: "boxes", inspected: [...b.inspected], askedPermission: b.askedPermission } : null;
  }
  return null;
}

export function buildComparison(p: ParticipantState, activityId: string, config: LaboratorioConfig, authorId: string, authorName: string): Comparison | null {
  const data = buildComparisonData(p, activityId, config);
  return data ? { activityId, authorId, authorName, data } : null;
}

/** Texto equivalente de una comparación, para lectores de pantalla y para el cuaderno. */
export function describeComparison(c: Comparison, config: LaboratorioConfig): string {
  const d = c.data;
  if (d.type === "shadows") return d.samples.map((s) => `linterna a ${fmt(s.distanceCm)} cm → sombra de ${fmt(s.shadowCm, 1)} cm`).join("; ");
  if (d.type === "ramps") return d.trials.map((t) => `${fmt(t.angleDeg)}° → ${fmt(t.durationMs / 1000, 1)} s`).join("; ");
  const cfg = config.activities[c.activityId] as BoxesActivityConfig | undefined;
  const names = d.inspected.map((id) => cfg?.sharedObjects.find((o) => o.id === id)?.label ?? id);
  return `${names.length > 0 ? `exploró: ${names.join(", ")}` : "no exploró objetos"}${d.askedPermission ? "; pidió permiso para la caja personal" : ""}`;
}

const fmt = (n: number, decimals = 0) => n.toLocaleString("es", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
