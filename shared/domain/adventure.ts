import type { LaboratorioConfig, ActivityConfig, BoxesActivityConfig, RampsActivityConfig, ShadowsActivityConfig, SuggestedOption } from "../contracts/config";
import { INVENTOR_ID } from "../contracts/config";
import type { AdventureAction, FinalQuestionInput, RecordValueInput } from "../contracts/actions";
import type { EffectEvent, Role } from "../contracts/events";
import type { Point } from "../contracts/geometry";
import type { MapIndex } from "../config/tmj";
import type {
  ActivityState,
  AdventureState,
  BoxesState,
  Modality,
  NotebookRecord,
  RampsState,
  RampTrial,
  RecordField,
} from "../contracts/state";
import { createPlan, samplePlan } from "./movement";
import { rampDurationMs } from "./models";
import { findPath, isFootprintFree, type NavGrid } from "./navigation";
import { normalizeRecordText } from "./text";

/**
 * Dominio de la aventura: transiciones PURAS (SPECS 4, 5.4). Sin React, Phaser, sockets, almacenamiento ni reloj propio: el
 * servidor pasa el reloj activo y la hora en `DomainContext`. Ninguna función muta su entrada: si la persistencia falla, el estado
 * anterior sigue intacto. No existe acción de cliente para conceder piezas ni fijar resultados: se derivan aquí.
 */

export interface Actor {
  principalId: string;
  role: Role;
  /** Nombre visible, con su distinción, en el momento de la acción. */
  name: string;
}

export interface DomainContext {
  config: LaboratorioConfig;
  map: MapIndex;
  nav: NavGrid;
  actor: Actor;
  roomGeneration: number;
  /** Hora del servidor (ISO) de esta transición. */
  nowIso: string;
  /** Reloj de simulación (ms) al procesar: solo avanza mientras la sala puede jugar. */
  activeMs: number;
}

export type DomainErrorCode = "INVALID_STEP" | "INVALID_PAYLOAD" | "REVISION_CONFLICT";
export type ReduceResult =
  | { ok: true; adventure: AdventureState; effects: EffectEvent[]; changed: boolean; finishRoom: boolean }
  | { ok: false; code: DomainErrorCode; message: string };

const fail = (code: DomainErrorCode, message: string): ReduceResult => ({ ok: false, code, message });
const EPS = 1e-9;

// ---- estado inicial y consultas ------------------------------------------------------

export function createInitialAdventure(config: LaboratorioConfig, map: MapIndex): AdventureState {
  const spawn = map.spawns[config.world.initialSpawnId];
  if (!spawn) throw new Error(`No existe el Spawn «${config.world.initialSpawnId}»`);
  const activities: Record<string, ActivityState> = {};
  for (const [id, a] of Object.entries(config.activities)) activities[id] = initialActivityState(a);
  return {
    mapId: map.mapId,
    player: { feet: { ...spawn }, facing: "down", plan: null },
    view: { kind: "map" },
    activities,
    notebook: [],
    pieces: [],
    inventor: { piecesPlaced: false },
    timeline: { activeMs: 0 },
    counters: { record: 0, trial: 0, plan: 0 },
  };
}

function initialActivityState(a: ActivityConfig): ActivityState {
  switch (a.type) {
    case "shadows":
      return { type: "shadows", step: "surprise", distanceCm: Math.round((a.experiment.sourceDistanceMinCm + a.experiment.sourceDistanceMaxCm) / 2), samples: [] };
    case "ramps":
      return { type: "ramps", step: "closedAnswer", angleDeg: a.experiment.minAngleDeg, trials: [] };
    case "boxes":
      return { type: "boxes", step: "exploreShared", sharedOpen: false, inspected: [] };
  }
}

export const isCompleted = (adv: AdventureState, activityId: string): boolean => adv.activities[activityId]?.step === "completed";

/** Orden del recorrido: la siguiente mesa se habilita al completar la anterior; las completadas se pueden revisitar. */
export function unlockedActivityIds(adv: AdventureState, config: LaboratorioConfig): string[] {
  const out: string[] = [];
  for (let i = 0; i < config.route.length; i++) {
    const id = config.route[i]!;
    if (i === 0 || isCompleted(adv, config.route[i - 1]!)) out.push(id);
    else break;
  }
  return out;
}

export const allRouteCompleted = (adv: AdventureState, config: LaboratorioConfig): boolean => config.route.every((id) => isCompleted(adv, id));

/** Piezas derivadas de las mesas completadas, en orden de recorrido. Nunca provienen del cliente (invariante 4). */
export const derivePieces = (adv: AdventureState, config: LaboratorioConfig): string[] =>
  config.route.filter((id) => isCompleted(adv, id)).map((id) => (config.activities[id] as ActivityConfig).pieceId);

export const currentActivityId = (adv: AdventureState): string | null => (adv.view.kind === "activity" ? adv.view.activityId : null);

/** Posición y orientación del personaje en un instante de reloj activo. */
export function playerAt(adv: AdventureState, activeMs: number) {
  const { player } = adv;
  if (!player.plan) return { feet: player.feet, facing: player.facing, moving: false };
  const s = samplePlan(player.plan, activeMs, player.facing);
  return { feet: s.feet, facing: s.facing, moving: !s.done };
}

export const runningTrial = (r: RampsState): RampTrial | undefined => r.trials.find((t) => t.state === "running");
export const finishedTrials = (r: RampsState): RampTrial[] => r.trials.filter((t) => t.state === "finished");

// ---- reloj: movimiento y pruebas ------------------------------------------------------

/**
 * Lleva el estado hasta `activeMs`: termina el movimiento y las pruebas de rampa cuya hora llegó. El final de una prueba se
 * decide aquí, una sola vez y en su instante exacto (no en el instante en que se procese). El reloj nunca retrocede.
 */
export function advanceTime(adv: AdventureState, activeMs: number, config: LaboratorioConfig): AdventureState {
  const out = structuredClone(adv);
  settle(out, activeMs, config);
  return out;
}

function settle(adv: AdventureState, activeMs: number, config: LaboratorioConfig): boolean {
  let changed = false;
  if (activeMs > adv.timeline.activeMs) {
    adv.timeline.activeMs = activeMs;
    changed = true;
  }
  const now = adv.timeline.activeMs;
  if (adv.player.plan) {
    const s = samplePlan(adv.player.plan, now, adv.player.facing);
    if (s.done) {
      adv.player = { feet: s.feet, facing: s.facing, plan: null };
      changed = true;
    }
  }
  for (const [id, st] of Object.entries(adv.activities)) {
    if (st.type !== "ramps") continue;
    const trial = runningTrial(st);
    if (trial && now >= trial.startActiveMs + trial.durationMs) {
      trial.state = "finished";
      trial.endedActiveMs = trial.startActiveMs + trial.durationMs;
      changed = true;
      const cfg = config.activities[id] as RampsActivityConfig | undefined;
      if (cfg && st.step === "trials" && hasComparableTrials(st, cfg)) st.step = "observation";
    }
  }
  return changed;
}

/** Al menos `requiredTrials` pruebas terminadas, con inclinaciones que difieren al menos `minDistinctAngleDeg`. */
export function hasComparableTrials(r: RampsState, cfg: RampsActivityConfig): boolean {
  const done = finishedTrials(r);
  if (done.length < cfg.experiment.requiredTrials) return false;
  const angles = done.map((t) => t.angleDeg);
  return Math.max(...angles) - Math.min(...angles) >= cfg.experiment.minDistinctAngleDeg - EPS;
}

// ---- reglas de registro por campo ------------------------------------------------------

interface FieldRule {
  modalities: readonly Modality[];
  /** Lista de sugerencias de la configuración aplicable al campo. */
  suggestions?: (cfg: ActivityConfig) => SuggestedOption[];
}

const ALL: readonly Modality[] = ["written", "suggested", "oral", "uncertain"];
const NO_SUGGESTED: readonly Modality[] = ["written", "oral", "uncertain"];
const QUESTION: readonly Modality[] = ["written", "suggested", "oral"];

/** Combinaciones válidas por campo (SPECS 3.1): incertidumbre satisface idea, predicción y observación; la pregunta nueva no la admite. */
export const FIELD_RULES: Record<string, FieldRule> = {
  "shadows.firstIdea": { modalities: ALL, suggestions: (c) => (c as ShadowsActivityConfig).ideaSuggestions },
  "shadows.observation": { modalities: NO_SUGGESTED },
  "shadows.nextQuestion": { modalities: QUESTION, suggestions: (c) => c.suggestions },
  "ramps.question": { modalities: QUESTION, suggestions: (c) => c.suggestions },
  "ramps.prediction": { modalities: NO_SUGGESTED },
  "ramps.observation": { modalities: NO_SUGGESTED },
  "boxes.question": { modalities: QUESTION, suggestions: (c) => c.suggestions },
};

const ruleFor = (type: ActivityConfig["type"], field: RecordField): FieldRule | undefined => FIELD_RULES[`${type}.${field}`];

type ResolvedValue = { ok: true; modality: Modality; text: string | null; optionId?: string; objectId?: string } | { ok: false; message: string };

function resolveValue(value: RecordValueInput, modalities: readonly Modality[], suggestions: readonly SuggestedOption[], maxChars: number): ResolvedValue {
  if (!modalities.includes(value.modality)) return { ok: false, message: "Esa forma de responder no está disponible en este paso." };
  switch (value.modality) {
    case "written": {
      const t = normalizeRecordText(value.text, maxChars);
      return t.ok ? { ok: true, modality: "written", text: t.value } : { ok: false, message: t.message };
    }
    case "suggested": {
      const option = suggestions.find((o) => o.id === value.optionId);
      // El servidor resuelve el texto: el cliente solo envía el ID de una opción existente del proyecto.
      return option ? { ok: true, modality: "suggested", text: option.text, optionId: option.id, ...(option.objectId ? { objectId: option.objectId } : {}) } : { ok: false, message: "Esa sugerencia no existe." };
    }
    case "oral":
      return { ok: true, modality: "oral", text: null };
    case "uncertain":
      return { ok: true, modality: "uncertain", text: null };
  }
}

// ---- transición principal ---------------------------------------------------------------

export function reduceAdventure(input: AdventureState, action: AdventureAction, ctx: DomainContext): ReduceResult {
  const adv = structuredClone(input);
  const effects: EffectEvent[] = [];
  settle(adv, ctx.activeMs, ctx.config);

  const result = apply(adv, action, ctx, effects);
  if (result) return result;

  adv.pieces = derivePieces(adv, ctx.config);
  const finishRoom = effects.some((e) => e.kind === "adventure.finished");
  // El reloj avanza solo por pasar el tiempo: no cuenta como cambio. Se persiste junto con la siguiente transición real o en un checkpoint.
  const sameButClock = (a: AdventureState) => JSON.stringify({ ...a, timeline: null });
  return { ok: true, adventure: adv, effects, changed: sameButClock(adv) !== sameButClock(input), finishRoom };
}

/** Aplica la acción sobre la copia de trabajo. Devuelve un error, o `undefined` si la transición es válida. */
function apply(adv: AdventureState, action: AdventureAction, ctx: DomainContext, effects: EffectEvent[]): ReduceResult | undefined {
  const { config } = ctx;
  const activityId = currentActivityId(adv);
  const activityCfg = activityId ? config.activities[activityId] : undefined;
  const state = activityId ? adv.activities[activityId] : undefined;

  /** La acción exige la mesa abierta de un tipo concreto. */
  const need = <T extends ActivityConfig["type"]>(type: T): { id: string; cfg: Extract<ActivityConfig, { type: T }>; st: Extract<ActivityState, { type: T }> } | ReduceResult => {
    if (!activityId || !activityCfg || !state || activityCfg.type !== type || state.type !== type) return fail("INVALID_STEP", "Esta acción no corresponde a la mesa abierta.");
    return { id: activityId, cfg: activityCfg as Extract<ActivityConfig, { type: T }>, st: state as Extract<ActivityState, { type: T }> };
  };
  const isFail = (v: unknown): v is ReduceResult => typeof v === "object" && v !== null && "ok" in v;

  switch (action.type) {
    // ---- mapa ----
    case "player.moveTo": {
      if (adv.view.kind !== "map") return fail("INVALID_STEP", "Vuelve al mapa para moverte.");
      const here = playerAt(adv, adv.timeline.activeMs).feet;
      const fp = config.world.player.footprint;
      if (!isFootprintFree(ctx.map, fp, action.target)) return fail("INVALID_PAYLOAD", "Ese punto no se puede pisar. Toca un lugar libre del laboratorio.");
      const path = findPath(ctx.map, fp, ctx.nav, here, action.target);
      if (!path) return fail("INVALID_PAYLOAD", "No hay camino hasta ese punto.");
      if (path.length < 2) {
        adv.player = { feet: here, facing: adv.player.facing, plan: null };
        return;
      }
      adv.player = { feet: here, facing: adv.player.facing, plan: createPlan(`m${++adv.counters.plan}`, path, config.world.playerSpeed, adv.timeline.activeMs) };
      return;
    }
    case "station.open": {
      if (adv.view.kind !== "map") {
        const same = (action.stationId === INVENTOR_ID && adv.view.kind === "final") || (adv.view.kind === "activity" && adv.view.activityId === action.stationId);
        return same ? undefined : fail("INVALID_STEP", "Vuelve al mapa antes de abrir otra mesa.");
      }
      const isInventor = action.stationId === INVENTOR_ID;
      if (!isInventor && !config.route.includes(action.stationId)) return fail("INVALID_PAYLOAD", "Esa mesa no existe.");
      if (isInventor ? !allRouteCompleted(adv, config) : !unlockedActivityIds(adv, config).includes(action.stationId)) {
        return fail("INVALID_STEP", isInventor ? "Primero hay que completar las tres mesas." : "Primero hay que completar la mesa anterior.");
      }
      if (action.origin === "map") {
        const point = isInventor ? ctx.map.inventor?.point : ctx.map.stations.find((s) => s.activityId === action.stationId)?.point;
        const radius = isInventor ? ctx.map.inventor?.interactionRadius : ctx.map.stations.find((s) => s.activityId === action.stationId)?.interactionRadius;
        if (!point || radius === undefined) return fail("INVALID_PAYLOAD", "Esa mesa no está en el mapa.");
        const here = playerAt(adv, adv.timeline.activeMs).feet;
        if (Math.hypot(here.x - point.x, here.y - point.y) > radius) return fail("INVALID_STEP", "Acércate a la mesa para abrirla.");
      }
      // El personaje se detiene donde está; la actividad conserva su avance.
      adv.player = { feet: playerAt(adv, adv.timeline.activeMs).feet, facing: adv.player.facing, plan: null };
      adv.view = isInventor ? { kind: "final" } : { kind: "activity", activityId: action.stationId };
      return;
    }
    case "adventure.returnToMap": {
      adv.view = { kind: "map" };
      return;
    }

    // ---- Sombras ----
    case "shadows.surprise.ack": {
      const n = need("shadows");
      if (isFail(n)) return n;
      if (n.st.step !== "surprise") return fail("INVALID_STEP", "La sorpresa ya se vio.");
      n.st.step = "firstIdea";
      return;
    }
    case "shadows.light.set": {
      const n = need("shadows");
      if (isFail(n)) return n;
      const e = n.cfg.experiment;
      if (n.st.step === "surprise" || n.st.step === "firstIdea") return fail("INVALID_STEP", "Primero comparte tu primera idea.");
      if (!Number.isFinite(action.distanceCm) || action.distanceCm < e.sourceDistanceMinCm - EPS || action.distanceCm > e.sourceDistanceMaxCm + EPS) {
        return fail("INVALID_PAYLOAD", `La linterna debe estar entre ${e.sourceDistanceMinCm} y ${e.sourceDistanceMaxCm} cm del objeto.`);
      }
      n.st.distanceCm = action.distanceCm;
      // Un cambio continuo se comparte, pero solo termina el gesto o se confirma la posición cuenta como muestra.
      if (action.commitSample && n.st.step === "explore") {
        const counted = n.st.samples.filter((s) => s.counts);
        const counts = counted.every((s) => Math.abs(s.distanceCm - action.distanceCm) >= e.minDistinctDistanceCm - EPS);
        n.st.samples.push({ distanceCm: action.distanceCm, counts, atActiveMs: adv.timeline.activeMs, authorId: ctx.actor.principalId });
        if (n.st.samples.filter((s) => s.counts).length >= e.requiredSamples) n.st.step = "observation";
      }
      return;
    }

    // ---- registros ----
    case "record.confirm":
      return confirmRecord(adv, action, ctx, effects);
    case "record.edit":
      return editRecord(adv, action, ctx);

    // ---- Rampas ----
    case "ramps.question.open": {
      const n = need("ramps");
      if (isFail(n)) return n;
      if (n.st.step !== "closedAnswer") return fail("INVALID_STEP", "La pregunta ya está abierta.");
      n.st.step = "question";
      return;
    }
    case "ramps.angle.set": {
      const n = need("ramps");
      if (isFail(n)) return n;
      if (n.st.step !== "trials" && n.st.step !== "observation" && n.st.step !== "completed") return fail("INVALID_STEP", "Primero hay que preguntar y predecir.");
      if (runningTrial(n.st)) return fail("INVALID_STEP", "Espera a que termine la prueba.");
      const e = n.cfg.experiment;
      const steps = (action.angleDeg - e.minAngleDeg) / e.angleStepDeg;
      if (!Number.isFinite(action.angleDeg) || action.angleDeg < e.minAngleDeg - EPS || action.angleDeg > e.maxAngleDeg + EPS || Math.abs(steps - Math.round(steps)) > 1e-6) {
        return fail("INVALID_PAYLOAD", `La inclinación debe estar entre ${e.minAngleDeg}° y ${e.maxAngleDeg}°, de ${e.angleStepDeg}° en ${e.angleStepDeg}°.`);
      }
      n.st.angleDeg = action.angleDeg;
      return;
    }
    case "ramps.trial.start": {
      const n = need("ramps");
      if (isFail(n)) return n;
      if (n.st.step !== "trials" && n.st.step !== "observation" && n.st.step !== "completed") return fail("INVALID_STEP", "Primero hay que preguntar y predecir.");
      if (runningTrial(n.st)) return fail("INVALID_STEP", "Ya hay una prueba en marcha.");
      const e = n.cfg.experiment;
      // El servidor asigna el ID, calcula la duración y congela las condiciones; el cliente no envía resultados.
      n.st.trials.push({
        trialId: `t${++adv.counters.trial}`,
        angleDeg: n.st.angleDeg,
        model: e.model,
        lengthMeters: e.lengthMeters,
        visualTimeScale: e.visualTimeScale,
        durationMs: rampDurationMs(n.st.angleDeg, e.lengthMeters, e.visualTimeScale),
        startActiveMs: adv.timeline.activeMs,
        state: "running",
        startedBy: ctx.actor.principalId,
      });
      return;
    }

    // ---- La caja de las sorpresas ----
    case "boxes.shared.open": {
      const n = need("boxes");
      if (isFail(n)) return n;
      n.st.sharedOpen = true;
      return;
    }
    case "boxes.object.inspect": {
      const n = need("boxes");
      if (isFail(n)) return n;
      if (!n.cfg.sharedObjects.some((o) => o.id === action.objectId)) return fail("INVALID_PAYLOAD", "Ese objeto no está en la caja compartida.");
      if (!n.st.sharedOpen) return fail("INVALID_STEP", "Abre primero la caja para explorar.");
      n.st.selectedObjectId = action.objectId;
      if (!n.st.inspected.includes(action.objectId)) n.st.inspected.push(action.objectId);
      if (n.st.step === "exploreShared") n.st.step = "askPermission";
      return;
    }
    case "boxes.permission.ask": {
      const n = need("boxes");
      if (isFail(n)) return n;
      if (n.st.step !== "askPermission") return fail("INVALID_STEP", "Todavía no es momento de pedir permiso.");
      n.st.step = "refusal";
      return;
    }
    case "boxes.refusal.ack": {
      const n = need("boxes");
      if (isFail(n)) return n;
      if (n.st.step !== "refusal") return fail("INVALID_STEP", "No hay una respuesta que leer.");
      n.st.step = "respect";
      return;
    }
    case "boxes.refusal.respect": {
      const n = need("boxes");
      if (isFail(n)) return n;
      if (n.st.step !== "respect") return fail("INVALID_STEP", "Primero hay que leer la respuesta.");
      n.st.step = "nextQuestion";
      return;
    }

    // ---- reinicio del experimento: repone controles; no borra cuaderno, primera idea, pruebas terminadas ni piezas ----
    case "experiment.reset": {
      if (!activityId || !activityCfg || !state) return fail("INVALID_STEP", "Abre una mesa para reiniciar su experimento.");
      const fresh = initialActivityState(activityCfg);
      if (state.type === "shadows" && fresh.type === "shadows") state.distanceCm = fresh.distanceCm;
      if (state.type === "ramps" && fresh.type === "ramps") {
        state.angleDeg = fresh.angleDeg;
        const trial = runningTrial(state);
        // Una prueba en curso se marca cancelada: no cuenta como completada.
        if (trial) {
          trial.state = "cancelled";
          trial.endedActiveMs = adv.timeline.activeMs;
        }
      }
      if (state.type === "boxes") delete (state as BoxesState).selectedObjectId;
      return;
    }

    // ---- Inventor ----
    case "inventor.placePieces": {
      if (adv.view.kind !== "final") return fail("INVALID_STEP", "Abre la máquina del inventor primero.");
      if (adv.inventor.piecesPlaced) return fail("INVALID_STEP", "Las piezas ya están colocadas.");
      const have = derivePieces(adv, config);
      if (!config.inventor.requiredPieceIds.every((p) => have.includes(p))) return fail("INVALID_STEP", "Faltan piezas por conseguir.");
      adv.inventor.piecesPlaced = true;
      effects.push({ effectId: `${ctx.roomGeneration}:pieces.placed`, kind: "pieces.placed" });
      return;
    }
    case "inventor.question.confirm":
      return confirmFinalQuestion(adv, action.value, ctx, effects);

    default: {
      // Exhaustividad: añadir una acción al catálogo sin tratarla aquí es un error de tipos. En ejecución, cualquier acción que
      // no esté en el catálogo (setState, grantPiece, setResult, openPersonalBox…) se rechaza en vez de aceptarse sin efecto.
      const unknown: never = action;
      return fail("INVALID_PAYLOAD", `Acción desconocida: ${String((unknown as { type?: unknown }).type)}`);
    }
  }
}

// ---- confirmar y editar registros -------------------------------------------------------

function newRecord(adv: AdventureState, ctx: DomainContext, activityId: string, field: RecordField, v: Extract<ResolvedValue, { ok: true }>, extra: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: `r${++adv.counters.record}`,
    activityId,
    field,
    modality: v.modality,
    text: v.text,
    ...(v.optionId ? { optionId: v.optionId } : {}),
    ...(v.objectId ? { objectId: v.objectId } : {}),
    ...extra,
    authorId: ctx.actor.principalId,
    authorName: ctx.actor.name,
    revision: 1,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
    history: [],
  };
}

function confirmRecord(adv: AdventureState, action: Extract<AdventureAction, { type: "record.confirm" }>, ctx: DomainContext, effects: EffectEvent[]): ReduceResult | undefined {
  const { config } = ctx;
  const cfg = config.activities[action.activityId];
  const st = adv.activities[action.activityId];
  if (!cfg || !st) return fail("INVALID_PAYLOAD", "Esa mesa no existe.");
  if (adv.view.kind !== "activity" || adv.view.activityId !== action.activityId) return fail("INVALID_STEP", "Abre la mesa para compartir tu respuesta.");
  const rule = ruleFor(cfg.type, action.field);
  if (!rule) return fail("INVALID_STEP", "Ese registro no corresponde a esta mesa.");

  // El campo debe corresponder al paso actual; si no, no se salta ni se adelanta ningún paso.
  const wants = expectedField(st);
  if (!wants || wants.field !== action.field) return fail("INVALID_STEP", "Ese registro no corresponde a este paso.");
  const v = resolveValue(action.value, rule.modalities, rule.suggestions?.(cfg) ?? [], config.ui.maxRecordCharacters);
  if (!v.ok) return fail("INVALID_PAYLOAD", v.message);

  let objectId = v.objectId;
  if (st.type === "boxes") {
    const shared = (cfg as BoxesActivityConfig).sharedObjects;
    if (action.objectId !== undefined && v.objectId !== undefined && action.objectId !== v.objectId) return fail("INVALID_PAYLOAD", "La pregunta sugerida es sobre otro objeto.");
    objectId = v.objectId ?? action.objectId;
    if (!objectId || !shared.some((o) => o.id === objectId)) return fail("INVALID_PAYLOAD", "Elige un objeto compartido para tu pregunta.");
  } else if (action.objectId !== undefined) {
    return fail("INVALID_PAYLOAD", "Solo las preguntas de la caja llevan un objeto.");
  }

  const record = newRecord(adv, ctx, action.activityId, action.field, v, objectId ? { objectId } : {});
  adv.notebook.push(record);
  const complete = () => completeActivity(adv, action.activityId, ctx, effects);

  switch (st.type) {
    case "shadows":
      if (action.field === "firstIdea") {
        st.firstIdeaId = record.id;
        st.step = "explore";
      } else if (action.field === "observation") {
        st.observationId = record.id;
        st.step = "nextQuestion";
      } else {
        st.questionId = record.id;
        st.conditions = {
          screenDistanceCm: (cfg as ShadowsActivityConfig).experiment.screenDistanceCm,
          objectHeightCm: (cfg as ShadowsActivityConfig).experiment.objectHeightCm,
          sampleDistancesCm: st.samples.filter((s) => s.counts).map((s) => s.distanceCm),
        };
        complete();
      }
      return;
    case "ramps":
      if (action.field === "question") {
        st.questionId = record.id;
        st.step = "prediction";
      } else if (action.field === "prediction") {
        st.predictionId = record.id;
        st.step = "trials";
      } else {
        st.observationId = record.id;
        complete();
      }
      return;
    case "boxes":
      st.questionId = record.id;
      complete();
      return;
  }
}

/** Qué registro espera cada paso (el único que se puede confirmar ahora). */
function expectedField(st: ActivityState): { field: RecordField } | null {
  switch (st.type) {
    case "shadows":
      return st.step === "surprise" || st.step === "firstIdea" ? { field: "firstIdea" } : st.step === "observation" ? { field: "observation" } : st.step === "nextQuestion" ? { field: "nextQuestion" } : null;
    case "ramps":
      return st.step === "question" ? { field: "question" } : st.step === "prediction" ? { field: "prediction" } : st.step === "observation" ? { field: "observation" } : null;
    case "boxes":
      return st.step === "nextQuestion" ? { field: "question" } : null;
  }
}

/** Completar la mesa y conceder su pieza ocurren en una sola transición; repetirlas no duplica pieza ni efecto. */
function completeActivity(adv: AdventureState, activityId: string, ctx: DomainContext, effects: EffectEvent[]): void {
  const st = adv.activities[activityId]!;
  if (st.step === "completed") return;
  st.step = "completed";
  st.completedAt = ctx.nowIso;
  const pieceId = (ctx.config.activities[activityId] as ActivityConfig).pieceId;
  if (!adv.pieces.includes(pieceId)) effects.push({ effectId: `${ctx.roomGeneration}:piece:${pieceId}`, kind: "piece.earned", pieceId, activityId });
}

function editRecord(adv: AdventureState, action: Extract<AdventureAction, { type: "record.edit" }>, ctx: DomainContext): ReduceResult | undefined {
  const record = adv.notebook.find((r) => r.id === action.recordId);
  if (!record) return fail("INVALID_PAYLOAD", "Ese registro no existe.");
  if (record.field === "finalQuestion") return fail("INVALID_STEP", "La pregunta final ya se confirmó.");
  if (action.expectedRevision !== record.revision) return fail("REVISION_CONFLICT", "Alguien cambió esta idea mientras la editabas. Revisa la versión actual.");
  const cfg = ctx.config.activities[record.activityId];
  if (!cfg) return fail("INVALID_PAYLOAD", "La mesa de este registro ya no existe.");
  const rule = ruleFor(cfg.type, record.field);
  if (!rule) return fail("INVALID_STEP", "Este registro no se puede editar.");
  const v = resolveValue(action.value, rule.modalities, rule.suggestions?.(cfg) ?? [], ctx.config.ui.maxRecordCharacters);
  if (!v.ok) return fail("INVALID_PAYLOAD", v.message);
  if (cfg.type === "boxes" && v.objectId && record.objectId !== v.objectId) record.objectId = v.objectId;

  // Se conserva la versión anterior; la primera idea de Sombras sigue identificable por su campo y su historial.
  record.history.push({ revision: record.revision, modality: record.modality, text: record.text, ...(record.optionId ? { optionId: record.optionId } : {}), authorId: record.lastEditor?.principalId ?? record.authorId, authorName: record.lastEditor?.name ?? record.authorName, at: record.updatedAt });
  record.revision += 1;
  record.modality = v.modality;
  record.text = v.text;
  if (v.optionId) record.optionId = v.optionId;
  else delete record.optionId;
  record.updatedAt = ctx.nowIso;
  record.lastEditor = { principalId: ctx.actor.principalId, name: ctx.actor.name };
  return;
}

function confirmFinalQuestion(adv: AdventureState, value: FinalQuestionInput, ctx: DomainContext, effects: EffectEvent[]): ReduceResult | undefined {
  const { config } = ctx;
  if (adv.view.kind !== "final") return fail("INVALID_STEP", "Abre la máquina del inventor primero.");
  if (!adv.inventor.piecesPlaced) return fail("INVALID_STEP", "Primero hay que colocar las piezas.");
  if (adv.inventor.finalQuestionId) return fail("INVALID_STEP", "La pregunta final ya se confirmó.");

  let resolved: ResolvedValue;
  let extra: Partial<NotebookRecord> = {};
  if (value.modality === "saved") {
    const source = adv.notebook.find((r) => r.id === value.recordId);
    if (!source || (source.field !== "nextQuestion" && source.field !== "question")) return fail("INVALID_PAYLOAD", "Esa no es una pregunta guardada del cuaderno.");
    resolved = { ok: true, modality: source.modality === "uncertain" ? "oral" : source.modality, text: source.text, ...(source.optionId ? { optionId: source.optionId } : {}) };
    extra = { sourceRecordId: source.id, ...(source.objectId ? { objectId: source.objectId } : {}) };
  } else if (value.modality === "suggested") {
    // «Una sugerencia»: cualquiera de las preguntas sugeridas de las mesas del recorrido.
    const option = config.route.flatMap((id) => (config.activities[id] as ActivityConfig).suggestions).find((o) => o.id === value.optionId);
    if (!option) return fail("INVALID_PAYLOAD", "Esa sugerencia no existe.");
    resolved = { ok: true, modality: "suggested", text: option.text, optionId: option.id };
  } else {
    resolved = resolveValue(value, ["written", "oral"], [], config.ui.maxRecordCharacters);
    if (!resolved.ok) return fail("INVALID_PAYLOAD", resolved.message);
  }

  const record = newRecord(adv, ctx, INVENTOR_ID, "finalQuestion", resolved, extra);
  adv.notebook.push(record);
  adv.inventor.finalQuestionId = record.id;
  effects.push({ effectId: `${ctx.roomGeneration}:adventure.finished`, kind: "adventure.finished" });
  return;
}

export type { Point };
