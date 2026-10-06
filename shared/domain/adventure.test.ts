import { describe, expect, it } from "vitest";
import type { AdventureAction } from "../contracts/actions";
import { bundle, ana, beto, Driver, finishBoxes, finishRamps, finishShadows, openStation } from "../testing/drive";
import { allRouteCompleted, createInitialAdventure, derivePieces, playerAt, reduceAdventure, runningTrial, unlockedActivityIds } from "./adventure";
import { rampDurationMs } from "./models";

const { config } = bundle;

describe("el reductor es puro", () => {
  it("no muta el estado de entrada, ni aceptando ni rechazando una acción", () => {
    const d = new Driver();
    openStation(d, "sombras");
    const snapshot = JSON.stringify(d.state);
    const frozen = structuredClone(d.state);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === "object") {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
    };
    deepFreeze(frozen);
    const ok = reduceAdventure(frozen, { type: "shadows.surprise.ack" }, d.ctx(ana));
    expect(ok.ok).toBe(true); // si mutara, lanzaría sobre el objeto congelado
    const bad = reduceAdventure(frozen, { type: "ramps.trial.start" }, d.ctx(ana));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

describe("recorrido y mapa", () => {
  it("la siguiente mesa se habilita al completar la anterior; el inventor, al completar las tres", () => {
    const d = new Driver();
    expect(unlockedActivityIds(d.state, config)).toEqual(["sombras"]);
    expect(d.do({ type: "station.open", stationId: "rampas", origin: "quickNav" })).toBe(false);
    expect(d.lastError?.code).toBe("INVALID_STEP");
    expect(d.do({ type: "station.open", stationId: "inventor", origin: "quickNav" })).toBe(false);
    finishShadows(d);
    expect(unlockedActivityIds(d.state, config)).toEqual(["sombras", "rampas"]);
    finishRamps(d);
    finishBoxes(d);
    expect(allRouteCompleted(d.state, config)).toBe(true);
  });

  it("tocar un destino crea un plan del servidor; mover ocupa tiempo activo y llega exactamente al destino", () => {
    const d = new Driver();
    const target = bundle.map.stations[1]!.point;
    expect(d.do({ type: "player.moveTo", target })).toBe(true);
    const plan = d.state.player.plan!;
    expect(plan.points[0]).toEqual(bundle.map.spawns[config.world.initialSpawnId]);
    expect(plan.points.at(-1)).toEqual(target);
    expect(plan.speed).toBe(config.world.playerSpeed);
    d.tick(500);
    const mid = playerAt(d.state, d.activeMs);
    expect(mid.moving).toBe(true);
    d.tick(60_000);
    expect(d.state.player.plan).toBeNull();
    expect(d.state.player.feet).toEqual(target);
  });

  it("rechaza destinos fuera del mapa, dentro de obstáculos, no finitos, y no deja al personaje atrapado", () => {
    const d = new Driver();
    const before = JSON.stringify(d.state);
    for (const target of [{ x: -10, y: 300 }, { x: 640, y: 270 }, { x: Number.POSITIVE_INFINITY, y: 0 }, { x: 640, y: 50 }]) {
      expect(d.do({ type: "player.moveTo", target })).toBe(false);
      expect(d.lastError?.code).toBe("INVALID_PAYLOAD");
      expect(d.lastError?.message.length).toBeGreaterThan(10);
    }
    expect(JSON.stringify(d.state)).toBe(before);
    expect(d.do({ type: "player.moveTo", target: bundle.map.stations[0]!.point })).toBe(true); // sigue pudiendo moverse
  });

  it("un nuevo destino a mitad de camino parte de la posición interpolada actual", () => {
    const d = new Driver();
    d.do({ type: "player.moveTo", target: bundle.map.stations[2]!.point });
    d.tick(1500);
    const here = playerAt(d.state, d.activeMs).feet;
    d.do({ type: "player.moveTo", target: bundle.map.stations[0]!.point });
    expect(d.state.player.plan!.points[0]).toEqual(here);
  });

  it("abrir desde el mapa exige proximidad; la lista de mesas no; abrir detiene el movimiento y conserva la posición", () => {
    const d = new Driver();
    expect(d.do({ type: "station.open", stationId: "sombras", origin: "map" })).toBe(false); // lejos
    expect(d.lastError?.message).toContain("Acércate");
    d.do({ type: "player.moveTo", target: bundle.map.stations[0]!.point });
    d.tick(60_000);
    expect(d.do({ type: "station.open", stationId: "sombras", origin: "map" })).toBe(true);
    expect(d.state.view).toEqual({ kind: "activity", activityId: "sombras" });
    expect(d.do({ type: "player.moveTo", target: { x: 600, y: 600 } })).toBe(false); // mesa ocupada: sin navegación
    const feet = d.state.player.feet;
    d.do({ type: "adventure.returnToMap" });
    expect(d.state.player.feet).toEqual(feet);
  });
});

describe("Sombras", () => {
  it("sigue el orden de pasos y no permite saltarlos", () => {
    const d = new Driver();
    openStation(d, "sombras");
    expect(d.do({ type: "shadows.light.set", distanceCm: 20, commitSample: true })).toBe(false); // antes de la primera idea
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "oral" } })).toBe(false);
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } })).toBe(false);
    expect(d.act.sombras!.step).toBe("surprise");
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text: "  Por la luz  " } })).toBe(true); // la sorpresa es opcional
    expect(d.act.sombras!.step).toBe("explore");
    expect(d.state.notebook[0]).toMatchObject({ field: "firstIdea", text: "Por la luz", authorName: "Ana", revision: 1 });
  });

  it("dos posiciones iguales o muy cercanas no bastan; dos distintas sí (separación mínima de 5 cm)", () => {
    const d = new Driver();
    openStation(d, "sombras");
    d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    d.do({ type: "shadows.light.set", distanceCm: 30, commitSample: true });
    d.do({ type: "shadows.light.set", distanceCm: 30, commitSample: true });
    d.do({ type: "shadows.light.set", distanceCm: 33, commitSample: true });
    d.do({ type: "shadows.light.set", distanceCm: 34.9, commitSample: true });
    expect(d.act.sombras!.step).toBe("explore");
    expect((d.act.sombras as any).samples.filter((s: any) => s.counts)).toHaveLength(1);
    d.do({ type: "shadows.light.set", distanceCm: 35, commitSample: true });
    expect(d.act.sombras!.step).toBe("observation");
  });

  it("un gesto continuo se comparte pero no cuenta como exploración: solo la muestra confirmada", () => {
    const d = new Driver();
    openStation(d, "sombras");
    d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    for (let cm = 15; cm <= 55; cm += 1) d.do({ type: "shadows.light.set", distanceCm: cm, commitSample: false });
    expect((d.act.sombras as any).distanceCm).toBe(55);
    expect((d.act.sombras as any).samples).toHaveLength(0);
    expect(d.act.sombras!.step).toBe("explore");
  });

  it("rechaza distancias fuera de rango o no finitas", () => {
    const d = new Driver();
    openStation(d, "sombras");
    d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    for (const cm of [9.9, 60.1, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(d.do({ type: "shadows.light.set", distanceCm: cm, commitSample: false }), String(cm)).toBe(false);
  });

  it("completa con la lupa una sola vez, registra las condiciones y conserva la primera idea entre turnos", () => {
    const d = new Driver();
    finishShadows(d);
    expect(d.act.sombras!.step).toBe("completed");
    expect(d.state.pieces).toEqual(["lupa"]);
    expect(d.effects.filter((e) => e.kind === "piece.earned")).toHaveLength(1);
    expect((d.act.sombras as any).conditions).toEqual({ screenDistanceCm: 25, objectHeightCm: 8, sampleDistancesCm: [20, 50] });
    const first = d.state.notebook.find((r) => r.field === "firstIdea")!;
    expect(first).toMatchObject({ authorId: ana.principalId, text: "Será por la luz" });
    // Otro jugador edita la primera idea con una explicación revisada: la original queda en el historial.
    expect(d.do({ type: "record.edit", recordId: first.id, expectedRevision: 1, value: { modality: "written", text: "Ahora creo que es la distancia" } }, beto)).toBe(true);
    const edited = d.state.notebook.find((r) => r.id === first.id)!;
    expect(edited).toMatchObject({ field: "firstIdea", revision: 2, text: "Ahora creo que es la distancia", authorId: ana.principalId, lastEditor: { name: "Beto" } });
    expect(edited.history).toHaveLength(1);
    expect(edited.history[0]).toMatchObject({ revision: 1, text: "Será por la luz", authorName: "Ana" });
  });

  it("repetir el cierre de la mesa no duplica pieza ni efecto", () => {
    const d = new Driver();
    finishShadows(d);
    const effects = d.effects.length;
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } })).toBe(false);
    expect(d.state.pieces).toEqual(["lupa"]);
    expect(d.effects).toHaveLength(effects);
  });

  it("incertidumbre y oral satisfacen idea y observación; la pregunta nueva no admite incertidumbre", () => {
    const d = new Driver();
    openStation(d, "sombras");
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "uncertain" } })).toBe(true);
    d.do({ type: "shadows.light.set", distanceCm: 15, commitSample: true });
    d.do({ type: "shadows.light.set", distanceCm: 45, commitSample: true });
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "observation", value: { modality: "oral" } })).toBe(true);
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "uncertain" } })).toBe(false);
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "nextQuestion", value: { modality: "oral" } })).toBe(true);
    expect(d.state.notebook.map((r) => [r.field, r.modality, r.text])).toEqual([["firstIdea", "uncertain", null], ["observation", "oral", null], ["nextQuestion", "oral", null]]);
  });
});

describe("formularios comunes", () => {
  it("cuentan caracteres Unicode después de recortar: 280 sí, 281 no", () => {
    const d = new Driver();
    openStation(d, "sombras");
    const confirm = (text: string) => d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "written", text } });
    expect(confirm("🔬".repeat(281))).toBe(false);
    expect(confirm("   ")).toBe(false);
    expect(confirm("")).toBe(false);
    expect(confirm(`  ${"ñ".repeat(280)}  `)).toBe(true);
  });
  it("rechaza una sugerencia inexistente, una de otro campo y un campo fuera de paso", () => {
    const d = new Driver();
    openStation(d, "sombras");
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "suggested", optionId: "inventada" } })).toBe(false);
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "suggested", optionId: "mover-objeto" } })).toBe(false); // es una pregunta, no una idea
    expect(d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "suggested", optionId: "la-luz" } })).toBe(true);
    expect(d.state.notebook[0]!.text).toBe("Creo que la luz tiene algo que ver."); // texto resuelto por el servidor
  });
  it("rechaza confirmar el registro de una mesa que no es la abierta", () => {
    const d = new Driver();
    openStation(d, "sombras");
    expect(d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } })).toBe(false);
  });
  it("una edición con revisión antigua se rechaza (REVISION_CONFLICT) y no cambia nada", () => {
    const d = new Driver();
    openStation(d, "sombras");
    d.do({ type: "record.confirm", activityId: "sombras", field: "firstIdea", value: { modality: "oral" } });
    const id = d.state.notebook[0]!.id;
    expect(d.do({ type: "record.edit", recordId: id, expectedRevision: 1, value: { modality: "written", text: "a" } }, ana)).toBe(true);
    expect(d.do({ type: "record.edit", recordId: id, expectedRevision: 1, value: { modality: "written", text: "b" } }, beto)).toBe(false);
    expect(d.lastError?.code).toBe("REVISION_CONFLICT");
    expect(d.state.notebook[0]).toMatchObject({ revision: 2, text: "a" });
    expect(d.do({ type: "record.edit", recordId: "r999", expectedRevision: 1, value: { modality: "oral" } })).toBe(false);
  });
});

describe("Rampas", () => {
  const toTrials = (d: Driver) => {
    openStation(d, "rampas");
    d.do({ type: "ramps.question.open" });
    d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "written", text: "¿Y si la rampa fuera más larga?" } });
    d.do({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "uncertain" } });
  };

  it("no permite experimentar antes de abrir la pregunta y confirmar la predicción", () => {
    const d = new Driver();
    finishShadows(d);
    openStation(d, "rampas");
    for (const action of [{ type: "ramps.trial.start" }, { type: "ramps.angle.set", angleDeg: 30 }] as AdventureAction[]) expect(d.do(action)).toBe(false);
    expect(d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } })).toBe(false); // aún en la respuesta cerrada
    d.do({ type: "ramps.question.open" });
    expect(d.do({ type: "ramps.trial.start" })).toBe(false);
    d.do({ type: "record.confirm", activityId: "rampas", field: "question", value: { modality: "oral" } });
    expect(d.do({ type: "ramps.trial.start" })).toBe(false); // falta la predicción
    d.do({ type: "record.confirm", activityId: "rampas", field: "prediction", value: { modality: "oral" } });
    expect(d.do({ type: "ramps.trial.start" })).toBe(true);
  });

  it("el servidor crea una sola prueba: una segunda suelta o cambiar la inclinación durante una prueba se rechaza", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    d.do({ type: "ramps.angle.set", angleDeg: 25 });
    expect(d.do({ type: "ramps.trial.start" })).toBe(true);
    expect(d.do({ type: "ramps.trial.start" })).toBe(false);
    expect(d.do({ type: "ramps.angle.set", angleDeg: 35 })).toBe(false);
    expect((d.act.rampas as any).trials).toHaveLength(1);
    expect(runningTrial(d.act.rampas as any)).toMatchObject({ trialId: "t1", angleDeg: 25, model: "solid-sphere-ideal-v1", lengthMeters: 2, visualTimeScale: 2.4, state: "running" });
  });

  it("la duración y el resultado derivan del modelo y se congelan en la prueba", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    d.do({ type: "ramps.angle.set", angleDeg: 15 });
    d.do({ type: "ramps.trial.start" });
    const t = (d.act.rampas as any).trials[0];
    expect(t.durationMs).toBe(rampDurationMs(15, 2, 2.4));
    expect(t.durationMs).toBeGreaterThanOrEqual(3500);
    expect(t.durationMs).toBeLessThanOrEqual(3600);
  });

  it("el final lo decide el servidor, una sola vez y en su instante exacto aunque se procese tarde", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    d.do({ type: "ramps.angle.set", angleDeg: 45 });
    d.do({ type: "ramps.trial.start" });
    const t = (d.act.rampas as any).trials[0];
    d.tick(t.durationMs - 1);
    expect(runningTrial(d.act.rampas as any)).toBeDefined();
    d.tick(90_000); // se procesa mucho después
    const done = (d.act.rampas as any).trials[0];
    expect(done).toMatchObject({ state: "finished", endedActiveMs: done.startActiveMs + done.durationMs });
  });

  it("la pausa conserva el tiempo transcurrido: sin avance del reloj activo no termina la prueba (CA-11)", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    d.do({ type: "ramps.angle.set", angleDeg: 30 });
    d.do({ type: "ramps.trial.start" });
    d.tick(1000);
    const frozen = JSON.stringify(d.state);
    // Mientras dura la «pausa» el reloj activo no avanza: reprocesar el mismo instante no cambia nada, por mucho que pase el tiempo real.
    for (let i = 0; i < 5; i++) d.tick(0);
    expect(JSON.stringify(d.state)).toBe(frozen);
    d.tick(500);
    const t = (d.act.rampas as any).trials[0];
    expect(d.activeMs - t.startActiveMs).toBe(1500); // la conversación no se suma
    expect(t.state).toBe("running");
  });

  it("exige inclinaciones válidas: rango 15°–45° de 5° en 5°", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    for (const a of [10, 50, 17, 22.5, Number.NaN]) expect(d.do({ type: "ramps.angle.set", angleDeg: a }), String(a)).toBe(false);
    for (const a of [15, 20, 45]) expect(d.do({ type: "ramps.angle.set", angleDeg: a }), String(a)).toBe(true);
  });

  it("dos pruebas con la misma inclinación no bastan; con inclinaciones distintas pasa a observación (CA-16)", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    for (const angle of [30, 30]) {
      d.do({ type: "ramps.angle.set", angleDeg: angle });
      d.do({ type: "ramps.trial.start" });
      d.tick(6000);
    }
    expect(d.act.rampas!.step).toBe("trials");
    d.do({ type: "ramps.angle.set", angleDeg: 35 }); // diferencia 5° = mínima
    d.do({ type: "ramps.trial.start" });
    d.tick(6000);
    expect(d.act.rampas!.step).toBe("observation");
    expect((d.act.rampas as any).trials.map((t: any) => t.angleDeg)).toEqual([30, 30, 35]);
  });

  it("una predicción equivocada, la duda o la participación oral siguen permitiendo completar con el bocadillo", () => {
    const d = new Driver();
    finishShadows(d);
    finishRamps(d);
    expect(d.act.rampas!.step).toBe("completed");
    expect(d.state.pieces).toEqual(["lupa", "dialogo"]);
  });

  it("reiniciar el experimento repone controles, cancela la prueba en curso y no borra pruebas terminadas, cuaderno ni piezas", () => {
    const d = new Driver();
    finishShadows(d);
    toTrials(d);
    d.do({ type: "ramps.angle.set", angleDeg: 20 });
    d.do({ type: "ramps.trial.start" });
    d.tick(5000);
    d.do({ type: "ramps.angle.set", angleDeg: 35 });
    d.do({ type: "ramps.trial.start" });
    d.tick(500);
    const notebook = d.state.notebook.length;
    expect(d.do({ type: "experiment.reset" })).toBe(true);
    const r = d.act.rampas as any;
    expect(r.angleDeg).toBe(15);
    expect(r.trials.map((t: any) => t.state)).toEqual(["finished", "cancelled"]);
    expect(d.state.notebook).toHaveLength(notebook);
    expect(d.state.pieces).toEqual(["lupa"]);
    d.tick(10_000);
    expect(r.trials.filter((t: any) => t.state === "finished")).toHaveLength(1); // la cancelada no cuenta
    expect((d.act.rampas as any).trials[1].state).toBe("cancelled");
  });
});

describe("La caja de las sorpresas", () => {
  const toRefusal = (d: Driver) => {
    openStation(d, "cajas");
    d.do({ type: "boxes.shared.open" });
    d.do({ type: "boxes.object.inspect", objectId: "piedra" });
    d.do({ type: "boxes.permission.ask" });
  };
  const prep = () => {
    const d = new Driver();
    finishShadows(d);
    finishRamps(d);
    return d;
  };

  it("exige abrir la caja y explorar un objeto compartido antes de pedir permiso", () => {
    const d = prep();
    openStation(d, "cajas");
    expect(d.do({ type: "boxes.object.inspect", objectId: "campanita" })).toBe(false); // caja cerrada
    expect(d.do({ type: "boxes.permission.ask" })).toBe(false);
    d.do({ type: "boxes.shared.open" });
    expect(d.do({ type: "boxes.permission.ask" })).toBe(false); // aún sin explorar
    expect(d.do({ type: "boxes.object.inspect", objectId: "tesoro" })).toBe(false);
    expect(d.do({ type: "boxes.object.inspect", objectId: "campanita" })).toBe(true);
    expect(d.act.cajas!.step).toBe("askPermission");
  });

  it("la negativa y el respeto son pasos en orden; cambiar de jugador entre ellos conserva el paso (CA-19)", () => {
    const d = prep();
    toRefusal(d);
    expect(d.act.cajas!.step).toBe("refusal");
    expect(d.do({ type: "boxes.refusal.respect" }, beto)).toBe(false); // no se salta la lectura
    expect(d.do({ type: "boxes.refusal.ack" }, beto)).toBe(true);
    expect(d.act.cajas!.step).toBe("respect");
    // «Cambio de jugador»: el estado de la mesa viaja intacto en el snapshot.
    expect(d.do({ type: "boxes.refusal.respect" }, ana)).toBe(true);
    expect(d.act.cajas!.step).toBe("nextQuestion");
  });

  it("no existe en el dominio ninguna forma de abrir la caja personal ni dato que la revele", () => {
    const d = prep();
    toRefusal(d);
    const serialized = JSON.stringify([d.state, config.activities.cajas]);
    expect(serialized).not.toMatch(/contenido de la caja personal/i);
    expect(Object.keys(d.act.cajas!).sort()).toEqual(["inspected", "selectedObjectId", "sharedOpen", "step", "type"].sort());
    expect(config.activities.cajas).toMatchObject({ personalBox: { label: expect.any(String), ownerLabel: expect.any(String) } });
    expect(Object.keys((config.activities.cajas as any).personalBox).sort()).toEqual(["label", "ownerLabel"]);
    for (const type of ["boxes.personal.open", "openPersonalBox"]) expect(d.do({ type } as unknown as AdventureAction)).toBe(false);
  });

  it("después del respeto se vuelve a un objeto compartido y la pregunta vincula objeto y pregunta", () => {
    const d = prep();
    toRefusal(d);
    d.do({ type: "boxes.refusal.ack" });
    d.do({ type: "boxes.refusal.respect" });
    expect(d.do({ type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "oral" } })).toBe(false); // falta el objeto
    expect(d.do({ type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "written", text: "¿Por qué es lisa?" }, objectId: "piedra" })).toBe(true);
    expect(d.state.notebook.at(-1)).toMatchObject({ field: "question", objectId: "piedra", text: "¿Por qué es lisa?" });
    expect(d.state.pieces).toEqual(["lupa", "dialogo", "corazon"]);
  });

  it("una pregunta sugerida usa el objeto de la opción; no admite otro distinto", () => {
    const d = prep();
    toRefusal(d);
    d.do({ type: "boxes.refusal.ack" });
    d.do({ type: "boxes.refusal.respect" });
    expect(d.do({ type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "suggested", optionId: "sonido" }, objectId: "piedra" })).toBe(false);
    expect(d.do({ type: "record.confirm", activityId: "cajas", field: "question", value: { modality: "suggested", optionId: "sonido" } })).toBe(true);
    expect(d.state.notebook.at(-1)).toMatchObject({ objectId: "campanita" });
  });
});

describe("piezas, inventor y final", () => {
  const all = () => {
    const d = new Driver();
    finishShadows(d);
    finishRamps(d);
    finishBoxes(d);
    return d;
  };

  it("las piezas se derivan de las mesas completadas; no hay acción de cliente que las conceda", () => {
    const d = new Driver();
    expect(derivePieces(d.state, config)).toEqual([]);
    for (const type of ["grantPiece", "setPieces", "setResult", "setState"]) expect(d.do({ type, piece: "lupa" } as unknown as AdventureAction)).toBe(false);
    finishShadows(d);
    expect(d.state.pieces).toEqual(derivePieces(d.state, config));
  });

  it("colocar las piezas exige las tres, una sola vez, con la máquina abierta", () => {
    const d = new Driver();
    finishShadows(d);
    d.state.view = { kind: "final" };
    expect(d.do({ type: "inventor.placePieces" })).toBe(false); // faltan piezas
    const full = all();
    expect(full.do({ type: "inventor.placePieces" })).toBe(false); // máquina cerrada
    openStationInventor(full);
    expect(full.do({ type: "inventor.placePieces" })).toBe(true);
    expect(full.do({ type: "inventor.placePieces" })).toBe(false);
    expect(full.effects.filter((e) => e.kind === "pieces.placed")).toHaveLength(1);
  });

  it("la pregunta final exige piezas colocadas y admite escrita, sugerida, oral o guardada; termina la aventura una vez", () => {
    for (const value of [
      { modality: "written", text: "¿Por qué sale el arcoíris?" },
      { modality: "suggested", optionId: "aumento" },
      { modality: "oral" },
      { modality: "saved", recordId: "" },
    ] as const) {
      const d = all();
      openStationInventor(d);
      const v = value.modality === "saved" ? { ...value, recordId: d.state.notebook.find((r) => r.field === "nextQuestion")!.id } : value;
      expect(d.do({ type: "inventor.question.confirm", value: v }), "sin piezas colocadas").toBe(false);
      d.do({ type: "inventor.placePieces" });
      expect(d.do({ type: "inventor.question.confirm", value: v }), value.modality).toBe(true);
      expect(d.finished).toBe(true);
      expect(d.state.notebook.at(-1)).toMatchObject({ field: "finalQuestion", activityId: "inventor", modality: v.modality === "saved" ? "suggested" : v.modality });
      expect(d.do({ type: "inventor.question.confirm", value: v })).toBe(false); // no se vuelve a confirmar ni se borra
      expect(d.effects.filter((e) => e.kind === "adventure.finished")).toHaveLength(1);
    }
  });

  it("rechaza una pregunta guardada que no es una pregunta y una sugerencia inexistente", () => {
    const d = all();
    openStationInventor(d);
    d.do({ type: "inventor.placePieces" });
    const idea = d.state.notebook.find((r) => r.field === "firstIdea")!;
    expect(d.do({ type: "inventor.question.confirm", value: { modality: "saved", recordId: idea.id } })).toBe(false);
    expect(d.do({ type: "inventor.question.confirm", value: { modality: "saved", recordId: "r999" } })).toBe(false);
    expect(d.do({ type: "inventor.question.confirm", value: { modality: "suggested", optionId: "inventada" } })).toBe(false);
    expect(d.do({ type: "inventor.question.confirm", value: { modality: "written", text: "   " } })).toBe(false);
  });

  it("revisitas: se puede volver a una mesa completada sin reiniciar pasos ni conceder otra pieza", () => {
    const d = all();
    d.state.view = { kind: "map" };
    expect(d.do({ type: "station.open", stationId: "rampas", origin: "quickNav" })).toBe(true);
    expect(d.act.rampas!.step).toBe("completed");
    const pieces = d.state.pieces.length;
    d.do({ type: "ramps.angle.set", angleDeg: 25 });
    expect(d.do({ type: "ramps.trial.start" })).toBe(true); // nuevas pruebas amplían la comparación
    expect(d.do({ type: "record.confirm", activityId: "rampas", field: "observation", value: { modality: "oral" } })).toBe(false);
    expect(d.state.pieces).toHaveLength(pieces);
    expect(d.act.rampas!.step).toBe("completed");
  });
});

function openStationInventor(d: Driver) {
  d.state.view = { kind: "map" };
  if (!d.do({ type: "station.open", stationId: "inventor", origin: "quickNav" })) throw new Error(d.lastError?.message);
}

describe("estado inicial", () => {
  it("empieza en el spawn configurado, en el mapa y con las tres mesas en su primer paso", () => {
    const s = createInitialAdventure(config, bundle.map);
    expect(s.player.feet).toEqual(bundle.map.spawns[config.world.initialSpawnId]);
    expect(s.view).toEqual({ kind: "map" });
    expect(Object.fromEntries(Object.entries(s.activities).map(([k, v]) => [k, v.step]))).toEqual({ sombras: "surprise", rampas: "closedAnswer", cajas: "exploreShared" });
    expect(s.pieces).toEqual([]);
    expect(s.notebook).toEqual([]);
  });
});
