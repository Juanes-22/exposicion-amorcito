// Solo pruebas: conduce el reductor de la aventura paso a paso con un reloj y una identidad controlados.
import type { AdventureAction } from "../contracts/actions";
import type { EffectEvent } from "../contracts/events";
import type { AdventureState } from "../contracts/state";
import { createInitialAdventure, reduceAdventure, type Actor, type DomainContext } from "../domain/adventure";
import { realBundle } from "./project";

export const bundle = realBundle();
export const ana: Actor = { principalId: "p-ana", role: "participant", name: "Ana" };
export const beto: Actor = { principalId: "p-beto", role: "participant", name: "Beto" };

export class Driver {
  state: AdventureState = createInitialAdventure(bundle.config, bundle.map);
  activeMs = 0;
  effects: EffectEvent[] = [];
  finished = false;
  lastError: { code: string; message: string } | null = null;

  ctx(actor: Actor): DomainContext {
    return { config: bundle.config, map: bundle.map, nav: bundle.nav, actor, roomGeneration: 1, nowIso: new Date(1_700_000_000_000 + this.activeMs).toISOString(), activeMs: this.activeMs };
  }

  /** Aplica una acción; devuelve `true` si fue aceptada. Si se rechaza, el estado no cambia. */
  do(action: AdventureAction, actor: Actor = ana): boolean {
    const r = reduceAdventure(this.state, action, this.ctx(actor));
    if (!r.ok) {
      this.lastError = { code: r.code, message: r.message };
      return false;
    }
    this.lastError = null;
    this.state = r.adventure;
    this.effects.push(...r.effects);
    this.finished ||= r.finishRoom;
    return true;
  }

  tick(ms: number) {
    this.activeMs += ms;
    // Una acción neutra asienta el reloj (movimiento y pruebas).
    const r = reduceAdventure(this.state, { type: "adventure.returnToMap" } as AdventureAction, this.ctx(ana));
    if (r.ok) this.state = { ...r.adventure, view: this.state.view };
  }

  get act() {
    return this.state.activities;
  }
}

/** Mesa abierta y lista para el paso indicado. */
export function openStation(d: Driver, id: string) {
  d.state.view = { kind: "map" };
  if (!d.do({ type: "station.open", stationId: id, origin: "quickNav" })) throw new Error(`No se pudo abrir ${id}: ${d.lastError?.message}`);
}

export function finishShadows(d: Driver) {
  openStation(d, "sombras");
  d.do({ type: "shadows.surprise.ack" });
  d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "Será por la luz" } }, ana);
  d.do({ type: "shadows.light.set", distanceCm: 20, commitSample: true });
  d.do({ type: "shadows.light.set", distanceCm: 50, commitSample: true });
  d.do({ type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "uncertain" } }, beto);
  d.do({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "suggested", optionId: "mover-objeto" } }, beto);
}

export function finishRamps(d: Driver) {
  openStation(d, "rampas");
  d.do({ type: "ramps.question.open" });
  d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "suggested", optionId: "mas-inclinacion" } });
  d.do({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
  d.do({ type: "ramps.angle.set", angleDeg: 20 });
  d.do({ type: "ramps.trial.start" });
  d.tick(5000);
  d.do({ type: "ramps.angle.set", angleDeg: 40 });
  d.do({ type: "ramps.trial.start" });
  d.tick(5000);
  d.do({ type: "record.confirm", activityId: "rampas", field: "observation", value: { modality: "written", text: "Con más inclinación llegó antes" } }, beto);
}

export function finishBoxes(d: Driver) {
  openStation(d, "cajas");
  d.do({ type: "boxes.shared.open" });
  d.do({ type: "boxes.object.inspect", objectId: "campanita" });
  d.do({ type: "boxes.permission.ask" });
  d.do({ type: "boxes.refusal.ack" }, beto);
  d.do({ type: "boxes.refusal.respect" }, beto);
  d.do({ type: "boxes.object.inspect", objectId: "lupa" });
  d.do({ type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "suggested", optionId: "aumento" } });
}
