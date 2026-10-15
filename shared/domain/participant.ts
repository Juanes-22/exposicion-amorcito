import { INVENTOR_ID, type LaboratorioConfig, type ActivityConfig } from "../contracts/config";
import type { ParticipantAction } from "../contracts/actions";
import type { Point } from "../contracts/geometry";
import type { ActivityState, ParticipantQuestion, ParticipantState, PlayerState, RoomState, RoundState, ShadowSample } from "../contracts/state";
import type { MapIndex } from "../config/tmj";
import { fail, type RoomError } from "./change";
import { rampDurationMs, shadowHeightCm } from "./models";
import { createPlan, samplePlan } from "./movement";
import { findPath, isFootprintFree, type NavGrid } from "./navigation";
import { emptyActivityState, runningTrial } from "./results";
import { centeredTargets, clampView } from "./telescope";
import { normalizeRecordText } from "./text";

/**
 * Estado y acciones de cada participante (propuesta de rondas, sección 9). Todas son funciones puras: cada persona modifica solo su
 * `ParticipantState`; los contadores compartidos (IDs de pruebas y planes) viajan en el estado de grupo. Nadie actúa sobre las
 * pruebas de otra persona.
 */

const EPS = 1e-9;
/** Tope de posiciones guardadas por persona: las que no cuentan se descartan primero. */
const MAX_SAMPLES = 40;

export interface ParticipantContext {
  config: LaboratorioConfig;
  map: MapIndex;
  nav: NavGrid;
  /** Reloj de simulación (ms) al procesar: solo avanza con la sala en curso. */
  activeMs: number;
}

// ---- creación -------------------------------------------------------------------------------------------------

/**
 * Dónde aparece el personaje número `index` de la sala. Todos nacen alrededor de la entrada, en anillos, y los personajes no se bloquean
 * entre sí; se descartan los puntos que chocan con el escenario.
 */
export function spawnPoint(config: LaboratorioConfig, map: MapIndex, index: number): Point {
  const base = map.spawns[config.world.initialSpawnId]!;
  const fp = config.world.player.footprint;
  const candidates: Point[] = [{ x: base.x, y: base.y }];
  for (let ring = 1; ring <= 6; ring++) {
    const n = ring * 6;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      candidates.push({ x: Math.round(base.x + Math.cos(a) * ring * 36), y: Math.round(base.y + Math.sin(a) * ring * 22) });
    }
  }
  const free = candidates.filter((p) => isFootprintFree(map, fp, p));
  const pick = free.length > 0 ? free[index % free.length]! : candidates[0]!;
  return { x: pick.x, y: pick.y };
}

export function createParticipantState(config: LaboratorioConfig, map: MapIndex, index: number): ParticipantState {
  const activities: Record<string, ActivityState> = {};
  for (const id of config.route) activities[id] = emptyActivityState(config.activities[id] as ActivityConfig);
  return { character: { feet: spawnPoint(config, map, index), facing: "down", plan: null }, view: { kind: "map" }, activities };
}

/** Posición y orientación de un personaje en un instante de reloj activo. */
export function playerAt(player: PlayerState, activeMs: number) {
  if (!player.plan) return { feet: player.feet, facing: player.facing, moving: false };
  const s = samplePlan(player.plan, activeMs, player.facing);
  return { feet: s.feet, facing: s.facing, moving: !s.done };
}

// ---- tiempo: pruebas de rampa ------------------------------------------------------------------------------------

/** ¿Hay una prueba en marcha cuya hora ya llegó? Barato: sirve para no copiar el estado de quien no tiene nada que asentar. */
export function hasDueTrial(p: ParticipantState, activeMs: number): boolean {
  for (const st of Object.values(p.activities)) {
    if (st.type !== "ramps") continue;
    const trial = runningTrial(st);
    if (trial && activeMs >= trial.startActiveMs + trial.durationMs) return true;
  }
  return false;
}

/** Termina las pruebas cuya hora llegó, una sola vez y en su instante exacto. Devuelve `true` si alguna terminó. */
export function settleTrials(p: ParticipantState, activeMs: number): boolean {
  let changed = false;
  for (const st of Object.values(p.activities)) {
    if (st.type !== "ramps") continue;
    const trial = runningTrial(st);
    if (trial && activeMs >= trial.startActiveMs + trial.durationMs) {
      trial.state = "finished";
      trial.endedActiveMs = trial.startActiveMs + trial.durationMs;
      changed = true;
    }
  }
  return changed;
}

/** Al pasar a la conversación, una prueba en marcha se cancela: no cuenta como terminada ni como resultado válido. */
export function cancelRunningTrials(p: ParticipantState, activeMs: number): boolean {
  let changed = false;
  for (const st of Object.values(p.activities)) {
    if (st.type !== "ramps") continue;
    const trial = runningTrial(st);
    if (trial) {
      trial.state = "cancelled";
      trial.endedActiveMs = activeMs;
      changed = true;
    }
  }
  return changed;
}

// ---- acciones --------------------------------------------------------------------------------------------------

/**
 * Entrar al inventor, como se entra a una mesa: en el cierre, con el inventor abierto y junto a la máquina (o desde el menú accesible).
 * Modifica `p` y devuelve `null` si entró; si no, el error.
 */
function openInventorView(p: ParticipantState, room: RoomState, origin: "map" | "quickNav", ctx: ParticipantContext): RoomError | null {
  if (room.adventure.round.stage !== "closing") return fail("INVALID_STEP", "El inventor se abre al final del recorrido, después de la última mesa.");
  if (!room.adventure.inventor.open) return fail("INVALID_STEP", "Vanessa abrirá el inventor en un momento.");
  const here = playerAt(p.character, ctx.activeMs);
  if (origin === "map") {
    const inv = ctx.map.inventor;
    if (!inv) return fail("INVALID_PAYLOAD", "El inventor no está en el mapa.");
    if (Math.hypot(here.feet.x - inv.point.x, here.feet.y - inv.point.y) > inv.interactionRadius) return fail("INVALID_STEP", "Acércate al inventor para abrirlo.");
  }
  p.character = { feet: here.feet, facing: here.facing, plan: null }; // el personaje se detiene donde está
  p.view = { kind: "inventor" };
  return null;
}

export type PersonalResult = { ok: true; participant: ParticipantState; counters: RoomState["adventure"]["counters"]; changed: boolean } | RoomError;

const STAGE_TEXT: Record<RoundState["stage"], string> = {
  preparation: "Vanessa abrirá la mesa en un momento.",
  exploration: "",
  conversation: "Estamos conversando: mira la proyección.",
  closing: "Ya pasamos por todas las mesas: ve al inventor de preguntas.",
};


/**
 * Aplica una acción personal. Las comprobaciones de fase de la sala (pausa, bienvenida, terminada) las hace `applyParticipantAction`;
 * aquí se comprueba la fase de la ronda y lo que corresponde a la mesa habilitada. No muta su entrada.
 */
export function reduceParticipant(room: RoomState, principalId: string, action: ParticipantAction, ctx: ParticipantContext): PersonalResult {
  const before = room.participants[principalId];
  if (!before) return fail("NOT_AUTHORIZED", "Estás como observador: sigue la aventura en la proyección.");
  const { config } = ctx;
  const round = room.adventure.round;
  const p: ParticipantState = structuredClone(before);
  const counters = { ...room.adventure.counters };
  settleTrials(p, ctx.activeMs);
  const currentId = round.index < config.route.length ? config.route[round.index]! : null;
  const done = (changed: boolean): PersonalResult => ({ ok: true, participant: p, counters, changed: changed || JSON.stringify(p) !== JSON.stringify(before) });

  /** La acción exige que la mesa habilitada esté abierta en exploración y que la persona la tenga abierta de este tipo. */
  const needOpen = <T extends ActivityConfig["type"]>(type: T) => {
    if (round.stage !== "exploration") return fail("INVALID_STEP", STAGE_TEXT[round.stage] || "Todavía no se puede.");
    if (p.view.kind !== "activity" || p.view.activityId !== currentId) return fail("INVALID_STEP", "Abre la mesa habilitada para explorarla.");
    const cfg = config.activities[p.view.activityId];
    const st = p.activities[p.view.activityId];
    if (!cfg || !st || cfg.type !== type || st.type !== type) return fail("INVALID_STEP", "Esta acción no corresponde a la mesa abierta.");
    return { id: p.view.activityId, cfg: cfg as Extract<ActivityConfig, { type: T }>, st: st as Extract<ActivityState, { type: T }> };
  };
  const isFail = (v: unknown): v is RoomError => typeof v === "object" && v !== null && "ok" in v;

  switch (action.type) {
    case "player.moveTo": {
      // En el cierre también se camina: hay que llegar hasta el inventor.
      if (round.stage === "conversation") return fail("INVALID_STEP", STAGE_TEXT.conversation);
      if (p.view.kind !== "map") return fail("INVALID_STEP", "Vuelve al mapa para moverte.");
      const here = playerAt(p.character, ctx.activeMs).feet;
      const fp = config.world.player.footprint;
      if (!isFootprintFree(ctx.map, fp, action.target)) return fail("INVALID_PAYLOAD", "Ese punto no se puede pisar. Toca un lugar libre del laboratorio.");
      const path = findPath(ctx.map, fp, ctx.nav, here, action.target);
      if (!path) return fail("INVALID_PAYLOAD", "No hay camino hasta ese punto.");
      if (path.length < 2) p.character = { feet: here, facing: p.character.facing, plan: null };
      else p.character = { feet: here, facing: p.character.facing, plan: createPlan(`m${++counters.plan}`, path, config.world.playerSpeed, ctx.activeMs) };
      return done(true);
    }

    case "station.open": {
      // `done` compara el antes y el después: volver a entrar a la máquina en la que ya está no cambia nada.
      if (action.stationId === INVENTOR_ID) return openInventorView(p, room, action.origin, ctx) ?? done(false);
      if (round.stage !== "exploration") return fail("INVALID_STEP", STAGE_TEXT[round.stage] || "Todavía no se puede.");
      if (currentId === null || action.stationId !== currentId) {
        const known = config.route.indexOf(action.stationId);
        if (known < 0) return fail("INVALID_STEP", "Esa mesa no está disponible ahora.");
        return fail("INVALID_STEP", known < round.index ? "Esa mesa ya terminó." : "Esa mesa se habilitará más adelante.");
      }
      if (p.view.kind === "activity") return done(false); // ya la tiene abierta
      if (action.origin === "map") {
        const s = ctx.map.stations.find((x) => x.activityId === action.stationId);
        if (!s) return fail("INVALID_PAYLOAD", "Esa mesa no está en el mapa.");
        const here = playerAt(p.character, ctx.activeMs).feet;
        if (Math.hypot(here.x - s.point.x, here.y - s.point.y) > s.interactionRadius) return fail("INVALID_STEP", "Acércate a la mesa para abrirla.");
      }
      const here = playerAt(p.character, ctx.activeMs);
      p.character = { feet: here.feet, facing: here.facing, plan: null }; // el personaje se detiene donde está
      p.view = { kind: "activity", activityId: action.stationId };
      return done(true);
    }

    case "adventure.returnToMap": {
      if (p.view.kind === "map") return done(false);
      p.view = { kind: "map" };
      return done(true);
    }

    case "shadows.sample": {
      const n = needOpen("shadows");
      if (isFail(n)) return n;
      const e = n.cfg.experiment;
      if (!Number.isFinite(action.distanceCm) || action.distanceCm < e.sourceDistanceMinCm - EPS || action.distanceCm > e.sourceDistanceMaxCm + EPS) {
        return fail("INVALID_PAYLOAD", "Esa posición de la linterna no es válida: muévela con el control de la mesa.");
      }
      const last = n.st.samples.at(-1);
      if (last && Math.abs(last.distanceCm - action.distanceCm) < EPS) return done(false); // la misma posición no se registra dos veces seguidas
      const counted = n.st.samples.filter((s) => s.counts);
      const sample: ShadowSample = {
        distanceCm: action.distanceCm,
        shadowCm: shadowHeightCm(action.distanceCm, e.screenDistanceCm, e.objectHeightCm),
        counts: counted.every((s) => Math.abs(s.distanceCm - action.distanceCm) >= e.minDistinctDistanceCm - EPS),
        atActiveMs: ctx.activeMs,
      };
      n.st.samples.push(sample);
      if (n.st.samples.length > MAX_SAMPLES) {
        const drop = n.st.samples.findIndex((s) => !s.counts);
        n.st.samples.splice(drop >= 0 ? drop : 0, 1);
      }
      return done(true);
    }

    case "ramps.trial.start": {
      const n = needOpen("ramps");
      if (isFail(n)) return n;
      if (runningTrial(n.st)) return fail("INVALID_STEP", "Espera a que termine la prueba.");
      const e = n.cfg.experiment;
      const steps = (action.angleDeg - e.minAngleDeg) / e.angleStepDeg;
      if (!Number.isFinite(action.angleDeg) || action.angleDeg < e.minAngleDeg - EPS || action.angleDeg > e.maxAngleDeg + EPS || Math.abs(steps - Math.round(steps)) > 1e-6) {
        return fail("INVALID_PAYLOAD", "Esa inclinación no es válida: elige una de las de la mesa.");
      }
      // El servidor asigna el ID, calcula la duración y congela las condiciones; el resultado se registra solo al terminar.
      n.st.trials.push({
        trialId: `t${++counters.trial}`,
        angleDeg: action.angleDeg,
        model: e.model,
        lengthMeters: e.lengthMeters,
        visualTimeScale: e.visualTimeScale,
        durationMs: rampDurationMs(action.angleDeg, e.lengthMeters, e.visualTimeScale),
        startActiveMs: ctx.activeMs,
        state: "running",
      });
      return done(true);
    }

    case "telescope.aim": {
      const n = needOpen("telescope");
      if (isFail(n)) return n;
      const e = n.cfg.experiment;
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || !Number.isInteger(action.zoom) || action.zoom < 0 || action.zoom >= e.zoomLevels.length) {
        return fail("INVALID_PAYLOAD", "Esa dirección del telescopio no es válida.");
      }
      // El servidor decide qué quedó centrado con la geometría compartida; el cliente solo dice hacia dónde quedó mirando.
      const view = clampView(action, e);
      const centered = centeredTargets(view, e);
      n.st.x = view.x;
      n.st.y = view.y;
      n.st.zoom = view.zoom;
      for (const target of ["moon", "stars", "galaxy"] as const) if (centered[target] && !n.st.observed.includes(target)) n.st.observed.push(target);
      // La cortina se cierra una sola vez y no se vuelve a abrir: no hay ninguna acción que la abra.
      if (centered.window && n.st.curtain === "open") n.st.curtain = "closed";
      return done(false);
    }

    case "inventor.question": {
      if (round.stage !== "closing" || !room.adventure.inventor.open) return fail("INVALID_STEP", "Las preguntas se registran cuando Vanessa abre el inventor.");
      if (room.adventure.inventor.finalQuestionId) return fail("INVALID_STEP", "La pregunta del grupo ya quedó impresa en el inventor.");
      if (p.view.kind !== "inventor") return fail("INVALID_STEP", "Entra al inventor para registrar tu pregunta.");
      const q = action.question;
      let question: ParticipantQuestion;
      if (q.kind === "preset") {
        const preset = config.inventor.questions.find((x) => x.id === q.presetId);
        if (!preset) return fail("INVALID_PAYLOAD", "Esa pregunta no está en la lista del inventor.");
        question = { presetId: preset.id, text: preset.text, atActiveMs: ctx.activeMs };
      } else {
        const t = normalizeRecordText(q.text, config.ui.maxRecordCharacters);
        if (!t.ok) return fail("INVALID_PAYLOAD", t.message);
        question = { presetId: null, text: t.value, atActiveMs: ctx.activeMs };
      }
      // La misma pregunta otra vez no cambia nada (ni siquiera la hora en que se registró).
      if (p.question && p.question.presetId === question.presetId && p.question.text === question.text) return done(false);
      p.question = question;
      return done(true);
    }

    default: {
      // Exhaustividad: añadir una acción al catálogo sin tratarla aquí es un error de tipos. En ejecución, cualquier acción fuera del
      // catálogo (setState, grantPiece, openCurtain…) se rechaza en vez de aceptarse sin efecto.
      const unknown: never = action;
      return fail("INVALID_PAYLOAD", `Acción desconocida: ${String((unknown as { type?: unknown }).type)}`);
    }
  }
}

