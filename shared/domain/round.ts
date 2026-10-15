import type { FinalQuestionInput, SavableNoteKind } from "../contracts/actions";
import { INVENTOR_ID, type LaboratorioConfig } from "../contracts/config";
import type { EffectEvent } from "../contracts/events";
import type { AdventureState, GroupNote, RoomState, RoundState } from "../contracts/state";
import type { MapIndex } from "../config/tmj";
import { bump, fail, type RoomChange } from "./change";
import { cancelRunningTrials, createParticipantState, hasDueTrial, settleTrials } from "./participant";
import { personReadiness } from "./results";
import { normalizeRecordText } from "./text";

/**
 * Conducción de la ronda por Vanessa (propuesta de rondas, secciones 4 a 8). Funciones puras sobre `RoomState`: abrir la mesa,
 * reunir al grupo, mostrar la frase de Freire, avanzar, guardar síntesis, abrir el inventor y confirmar la pregunta final.
 * Participantes no adelantan la ronda ni abren mesas futuras: ninguna de estas acciones existe para ellos.
 */

export interface RoundContext {
  config: LaboratorioConfig;
  map: MapIndex;
  nowIso: string;
  /** Reloj de simulación (ms) al procesar. */
  activeMs: number;
  /** Nombre visible, con su distinción, de una persona de la sala. */
  nameOf(principalId: string): string;
}

export const freshRound = (): RoundState => ({ index: 0, stage: "preparation", roster: [], included: [], pendingAtConversation: [], freireShown: false });

export function createInitialAdventure(map: MapIndex): AdventureState {
  return { mapId: map.mapId, round: freshRound(), completed: [], pieces: [], notebook: [], inventor: {}, timeline: { activeMs: 0 }, counters: { note: 0, trial: 0, plan: 0 } };
}

/** Piezas incorporadas al inventor: las de las mesas cuya ronda ya terminó, en orden de recorrido. Nunca provienen del cliente. */
export const derivePieces = (completed: string[], config: LaboratorioConfig): string[] => config.route.filter((id) => completed.includes(id)).map((id) => config.activities[id]!.pieceId);

/** Mesa de la ronda actual, o `null` en el cierre. */
export const currentActivityId = (adv: AdventureState, config: LaboratorioConfig): string | null => (adv.round.index < config.route.length ? config.route[adv.round.index]! : null);

/** Quiénes cuentan en la ronda actual: la lista fijada al abrirla más quienes Vanessa incluyó, solo si siguen en la sala. */
export function roundMembers(room: RoomState): string[] {
  const { roster, included } = room.adventure.round;
  return [...roster, ...included].filter((id) => room.participants[id] !== undefined);
}

/** El contador de la ronda: «18 de 24 listos». El total no baja si alguien se desconecta. */
export function roundCounter(room: RoomState, config: LaboratorioConfig): { ready: number; total: number; pending: string[] } {
  const id = currentActivityId(room.adventure, config);
  const members = room.adventure.round.stage === "preparation" || id === null ? [] : roundMembers(room);
  const pending = id === null ? [] : members.filter((m) => !personReadiness(room.participants[m], id, config).ready);
  return { ready: members.length - pending.length, total: members.length, pending };
}

const ok = (room: RoomState, effects: EffectEvent[] = []): RoomChange => ({ ok: true, room, changed: true, effects });

// ---- fases de la ronda ------------------------------------------------------------------------------------------

/** Bienvenida → primera mesa, en preparación. */
export function startRoom(room: RoomState): RoomChange {
  if (room.phase !== "welcome") return fail("INVALID_STEP", "La aventura ya comenzó.");
  return ok({ ...bump(room, true), phase: "running", resumePhase: null, adventure: { ...room.adventure, round: freshRound() } });
}

/** Preparación → exploración: se fija la lista de participantes de la ronda y se habilita la mesa. */
export function openRound(room: RoomState): RoomChange {
  const r = room.adventure.round;
  if (r.stage !== "preparation") return fail("INVALID_STEP", r.stage === "exploration" ? "La mesa ya está abierta." : "Esta ronda ya pasó.");
  return ok({ ...bump(room, true), adventure: { ...room.adventure, round: { ...r, stage: "exploration", roster: Object.keys(room.participants), included: [], pendingAtConversation: [] } } });
}

/**
 * Exploración → conversación. Cierra las nuevas pruebas de la ronda: las pruebas en curso se cancelan sin contarse como terminadas.
 * Con pendientes hace falta confirmarlo (`withPending`): se conserva su trabajo parcial, se registra quiénes no terminaron y no se les
 * concede finalización individual.
 */
export function converse(room: RoomState, withPending: boolean, ctx: RoundContext): RoomChange {
  const r = room.adventure.round;
  if (r.stage !== "exploration") return fail("INVALID_STEP", "Solo se puede reunir al grupo mientras la mesa está abierta.");
  const settled = settleAll(room, ctx.activeMs);
  const counter = roundCounter(settled, ctx.config);
  if (counter.pending.length > 0 && !withPending) {
    return fail("INVALID_STEP", `Faltan ${counter.pending.length} ${counter.pending.length === 1 ? "persona" : "personas"} por terminar. Usa «Pasar a conversación con pendientes» si quieres seguir.`);
  }
  const participants = { ...settled.participants };
  for (const [id, p] of Object.entries(participants)) {
    const copy = structuredClone(p);
    if (cancelRunningTrials(copy, ctx.activeMs)) participants[id] = copy;
  }
  return ok({ ...bump(settled, true), participants, adventure: { ...settled.adventure, round: { ...r, stage: "conversation", pendingAtConversation: counter.pending, freireShown: false } } });
}

export function showFreire(room: RoomState): RoomChange {
  const r = room.adventure.round;
  if (r.stage !== "conversation") return fail("INVALID_STEP", "La frase de Freire se muestra durante la conversación.");
  if (r.freireShown) return { ok: true, room, changed: false, effects: [] };
  return ok({ ...bump(room), adventure: { ...room.adventure, round: { ...r, freireShown: true } } });
}

/**
 * Conversación → siguiente mesa (o cierre). La pieza de la mesa que termina se incorpora al inventor en este momento y una sola vez.
 * Todas las personas regresan al mapa para recibir la siguiente mesa.
 */
export function nextRound(room: RoomState, ctx: RoundContext): RoomChange {
  const { config } = ctx;
  const adv = room.adventure;
  const r = adv.round;
  const id = currentActivityId(adv, config);
  if (r.stage !== "conversation" || id === null) return fail("INVALID_STEP", "Primero hay que reunir al grupo para conversar.");
  const completed = adv.completed.includes(id) ? adv.completed : [...adv.completed, id];
  const pieceId = config.activities[id]!.pieceId;
  const nextIndex = r.index + 1;
  const closing = nextIndex >= config.route.length;
  const effects: EffectEvent[] = [];
  if (!adv.completed.includes(id)) effects.push({ effectId: `${room.roomGeneration}:piece:${pieceId}`, kind: "piece.earned", pieceId, activityId: id });
  if (closing) effects.push({ effectId: `${room.roomGeneration}:inventor.activated`, kind: "inventor.activated" });
  const participants = Object.fromEntries(Object.entries(room.participants).map(([pid, p]) => [pid, p.view.kind === "map" ? p : { ...p, view: { kind: "map" as const } }]));
  return ok(
    {
      ...bump(room, true),
      participants,
      adventure: { ...adv, completed, pieces: derivePieces(completed, config), round: { index: nextIndex, stage: closing ? "closing" : "preparation", roster: [], included: [], pendingAtConversation: [], freireShown: false } },
    },
    effects,
  );
}

/**
 * Cierre: Vanessa abre el inventor como se abre una mesa. Hasta entonces las personas caminan hasta la máquina; abierto, cada una entra
 * cuando llega y registra su pregunta.
 */
export function openInventor(room: RoomState): RoomChange {
  const adv = room.adventure;
  if (adv.round.stage !== "closing") return fail("INVALID_STEP", "El inventor se abre al final del recorrido, después de la última mesa.");
  if (adv.inventor.open) return { ok: true, room, changed: false, effects: [] };
  return ok({ ...bump(room, true), adventure: { ...adv, inventor: { ...adv.inventor, open: true } } });
}

/** Quien llegó después de abrir la ronda acompaña sin contar; Vanessa puede incluirla si todavía hay tiempo. */
export function includeLate(room: RoomState, principalId: string): RoomChange {
  const r = room.adventure.round;
  if (r.stage !== "exploration") return fail("INVALID_STEP", "Solo se puede incluir a alguien mientras la mesa está abierta.");
  if (!room.participants[principalId]) return fail("INVALID_PAYLOAD", "Esa persona no juega en esta sala.");
  if (r.roster.includes(principalId) || r.included.includes(principalId)) return { ok: true, room, changed: false, effects: [] };
  return ok({ ...bump(room), adventure: { ...room.adventure, round: { ...r, included: [...r.included, principalId] } } });
}

/** Termina las pruebas cuya hora llegó, en todas las personas. Devuelve la sala igual si no terminó ninguna. */
export function settleAll(room: RoomState, activeMs: number): RoomState {
  let participants = room.participants;
  for (const [id, p] of Object.entries(room.participants)) {
    if (!hasDueTrial(p, activeMs)) continue;
    const copy = structuredClone(p);
    settleTrials(copy, activeMs);
    participants = { ...participants, [id]: copy };
  }
  return participants === room.participants ? room : { ...room, participants };
}

// ---- cuaderno común -------------------------------------------------------------------------------------------------

/** ¿La mesa ya empezó (o terminó)? Las notas de una mesa futura no existen todavía. */
const reached = (adv: AdventureState, config: LaboratorioConfig, activityId: string): boolean => {
  const i = config.route.indexOf(activityId);
  return i >= 0 && i <= adv.round.index;
};

/**
 * Guarda una nota de Vanessa en el cuaderno común: la idea inicial del grupo (solo en Sombras, y se conserva aparte de la síntesis),
 * una síntesis de la conversación o una pregunta que el grupo quiere conservar. Se identifican como «Idea del grupo».
 */
export function saveNote(room: RoomState, input: { activityId: string; kind: SavableNoteKind; text: string }, ctx: RoundContext): RoomChange {
  const { config } = ctx;
  const adv = room.adventure;
  if (room.phase === "welcome") return fail("INVALID_STEP", "La aventura aún no comienza.");
  const cfg = config.activities[input.activityId];
  if (!cfg || !reached(adv, config, input.activityId)) return fail("INVALID_PAYLOAD", "Esa mesa todavía no se abre.");
  if (input.kind === "initialIdea" && cfg.type !== "shadows") return fail("INVALID_PAYLOAD", "La idea inicial se guarda solo en Sombras.");
  const text = normalizeRecordText(input.text, config.ui.maxRecordCharacters);
  if (!text.ok) return fail("INVALID_PAYLOAD", text.message);
  const counters = { ...adv.counters, note: adv.counters.note + 1 };
  const note: GroupNote = { id: `n${counters.note}`, activityId: input.activityId, kind: input.kind, text: text.value, revision: 1, createdAt: ctx.nowIso, updatedAt: ctx.nowIso, history: [] };
  return ok({ ...bump(room), adventure: { ...adv, counters, notebook: [...adv.notebook, note] } });
}

export function editNote(room: RoomState, input: { noteId: string; expectedRevision: number; text: string }, ctx: RoundContext): RoomChange {
  const adv = room.adventure;
  const note = adv.notebook.find((n) => n.id === input.noteId);
  if (!note) return fail("INVALID_PAYLOAD", "Esa nota no existe.");
  if (note.kind === "finalQuestion") return fail("INVALID_STEP", "La pregunta final se corrige con su propia acción.");
  if (input.expectedRevision !== note.revision) return fail("REVISION_CONFLICT", "La nota cambió mientras la editabas. Revisa la versión actual.");
  const text = normalizeRecordText(input.text, ctx.config.ui.maxRecordCharacters);
  if (!text.ok) return fail("INVALID_PAYLOAD", text.message);
  if (text.value === note.text) return { ok: true, room, changed: false, effects: [] };
  return ok({ ...bump(room), adventure: { ...adv, notebook: adv.notebook.map((n) => (n.id === note.id ? edited(n, text.value, ctx.nowIso) : n)) } });
}

const edited = (n: GroupNote, text: string, at: string): GroupNote => ({ ...n, text, revision: n.revision + 1, updatedAt: at, history: [...n.history, { revision: n.revision, text: n.text, at: n.updatedAt }] });

// ---- cierre -------------------------------------------------------------------------------------------------------------

/**
 * Pregunta final: Vanessa confirma un texto (lo escribe o lo toma de las preguntas de las personas o de las sugeridas por las mesas) o
 * elige una pregunta guardada. Cierra la aventura en la misma transición.
 */
export function confirmFinal(room: RoomState, value: FinalQuestionInput, ctx: RoundContext): RoomChange {
  const adv = room.adventure;
  if (adv.round.stage !== "closing") return fail("INVALID_STEP", "La pregunta final se confirma en el cierre, con las tres piezas en el inventor.");
  if (adv.inventor.finalQuestionId) return fail("INVALID_STEP", "La pregunta final ya se confirmó.");
  if (!adv.inventor.open) return fail("INVALID_STEP", "Primero abre el inventor.");
  let text: string;
  let sourceNoteId: string | undefined;
  if (value.kind === "saved") {
    const source = adv.notebook.find((n) => n.id === value.noteId);
    if (!source || source.kind !== "question" || !source.text) return fail("INVALID_PAYLOAD", "Esa no es una pregunta guardada del cuaderno.");
    text = source.text;
    sourceNoteId = source.id;
  } else {
    const t = normalizeRecordText(value.text, ctx.config.ui.maxRecordCharacters);
    if (!t.ok) return fail("INVALID_PAYLOAD", t.message);
    text = t.value;
  }
  const counters = { ...adv.counters, note: adv.counters.note + 1 };
  const note: GroupNote = { id: `n${counters.note}`, activityId: INVENTOR_ID, kind: "finalQuestion", text, ...(sourceNoteId ? { sourceNoteId } : {}), revision: 1, createdAt: ctx.nowIso, updatedAt: ctx.nowIso, history: [] };
  return ok(
    { ...bump(room), phase: "finished", resumePhase: null, adventure: { ...adv, counters, notebook: [...adv.notebook, note], inventor: { finalQuestionId: note.id } } },
    [{ effectId: `${room.roomGeneration}:adventure.finished`, kind: "adventure.finished" }],
  );
}

/** Corrige un error de escritura de la pregunta final ya confirmada; se conserva la versión anterior. */
export function correctFinal(room: RoomState, input: { expectedRevision: number; text: string }, ctx: RoundContext): RoomChange {
  const adv = room.adventure;
  const note = adv.notebook.find((n) => n.id === adv.inventor.finalQuestionId);
  if (!note) return fail("INVALID_STEP", "Todavía no hay una pregunta final que corregir.");
  if (input.expectedRevision !== note.revision) return fail("REVISION_CONFLICT", "La pregunta cambió mientras la editabas. Revisa la versión actual.");
  const text = normalizeRecordText(input.text, ctx.config.ui.maxRecordCharacters);
  if (!text.ok) return fail("INVALID_PAYLOAD", text.message);
  if (text.value === note.text) return { ok: true, room, changed: false, effects: [] };
  return ok({ ...bump(room), adventure: { ...adv, notebook: adv.notebook.map((n) => (n.id === note.id ? edited(n, text.value, ctx.nowIso) : n)) } });
}

/** Reinicio de la sala: borra el recorrido y los registros y conserva a las personas, con su personaje de nuevo en la entrada. */
export function resetAdventure(room: RoomState, config: LaboratorioConfig, map: MapIndex): Pick<RoomState, "adventure" | "participants"> {
  const participants: RoomState["participants"] = {};
  Object.keys(room.participants).forEach((id, i) => {
    participants[id] = createParticipantState(config, map, i);
  });
  return { adventure: createInitialAdventure(map), participants };
}
