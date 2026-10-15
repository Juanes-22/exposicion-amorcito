// Solo pruebas: conduce la sala (rondas, participantes, Vanessa) paso a paso con un reloj controlado.
import type { AdminAction, ParticipantAction } from "../contracts/actions";
import type { EffectEvent } from "../contracts/events";
import type { RoomState } from "../contracts/state";
import { ensureParticipant, applyAdminAction, applyParticipantAction, createRoomState, tickRoom, type AdminContext } from "../domain/room";
import { realBundle } from "./project";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../domain/telescope";

export const bundle = realBundle();

export class Driver {
  room: RoomState;
  activeMs = 0;
  effects: EffectEvent[] = [];
  lastError: { code: string; message: string } | null = null;
  readonly names: Record<string, string> = {};

  /** Una sala en bienvenida con las personas indicadas ya dadas de alta. */
  constructor(people: string[] = ["ana", "beto"]) {
    this.room = createRoomState({ roomId: "r", code: "ABC234", config: bundle.config, map: bundle.map, configHash: bundle.configHash, mapHash: bundle.mapHash, nowIso: "2026-10-06T10:00:00.000Z" });
    for (const id of people) this.join(id);
  }

  join(id: string, name = id): void {
    this.names[id] = name;
    this.room = ensureParticipant(this.room, id, bundle.config, bundle.map);
  }

  private get nowIso(): string {
    return new Date(1_700_000_000_000 + this.activeMs).toISOString();
  }

  private adminCtx(): AdminContext {
    return { config: bundle.config, map: bundle.map, nowIso: this.nowIso, activeMs: this.activeMs, nameOf: (id) => this.names[id] ?? id, fingerprint: { configHash: bundle.configHash, mapHash: bundle.mapHash } };
  }

  /** Acción de Vanessa; `true` si fue aceptada. Si se rechaza, la sala no cambia. */
  admin(action: AdminAction): boolean {
    const r = applyAdminAction(this.room, action, this.adminCtx());
    if (!r.ok) {
      this.lastError = { code: r.code, message: r.message };
      return false;
    }
    this.lastError = null;
    this.room = r.room;
    this.effects.push(...r.effects);
    return true;
  }

  /** Acción personal; `true` si fue aceptada. */
  act(id: string, action: ParticipantAction): boolean {
    const r = applyParticipantAction(this.room, id, action, { config: bundle.config, map: bundle.map, nav: bundle.nav, activeMs: this.activeMs });
    if (!r.ok) {
      this.lastError = { code: r.code, message: r.message };
      return false;
    }
    this.lastError = null;
    this.room = r.room;
    return true;
  }

  /** Avanza el reloj de simulación (solo corre con la sala en curso, como en el servidor) y asienta las pruebas que terminan. */
  tick(ms: number): string[] {
    if (this.room.phase === "running") this.activeMs += ms;
    const t = tickRoom(this.room, this.activeMs);
    this.room = t.room;
    return t.changedIds;
  }

  get round() {
    return this.room.adventure.round;
  }
  person(id: string) {
    return this.room.participants[id]!;
  }
  must(ok: boolean, what: string): void {
    if (!ok) throw new Error(`${what}: ${this.lastError?.message}`);
  }

  // ---- recorridos de ayuda ----

  /** Comienza y deja la mesa indicada abierta en exploración. */
  toExploration(activityIndex = 0): void {
    if (this.room.phase === "welcome") this.must(this.admin({ type: "room.start" }), "comenzar");
    while (this.round.index < activityIndex) {
      this.must(this.admin({ type: "round.open" }), "abrir");
      this.must(this.admin({ type: "round.converse", withPending: true }), "conversar");
      this.must(this.admin({ type: "round.next" }), "avanzar");
    }
    this.must(this.admin({ type: "round.open" }), "abrir la mesa");
  }

  openStation(id: string, station: string): void {
    this.must(this.act(id, { type: "station.open", stationId: station, origin: "quickNav" }), `abrir ${station}`);
  }

  /** Dos posiciones distintas de la linterna: la persona queda lista en Sombras. */
  readyShadows(id: string): void {
    this.openStation(id, "sombras");
    this.must(this.act(id, { type: "shadows.sample", distanceCm: 20 }), "muestra 1");
    this.must(this.act(id, { type: "shadows.sample", distanceCm: 50 }), "muestra 2");
  }

  /** Dos pruebas con inclinaciones distintas, terminadas: la persona queda lista en Rampas. */
  readyRamps(id: string): void {
    this.openStation(id, "rampas");
    this.must(this.act(id, { type: "ramps.trial.start", angleDeg: 20 }), "prueba 1");
    this.tick(6000);
    this.must(this.act(id, { type: "ramps.trial.start", angleDeg: 40 }), "prueba 2");
    this.tick(6000);
  }

  /** La Luna de cerca y el grupo de estrellas centrados: la persona queda lista en el observatorio. */
  readyTelescope(id: string): void {
    this.openStation(id, "cajas");
    const { moon, stars } = TELESCOPE_TARGETS;
    this.must(this.act(id, { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "Luna");
    this.must(this.act(id, { type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "estrellas");
  }

  /** Recorre las tres rondas completas hasta el cierre con las personas indicadas listas. */
  playToClosing(ready: string[] = Object.keys(this.room.participants)): void {
    this.toExploration(0);
    for (const id of ready) this.readyShadows(id);
    this.must(this.admin({ type: "round.converse" }), "conversar 1");
    this.must(this.admin({ type: "round.next" }), "avanzar 1");
    this.must(this.admin({ type: "round.open" }), "abrir 2");
    for (const id of ready) this.readyRamps(id);
    this.must(this.admin({ type: "round.converse" }), "conversar 2");
    this.must(this.admin({ type: "round.next" }), "avanzar 2");
    this.must(this.admin({ type: "round.open" }), "abrir 3");
    for (const id of ready) this.readyTelescope(id);
    this.must(this.admin({ type: "round.converse" }), "conversar 3");
    this.must(this.admin({ type: "round.next" }), "avanzar 3");
  }
}
