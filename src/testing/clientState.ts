// Solo pruebas: lo que recibe el navegador (`RoomClientState`) construido con el dominio real y una sala conducida con `Driver`.
// No se importa desde código de la aplicación, así que no entra al paquete que se publica.
import { vi, type Mock } from "vitest";
import type { AdminAction, CommandResult, ParticipantAction } from "../../shared/contracts/actions";
import type { GroupSnapshot, ParticipantInfo, PresenceUpdate, PublicCharacter, RoomSummary, SelfInfo } from "../../shared/contracts/events";
import { PARTICIPANT_COLORS } from "../../shared/contracts/limits";
import { personReadiness } from "../../shared/domain/results";
import { currentActivityId, roundCounter, roundMembers } from "../../shared/domain/round";
import { bundle, Driver } from "../../shared/testing/drive";
import type { ConnectionStatus, Notice, RoomClientState, RoomController, RoomPort } from "../app/RoomController";
import type { LoadedProject } from "../config/loadProject";

export const config = bundle.config;

/** El proyecto real (configuración y mapa validados) con un catálogo de recursos de mentira: ninguna prueba descarga nada. */
export const project = { bundle, registry: { has: () => true, url: (id: string) => `http://localhost/assets/${id}`, ids: () => [] as string[] }, tmj: {}, baseUrl: "/" } as unknown as LoadedProject;

export const OK: CommandResult = { ok: true, requestId: "r", stateVersion: 1, roundVersion: 1 };
export const denied = (code: Extract<CommandResult, { ok: false }>["code"], message: string): CommandResult => ({ ok: false, requestId: "r", code, message });

/** Una sala en bienvenida con las personas indicadas (identidad → nombre visible) ya dadas de alta como jugadoras. */
export function sala(people: Record<string, string> = { ana: "Ana", beto: "Beto" }): Driver {
  const d = new Driver([]);
  for (const [id, name] of Object.entries(people)) d.join(id, name);
  return d;
}

export type Etapa = "welcome" | "preparation" | "exploration" | "conversation" | "closing" | "finished";

/** Una sala conducida de verdad hasta la etapa pedida (con Ana y Beto, que no han hecho nada, salvo en el cierre, donde ambos terminaron las tres mesas). */
export function enEtapa(etapa: Etapa, people?: Record<string, string>): Driver {
  const d = sala(people);
  if (etapa === "welcome") return d;
  if (etapa === "preparation") {
    d.must(d.admin({ type: "room.start" }), "comenzar");
    return d;
  }
  if (etapa === "exploration" || etapa === "conversation") {
    d.toExploration(0);
    if (etapa === "conversation") d.must(d.admin({ type: "round.converse", withPending: true }), "conversar");
    return d;
  }
  d.playToClosing();
  if (etapa === "finished") d.must(d.admin({ type: "final.confirm", value: { kind: "written", text: "¿Por qué la luna cambia de forma?" } }), "pregunta final");
  return d;
}

/** La mesa `n` (0 Sombras, 1 Rampas, 2 La caja de las sorpresas) abierta en exploración, con quienes se indican ya listos en ella. */
export function mesaAbierta(n: 0 | 1 | 2, listas: string[] = [], people?: Record<string, string>): Driver {
  const d = sala(people);
  d.toExploration(n);
  for (const id of listas) {
    if (n === 0) d.readyShadows(id);
    else if (n === 1) d.readyRamps(id);
    else d.readyBoxes(id);
  }
  return d;
}

/** Quien llegó después de abrir la mesa: está en la sala pero no en la lista de la ronda. */
export function conRezagada(d: Driver, id = "cata", name = "Cata"): Driver {
  d.join(id, name);
  return d;
}

export interface ViewOptions {
  /** Quienes acompañan como observadoras (identidad → nombre): no juegan, así que no existen en la sala del dominio. */
  observers?: Record<string, string>;
  /** Identidades sin conexión. */
  offline?: string[];
  status?: ConnectionStatus;
  adminConnected?: boolean;
  pending?: number;
  notice?: Notice | null;
  /** Todavía no llegó la presencia de esta conexión (solo la ve Vanessa). */
  noPresence?: boolean;
}

interface Person {
  id: string;
  name: string;
  color: string;
  observer: boolean;
}

function people(d: Driver, o: ViewOptions): Person[] {
  const players = Object.keys(d.room.participants).map((id) => ({ id, name: d.names[id] ?? id, observer: false }));
  const watchers = Object.entries(o.observers ?? {}).map(([id, name]) => ({ id, name, observer: true }));
  return [...players, ...watchers].map((p, i) => ({ ...p, color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length]!.id }));
}

/** Lo mismo que `RoomService.presenceList`: quién está, cuánto lleva cada quien y el contador de la ronda. */
function presenceOf(d: Driver, o: ViewOptions): PresenceUpdate {
  const stage = d.round.stage;
  const exploring = stage === "exploration" || stage === "conversation";
  const activityId = currentActivityId(d.room.adventure, config);
  const members = new Set(exploring ? roundMembers(d.room) : []);
  const participants: ParticipantInfo[] = people(d, o).map((p) => {
    const st = d.room.participants[p.id];
    const r = exploring && activityId && st ? personReadiness(st, activityId, config) : null;
    return {
      principalId: p.id,
      role: "participant",
      displayName: p.name,
      name: p.name,
      color: p.color,
      distinction: 1,
      connected: !(o.offline ?? []).includes(p.id),
      observer: p.observer,
      inRound: members.has(p.id),
      ready: r?.ready ?? false,
      progress: r ? { done: r.done, needed: r.needed } : null,
    };
  });
  const counter = roundCounter(d.room, config);
  return { participants, connectedCount: participants.filter((p) => p.connected).length, round: { ready: counter.ready, total: counter.total } };
}

export const groupOf = (d: Driver): GroupSnapshot => ({ roomGeneration: d.room.roomGeneration, stateVersion: d.room.stateVersion, roundVersion: d.room.roundVersion, phase: d.room.phase, adventure: d.room.adventure, effects: [] });

/**
 * El estado de cliente de una persona de la sala: `"admin"` (Vanessa, sin personaje), una jugadora (con su estado personal) o una
 * observadora declarada en `observers` (sin personaje y sin estado personal).
 */
export function clientState(d: Driver, who: "admin" | string, o: ViewOptions = {}): RoomClientState {
  const all = people(d, o);
  const me = all.find((p) => p.id === who);
  const self: SelfInfo =
    who === "admin"
      ? { principalId: "admin", role: "admin", displayName: "Vanessa", color: null, connectionEpoch: 1, observer: false }
      : { principalId: who, role: "participant", displayName: me!.name, color: me!.color, connectionEpoch: 1, observer: me!.observer };
  const summary: RoomSummary = {
    code: d.room.code,
    roomGeneration: d.room.roomGeneration,
    stateVersion: d.room.stateVersion,
    roundVersion: d.room.roundVersion,
    phase: d.room.phase,
    resumePhase: d.room.resumePhase,
    adminConnected: o.adminConnected ?? true,
    configMismatch: false,
    self,
  };
  const characters: Record<string, PublicCharacter> = {};
  for (const p of all) {
    const st = d.room.participants[p.id];
    if (st) characters[p.id] = { principalId: p.id, displayName: p.name, color: p.color, connected: !(o.offline ?? []).includes(p.id), character: st.character };
  }
  const mine = d.room.participants[who];
  return {
    status: o.status ?? "connected",
    summary,
    group: groupOf(d),
    me: mine ? { roomGeneration: d.room.roomGeneration, stateVersion: d.room.stateVersion, participant: mine } : null,
    characters,
    presence: who === "admin" && !o.noPresence ? presenceOf(d, o) : null,
    pending: o.pending ?? 0,
    notice: o.notice ?? null,
  };
}

type AdminMock = Mock<(action: AdminAction) => Promise<CommandResult>>;
type ActMock = Mock<(action: ParticipantAction) => Promise<CommandResult>>;

export interface FakePort extends RoomPort {
  admin: AdminMock;
  act: ActMock;
  notify: Mock<RoomPort["notify"]>;
  clearNotice: Mock<RoomPort["clearNotice"]>;
  /** Cambia lo que devuelve `getState` (el enrutador del mapa lo consulta); la vista se vuelve a pintar con `rerender`. */
  setState(next: RoomClientState): void;
  /** Cambia la respuesta de los siguientes comandos. */
  reply(next: CommandResult): void;
  /** Se usa donde una vista pide un `RoomController` completo. */
  asController(): RoomController;
}

/** Un puerto de la sala que solo registra lo que se le pide; responde `OK` salvo que se indique otra cosa. */
export function fakePort(initial: RoomClientState, first: CommandResult = OK): FakePort {
  let state = initial;
  let answer = first;
  const port: FakePort = {
    subscribe: () => () => undefined,
    getState: () => state,
    subscribeClock: () => () => undefined,
    admin: vi.fn(async (_a: AdminAction) => answer),
    act: vi.fn(async (_a: ParticipantAction) => answer),
    notify: vi.fn(),
    clearNotice: vi.fn(),
    setState: (next) => void (state = next),
    reply: (next) => void (answer = next),
    asController: () => port as unknown as RoomController,
  };
  return port;
}
