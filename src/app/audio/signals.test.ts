import { describe, expect, it } from "vitest";
import type { EffectEvent, RoomSnapshot } from "../../../shared/contracts/events";
import { createRoomState } from "../../../shared/domain/room";
import { bundle, Driver, finishBoxes, finishRamps, finishShadows, openStation } from "../../../shared/testing/drive";
import { createSignalTracker } from "./signals";

const { config, map } = bundle;
const room = (d: Driver, version: number, generation = 1) => ({
  ...createRoomState({ roomId: "r", code: "ABC234", config, map, configHash: bundle.configHash, mapHash: bundle.mapHash, nowIso: "2026-10-06T10:00:00.000Z" }),
  roomGeneration: generation,
  stateVersion: version,
  adventure: d.state,
});
const snap = (d: Driver, version: number, effects: EffectEvent[] = [], generation = 1): RoomSnapshot => ({ state: room(d, version, generation), controller: null, effects });
const earned = (id: string, piece = "lupa"): EffectEvent => ({ effectId: `1:piece.earned:${id}`, kind: "piece.earned", pieceId: piece });

describe("señales por transición (SPECS 10.4)", () => {
  it("el primer snapshot solo fija la línea de base: no hay celebraciones históricas al abrir o reabrir el juego", () => {
    const t = createSignalTracker(config);
    expect(t.consume(snap(new Driver(), 1, [earned("a"), { effectId: "1:adventure.finished", kind: "adventure.finished" }]))).toEqual([]);
  });

  it("un efecto del servidor produce su evento y su texto, y no se repite aunque llegue otra vez", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.consume(snap(d, 1));
    const first = t.consume(snap(d, 2, [earned("a")]));
    expect(first).toEqual([{ id: "1:piece.earned:a", event: "piece.earned", text: "Pieza conseguida: Lupa." }]);
    expect(t.consume(snap(d, 3, [earned("a")]))).toEqual([]); // mismo effectId: ya sonó
    expect(t.consume(snap(d, 4, [earned("b", "dialogo")]))).toMatchObject([{ event: "piece.earned", text: "Pieza conseguida: Bocadillo." }]);
  });

  it("colocar las piezas y terminar la aventura tienen su evento y su texto", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.consume(snap(d, 1));
    const out = t.consume(snap(d, 2, [{ effectId: "1:pieces.placed", kind: "pieces.placed" }, { effectId: "1:adventure.finished", kind: "adventure.finished" }]));
    expect(out.map((s) => s.event)).toEqual(["inventor.activated", "adventure.finished"]);
    expect(out[0]!.text).toBe(config.ui.labels.signalPiecesPlaced);
    expect(out[1]!.text).toBe(config.ui.labels.signalFinished); // el mensaje de cierre ya está en la tarjeta final: no se anuncia dos veces
  });

  it("tras perder la conexión el siguiente snapshot vuelve a ser línea de base: una reconexión no repite nada", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.consume(snap(d, 1));
    t.consume(snap(d, 2, [earned("a")]));
    t.reset();
    expect(t.consume(snap(d, 5, [earned("a"), earned("z")]))).toEqual([]); // ni lo ya sonado ni lo ocurrido mientras estaba desconectado
    expect(t.consume(snap(d, 6, [earned("n")]))).toHaveLength(1); // pero lo nuevo sí
  });

  it("un reinicio de la sala (otra generación) también es línea de base, y lo que pasa después vuelve a sonar", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.consume(snap(d, 1));
    t.consume(snap(d, 2, [earned("a")]));
    expect(t.consume(snap(new Driver(), 1, [], 2))).toEqual([]);
    expect(t.consume(snap(new Driver(), 2, [{ ...earned("a"), effectId: "2:piece.earned:a" }], 2))).toHaveLength(1);
  });

  it("el primer snapshot de otra generación no suena aunque su versión sea mayor y traiga efectos", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.consume(snap(d, 1));
    expect(t.consume(snap(new Driver(), 50, [{ effectId: "2:piece.earned:z", kind: "piece.earned", pieceId: "lupa" }, { effectId: "2:adventure.finished", kind: "adventure.finished" }], 2))).toEqual([]);
  });

  it("los efectos vistos en la línea de base no suenan cuando el siguiente snapshot los repite", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    expect(t.consume(snap(d, 1, [earned("a")]))).toEqual([]);
    expect(t.consume(snap(d, 2, [earned("a")]))).toEqual([]); // el servidor sigue listándolo: ya estaba cuando se abrió el juego
    expect(t.consume(snap(d, 3, [earned("a"), earned("b", "dialogo")]))).toHaveLength(1); // solo lo nuevo
  });

  it("la campanita suena al mirarla (una vez por mirada) y los otros objetos no", () => {
    const d = new Driver();
    finishShadows(d);
    d.do({ type: "adventure.returnToMap" });
    finishRamps(d);
    d.do({ type: "adventure.returnToMap" });
    openStation(d, "cajas");
    const t = createSignalTracker(config);
    d.do({ type: "boxes.shared.open" });
    t.consume(snap(d, 10));
    d.do({ type: "boxes.object.inspect", objectId: "lupa" });
    expect(t.consume(snap(d, 11))).toEqual([]);
    d.do({ type: "boxes.object.inspect", objectId: "campanita" });
    expect(t.consume(snap(d, 12))).toMatchObject([{ event: "boxes.bell", text: "Suena la campanita." }]);
    expect(t.consume(snap(d, 13))).toEqual([]); // sigue seleccionada: no vuelve a sonar
    d.do({ type: "boxes.object.inspect", objectId: "piedra" });
    t.consume(snap(d, 14));
    d.do({ type: "boxes.object.inspect", objectId: "campanita" });
    expect(t.consume(snap(d, 15))).toHaveLength(1); // otra mirada, otra campanada
  });

  it("anotar una posición que cuenta hace «clic»; una muy parecida o reiniciar el experimento no", () => {
    const d = new Driver();
    openStation(d, "sombras");
    d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    const t = createSignalTracker(config);
    t.consume(snap(d, 1));
    d.do({ type: "shadows.light.set", distanceCm: 20, commitSample: true });
    expect(t.consume(snap(d, 2))).toMatchObject([{ event: "shadows.click", text: "Se anotó la posición de la linterna." }]);
    d.do({ type: "shadows.light.set", distanceCm: 22, commitSample: true }); // demasiado parecida: no cuenta
    expect(t.consume(snap(d, 3))).toEqual([]);
    d.do({ type: "experiment.reset" });
    expect(t.consume(snap(d, 4))).toEqual([]);
  });

  it("un snapshot más viejo o repetido no produce señales ni retrasa la línea de base", () => {
    const d = new Driver();
    openStation(d, "sombras");
    d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    const t = createSignalTracker(config);
    const before = d.state;
    t.consume(snap(d, 5));
    d.do({ type: "shadows.light.set", distanceCm: 20, commitSample: true });
    expect(t.consume(snap(d, 6))).toHaveLength(1);
    const older = new Driver();
    older.state = before;
    expect(t.consume(snap(older, 5))).toEqual([]); // viejo
    expect(t.consume(snap(older, 4, [earned("tardio")]))).toEqual([]); // viejo, aunque traiga un efecto que no se había visto
    expect(t.consume(snap(d, 6))).toEqual([]); // repetido
    void finishBoxes;
  });
});
