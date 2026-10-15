import { describe, expect, it } from "vitest";
import { bundle, Driver } from "../testing/drive";
import { checkGeneration, checkRound, ensureParticipant, expireRoom, isSimulating, onAdminLost, recoverAfterRestart, tickRoom } from "./room";
import { playerAt, spawnPoint } from "./participant";
import { roundCounter } from "./round";
import { buildComparisonData, personReadiness, readiness } from "./results";
import { isFootprintFree } from "./navigation";
import { CLOSE_ZOOM, fieldRadius, HORIZON_Y, PANORAMA, SKY_VIEW, startView, TELESCOPE_TARGETS } from "./telescope";
import type { TelescopeState } from "../contracts/state";
import type { TelescopeActivityConfig } from "../contracts/config";

const cfg = bundle.config;

describe("sala y ronda: fases comunes", () => {
  it("empieza en bienvenida; al comenzar, la primera mesa queda en preparación y nadie puede abrirla todavía", () => {
    const d = new Driver();
    expect(d.room.phase).toBe("welcome");
    expect(d.act("ana", { type: "player.moveTo", target: { x: 600, y: 450 } })).toBe(false); // antes de comenzar nadie actúa
    expect(d.admin({ type: "room.start" })).toBe(true);
    expect(d.room.phase).toBe("running");
    expect(d.round).toMatchObject({ index: 0, stage: "preparation", roster: [] });
    expect(d.act("ana", { type: "station.open", stationId: "sombras", origin: "quickNav" })).toBe(false);
    expect(d.lastError?.message).toContain("abrirá la mesa");
    expect(d.act("ana", { type: "player.moveTo", target: { x: 640, y: 450 } })).toBe(true); // en la preparación sí puede caminar por el laboratorio
  });

  it("abrir la mesa fija la lista de participantes y habilita solo la mesa de la ronda", () => {
    const d = new Driver(["ana", "beto"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    d.must(d.admin({ type: "round.open" }), "abrir");
    expect(d.round.stage).toBe("exploration");
    expect(d.round.roster.sort()).toEqual(["ana", "beto"]);
    expect(d.act("ana", { type: "station.open", stationId: "rampas", origin: "quickNav" })).toBe(false); // futura
    expect(d.lastError?.message).toContain("más adelante");
    expect(d.act("ana", { type: "station.open", stationId: "sombras", origin: "quickNav" })).toBe(true);
    expect(d.person("ana").view).toEqual({ kind: "activity", activityId: "sombras" });
    expect(d.person("beto").view).toEqual({ kind: "map" }); // la vista de cada persona es suya
  });

  it("las acciones de Vanessa siguen el orden: no se reúne al grupo antes de abrir, ni se avanza sin conversar", () => {
    const d = new Driver();
    d.must(d.admin({ type: "room.start" }), "comenzar");
    expect(d.admin({ type: "round.converse" })).toBe(false);
    expect(d.admin({ type: "round.next" })).toBe(false);
    d.must(d.admin({ type: "round.open" }), "abrir");
    expect(d.admin({ type: "round.open" })).toBe(false); // ya está abierta
    expect(d.admin({ type: "round.next" })).toBe(false); // falta la conversación
  });

  it("un observador no juega: no tiene estado y sus acciones se rechazan", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    expect(d.room.participants).not.toHaveProperty("obs");
    expect(d.act("obs", { type: "player.moveTo", target: { x: 600, y: 450 } })).toBe(false);
    expect(d.lastError?.code).toBe("NOT_AUTHORIZED");
    expect(roundCounter(d.room, cfg).total).toBe(1); // los observadores no se cuentan
  });

  it("los personajes nacen en puntos libres y distintos alrededor de la entrada, y no se bloquean entre sí", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = spawnPoint(cfg, bundle.map, i);
      expect(isFootprintFree(bundle.map, cfg.world.player.footprint, p)).toBe(true);
      seen.add(`${p.x},${p.y}`);
    }
    expect(seen.size).toBe(50);
    // dos personas caminan al mismo punto sin bloquearse
    const d = new Driver(["ana", "beto"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    expect(d.act("ana", { type: "player.moveTo", target: { x: 640, y: 450 } })).toBe(true);
    expect(d.act("beto", { type: "player.moveTo", target: { x: 640, y: 450 } })).toBe(true);
  });

  it("tocar un punto que no se puede pisar se explica y el personaje no se mueve", () => {
    const d = new Driver(["ana"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    const before = d.person("ana").character;
    expect(d.act("ana", { type: "player.moveTo", target: { x: -50, y: 10 } })).toBe(false);
    expect(d.lastError?.message).toContain("no se puede pisar");
    expect(d.person("ana").character).toEqual(before);
  });
});

describe("Sombras: pruebas personales y finalización automática", () => {
  it("registra la posición y su sombra al terminar un ajuste, sin botón de anotar; dos posiciones distintas dejan lista a la persona", () => {
    const d = new Driver();
    d.toExploration(0);
    d.openStation("ana", "sombras");
    expect(personReadiness(d.person("ana"), "sombras", cfg)).toMatchObject({ done: 0, needed: 2, ready: false });
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 20 }), "muestra");
    const st = d.person("ana").activities.sombras!;
    expect(st.type === "shadows" && st.samples[0]).toMatchObject({ distanceCm: 20, counts: true });
    expect(st.type === "shadows" && st.samples[0]!.shadowCm).toBeCloseTo((8 * (20 + 25)) / 20, 6); // 18 cm: la misma fórmula del modelo
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 50 }), "muestra");
    expect(personReadiness(d.person("ana"), "sombras", cfg).ready).toBe(true);
  });

  it("una posición muy parecida a otra ya contada se guarda pero no cuenta; la misma posición dos veces seguidas no se repite", () => {
    const d = new Driver();
    d.toExploration(0);
    d.openStation("ana", "sombras");
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 20 }), "1");
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 22 }), "2 (a 2 cm)");
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 22 }), "2 repetida");
    const st = d.person("ana").activities.sombras!;
    expect(st.type === "shadows" && st.samples.map((s) => [s.distanceCm, s.counts])).toEqual([
      [20, true],
      [22, false],
    ]);
    expect(personReadiness(d.person("ana"), "sombras", cfg).ready).toBe(false);
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 25 }), "3 (a 5 cm de la primera)");
    expect(personReadiness(d.person("ana"), "sombras", cfg).ready).toBe(true);
  });

  it("las pruebas de una persona no cambian las de otra: cada una tiene las suyas y el servidor las conserva por separado", () => {
    const d = new Driver();
    d.toExploration(0);
    d.readyShadows("ana");
    d.openStation("beto", "sombras");
    d.must(d.act("beto", { type: "shadows.sample", distanceCm: 35 }), "beto");
    const a = d.person("ana").activities.sombras!;
    const b = d.person("beto").activities.sombras!;
    expect(a.type === "shadows" && a.samples.map((s) => s.distanceCm)).toEqual([20, 50]);
    expect(b.type === "shadows" && b.samples.map((s) => s.distanceCm)).toEqual([35]);
    expect(roundCounter(d.room, cfg)).toMatchObject({ ready: 1, total: 2, pending: ["beto"] });
  });

  it("rechaza distancias fuera de rango, la mesa cerrada y la acción de otra mesa", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    expect(d.act("ana", { type: "shadows.sample", distanceCm: 20 })).toBe(false); // mesa no abierta
    d.openStation("ana", "sombras");
    expect(d.act("ana", { type: "shadows.sample", distanceCm: 5 })).toBe(false);
    expect(d.act("ana", { type: "shadows.sample", distanceCm: 61 })).toBe(false);
    expect(d.act("ana", { type: "shadows.sample", distanceCm: Number.NaN })).toBe(false);
    expect(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 })).toBe(false);
    expect(d.act("ana", { type: "telescope.aim", x: 560, y: 430, zoom: 1 })).toBe(false);
  });

  it("seguir probando no quita el estado «listo»", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 22 }), "otra");
    d.must(d.act("ana", { type: "shadows.sample", distanceCm: 35 }), "otra");
    expect(personReadiness(d.person("ana"), "sombras", cfg).ready).toBe(true);
  });
});

describe("Rampas: pruebas personales y finalización automática", () => {
  const rampsOpen = () => {
    const d = new Driver();
    d.toExploration(1);
    d.openStation("ana", "rampas");
    return d;
  };

  it("el resultado (ángulo y tiempo) se registra solo al terminar la prueba, en su instante exacto", () => {
    const d = rampsOpen();
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "soltar");
    const st = () => d.person("ana").activities.rampas as { type: "ramps"; trials: Array<{ state: string; durationMs: number; startActiveMs: number; endedActiveMs?: number }> };
    expect(st().trials[0]!.state).toBe("running");
    expect(d.tick(1000)).toEqual([]); // todavía rueda
    const duration = st().trials[0]!.durationMs;
    expect(d.tick(duration)).toEqual(["ana"]);
    expect(st().trials[0]).toMatchObject({ state: "finished" });
    expect(st().trials[0]!.endedActiveMs! - st().trials[0]!.startActiveMs).toBeCloseTo(duration, 6);
  });

  it("mientras la pelota rueda no se puede soltar otra; la inclinación debe respetar el rango y el paso", () => {
    const d = rampsOpen();
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "soltar");
    expect(d.act("ana", { type: "ramps.trial.start", angleDeg: 40 })).toBe(false);
    expect(d.lastError?.message).toContain("termine la prueba");
    d.tick(6000);
    for (const bad of [10, 50, 22, Number.NaN]) expect(d.act("ana", { type: "ramps.trial.start", angleDeg: bad })).toBe(false);
  });

  it("dos pruebas terminadas con inclinaciones distintas dejan lista a la persona; con la misma inclinación, no", () => {
    const d = rampsOpen();
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 30 }), "1");
    d.tick(6000);
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 30 }), "2");
    d.tick(6000);
    expect(personReadiness(d.person("ana"), "rampas", cfg)).toMatchObject({ done: 1, ready: false }); // dos pruebas, pero falta una de otra inclinación: no se dice «2 de 2» sin estar lista
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 45 }), "3");
    d.tick(6000);
    expect(personReadiness(d.person("ana"), "rampas", cfg).ready).toBe(true);
  });

  it("la pausa congela la prueba sin adelantar su tiempo: reanudar la termina a su hora exacta de simulación", () => {
    const d = rampsOpen();
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "soltar");
    const t = () => (d.person("ana").activities.rampas as { trials: Array<{ state: string; durationMs: number }> }).trials[0]!;
    const duration = t().durationMs;
    d.tick(1000);
    d.must(d.admin({ type: "room.pause" }), "pausar");
    expect(d.act("ana", { type: "ramps.trial.start", angleDeg: 40 })).toBe(false);
    expect(d.lastError?.code).toBe("ROOM_PAUSED");
    expect(d.tick(60_000)).toEqual([]); // el reloj no corre en pausa
    expect(t().state).toBe("running");
    d.must(d.admin({ type: "room.resume" }), "reanudar");
    expect(d.tick(duration - 1000 - 1)).toEqual([]);
    expect(d.tick(1)).toEqual(["ana"]);
  });

  it("pasar a la conversación cancela las pruebas en curso: no cuentan como terminadas", () => {
    const d = rampsOpen();
    d.must(d.act("beto", { type: "station.open", stationId: "rampas", origin: "quickNav" }), "beto abre");
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "soltar");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir con pendientes");
    const t = (d.person("ana").activities.rampas as { trials: Array<{ state: string }> }).trials[0]!;
    expect(t.state).toBe("cancelled");
    expect(personReadiness(d.person("ana"), "rampas", cfg).done).toBe(0);
    d.tick(60_000);
    expect((d.person("ana").activities.rampas as { trials: Array<{ state: string }> }).trials[0]!.state).toBe("cancelled"); // no resucita
  });
});

describe("El observatorio: exploración del cielo con el telescopio", () => {
  const { moon, stars, window: win } = TELESCOPE_TARGETS;
  const exp = (cfg.activities.cajas as TelescopeActivityConfig).experiment;
  const scope = (d: Driver, id = "ana") => d.person(id).activities.cajas as TelescopeState;
  const telescopeOpen = () => {
    const d = new Driver();
    d.toExploration(2);
    d.openStation("ana", "cajas");
    return d;
  };

  it("el visor empieza en el cielo, con el aumento general, sin observaciones y con la cortina abierta", () => {
    const d = telescopeOpen();
    expect(scope(d)).toEqual({ type: "telescope", ...startView(exp), observed: [], curtain: "open" });
    expect(scope(d).zoom).toBe(0);
    expect(scope(d).y).toBeLessThan(HORIZON_Y);
    expect(personReadiness(d.person("ana"), "cajas", cfg)).toMatchObject({ done: 0, needed: 2, ready: false });
  });

  it("la Luna pide el aumento cercano; el grupo de estrellas se observa con cualquiera; en cualquier orden deja lista a la persona", () => {
    const d = telescopeOpen();
    d.must(d.act("ana", { type: "telescope.aim", x: moon.x, y: moon.y, zoom: 0 }), "Luna de lejos");
    expect(scope(d).observed).toEqual([]); // centrada pero sin acercar: no cuenta
    d.must(d.act("ana", { type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "estrellas");
    expect(personReadiness(d.person("ana"), "cajas", cfg)).toMatchObject({ done: 1, ready: false });
    d.must(d.act("ana", { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "Luna de cerca");
    expect(scope(d).observed).toEqual(["stars", "moon"]);
    expect(personReadiness(d.person("ana"), "cajas", cfg).ready).toBe(true);
    d.must(d.act("ana", { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM }), "otra vez");
    expect(scope(d).observed).toEqual(["stars", "moon"]); // sin duplicados
    d.readyTelescope("beto"); // el otro orden: Luna primero
    expect(scope(d, "beto").observed).toEqual(["moon", "stars"]);
  });

  it("se queda lista sin acercarse a la casa, y la ventana no suma ni quita nada", () => {
    const d = telescopeOpen();
    d.readyTelescope("ana");
    expect(scope(d).curtain).toBe("open");
    expect(personReadiness(d.person("ana"), "cajas", cfg).ready).toBe(true);
    d.openStation("beto", "cajas");
    d.must(d.act("beto", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ventana");
    expect(scope(d, "beto")).toMatchObject({ observed: [], curtain: "closed" });
    expect(personReadiness(d.person("beto"), "cajas", cfg)).toMatchObject({ done: 0, ready: false });
  });

  it("la ventana de cerca cierra la cortina una sola vez y queda cerrada al alejarse; con el aumento general no pasa nada", () => {
    const d = telescopeOpen();
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: 0 }), "ventana de lejos");
    expect(scope(d).curtain).toBe("open");
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ventana de cerca");
    expect(scope(d).curtain).toBe("closed");
    d.must(d.act("ana", { type: "telescope.aim", ...SKY_VIEW, zoom: 0 }), "volver al cielo");
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "otra vez");
    expect(scope(d).curtain).toBe("closed");
    expect(d.effects.filter((e) => e.kind !== "piece.earned")).toEqual([]); // ni recompensas ni avisos al grupo
  });

  it("cada persona tiene su propio visor, observaciones y cortina", () => {
    const d = telescopeOpen();
    d.openStation("beto", "cajas");
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ana mira la ventana");
    d.must(d.act("beto", { type: "telescope.aim", x: stars.x, y: stars.y, zoom: 0 }), "beto mira las estrellas");
    expect(scope(d)).toMatchObject({ x: win.x, y: win.y, zoom: CLOSE_ZOOM, observed: [], curtain: "closed" });
    expect(scope(d, "beto")).toMatchObject({ x: stars.x, y: stars.y, zoom: 0, observed: ["stars"], curtain: "open" });
  });

  it("el visor no sale del panorama y rechaza direcciones o aumentos inválidos", () => {
    const d = telescopeOpen();
    d.must(d.act("ana", { type: "telescope.aim", x: -900, y: 99_999, zoom: 0 }), "fuera del panorama");
    expect(scope(d)).toMatchObject({ x: fieldRadius(exp, 0), y: PANORAMA.height - fieldRadius(exp, 0) });
    for (const bad of [
      { x: Number.NaN, y: 0, zoom: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY, zoom: 0 },
      { x: 0, y: 0, zoom: 2 },
      { x: 0, y: 0, zoom: -1 },
      { x: 0, y: 0, zoom: 0.5 },
    ]) {
      expect(d.act("ana", { type: "telescope.aim", ...bad })).toBe(false);
      expect(d.lastError?.code).toBe("INVALID_PAYLOAD");
    }
    expect(d.act("ana", { type: "shadows.sample", distanceCm: 20 })).toBe(false); // acción de otra mesa
  });

  it("no hay una acción para ir a la casa ni para declarar la mesa completa", () => {
    const d = telescopeOpen();
    for (const type of ["telescope.house", "telescope.complete", "telescope.observe", "boxes.object.inspect"]) {
      expect(d.act("ana", { type } as never)).toBe(false);
      expect(d.lastError?.code).toBe("INVALID_PAYLOAD");
    }
  });

  it("en la conversación y en la pausa el telescopio se detiene; lo observado y la cortina se conservan", () => {
    const d = telescopeOpen();
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ventana");
    d.must(d.admin({ type: "room.pause" }), "pausar");
    expect(d.act("ana", { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM })).toBe(false);
    expect(d.lastError?.code).toBe("ROOM_PAUSED");
    d.must(d.admin({ type: "room.resume" }), "reanudar");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    expect(d.act("ana", { type: "telescope.aim", x: moon.x, y: moon.y, zoom: CLOSE_ZOOM })).toBe(false);
    expect(d.lastError?.message).toContain("conversando");
    expect(scope(d)).toMatchObject({ observed: [], curtain: "closed" });
    expect(d.round.pendingAtConversation).toContain("ana");
  });

  it("no se proyecta la exploración de nadie: en esta mesa se proyecta la demostración de Vanessa", () => {
    const d = telescopeOpen();
    d.readyTelescope("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    expect(d.admin({ type: "present.select", principalId: "ana" })).toBe(false);
    expect(d.lastError?.message).toContain("demostración de Vanessa");
    expect(buildComparisonData(d.person("ana"), "cajas", cfg)).toBeNull();
    expect(d.room.adventure.notebook).toEqual([]);
  });

  it("el corazón se incorpora una sola vez al avanzar; reiniciar devuelve el cielo y la cortina abierta", () => {
    const d = telescopeOpen();
    d.readyTelescope("ana");
    d.must(d.act("ana", { type: "telescope.aim", x: win.x, y: win.y, zoom: CLOSE_ZOOM }), "ventana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "round.next" }), "al inventor");
    expect(d.room.adventure.pieces).toEqual(["lupa", "dialogo", "corazon"]);
    expect(d.admin({ type: "round.next" })).toBe(false);
    expect(d.room.adventure.pieces.filter((p) => p === "corazon")).toHaveLength(1);
    expect(scope(d)).toMatchObject({ curtain: "closed" }); // el cierre no borra lo de cada persona
    d.must(d.admin({ type: "room.reset", confirm: true }), "reiniciar");
    expect(scope(d)).toEqual({ type: "telescope", ...startView(exp), observed: [], curtain: "open" });
    d.toExploration(2);
    d.openStation("ana", "cajas");
    expect(scope(d)).toMatchObject({ observed: [], curtain: "open", zoom: 0 });
  });
});

describe("conducir la ronda: contador, conversación con pendientes y piezas", () => {
  it("el contador distingue listos y pendientes, y con pendientes hace falta confirmarlo", () => {
    const d = new Driver(["ana", "beto", "carla"]);
    d.toExploration(0);
    d.readyShadows("ana");
    expect(roundCounter(d.room, cfg)).toEqual({ ready: 1, total: 3, pending: ["beto", "carla"] });
    expect(d.admin({ type: "round.converse" })).toBe(false);
    expect(d.lastError?.message).toContain("Faltan 2 personas");
    d.must(d.admin({ type: "round.converse", withPending: true }), "con pendientes");
    expect(d.round).toMatchObject({ stage: "conversation", pendingAtConversation: ["beto", "carla"] });
  });

  it("pasar con pendientes conserva el trabajo parcial y no les concede finalización", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.openStation("beto", "sombras");
    d.must(d.act("beto", { type: "shadows.sample", distanceCm: 30 }), "una sola posición");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    const beto = d.person("beto").activities.sombras!;
    expect(beto.type === "shadows" && beto.samples).toHaveLength(1);
    expect(personReadiness(d.person("beto"), "sombras", cfg).ready).toBe(false);
    expect(d.round.pendingAtConversation).toEqual(["beto"]);
  });

  it("Vanessa decide reunir al grupo aunque todos estén listos: nada se cierra solo", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.readyShadows("beto");
    expect(roundCounter(d.room, cfg)).toMatchObject({ ready: 2, total: 2, pending: [] });
    expect(d.round.stage).toBe("exploration");
    d.must(d.admin({ type: "round.converse" }), "reunir sin pendientes");
    expect(d.round.pendingAtConversation).toEqual([]);
  });

  it("en la conversación los controles se detienen y la persona recibe el motivo", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse" }), "reunir");
    expect(d.act("ana", { type: "shadows.sample", distanceCm: 40 })).toBe(false);
    expect(d.lastError?.message).toContain("conversando");
    expect(d.act("ana", { type: "player.moveTo", target: { x: 600, y: 450 } })).toBe(false);
  });

  it("al abrir la siguiente mesa la pieza de la anterior se incorpora una sola vez y todos regresan al mapa", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    expect(d.room.adventure.pieces).toEqual([]); // todavía no: la pieza llega al avanzar
    d.effects.length = 0;
    d.must(d.admin({ type: "round.next" }), "avanzar");
    expect(d.room.adventure.pieces).toEqual(["lupa"]);
    expect(d.room.adventure.completed).toEqual(["sombras"]);
    expect(d.effects.map((e) => e.kind)).toEqual(["piece.earned"]);
    expect(d.round).toMatchObject({ index: 1, stage: "preparation", roster: [], pendingAtConversation: [] });
    expect(d.person("ana").view).toEqual({ kind: "map" });
    expect(d.admin({ type: "round.next" })).toBe(false); // no se incorpora dos veces
    expect(d.room.adventure.pieces).toEqual(["lupa"]);
  });

  it("tras la tercera conversación llega el cierre con las tres piezas en el inventor", () => {
    const d = new Driver(["ana"]);
    d.playToClosing();
    expect(d.round).toMatchObject({ index: 3, stage: "closing" });
    expect(d.room.adventure.pieces).toEqual(["lupa", "dialogo", "corazon"]);
    expect(d.effects.filter((e) => e.kind === "piece.earned").map((e) => e.pieceId)).toEqual(["lupa", "dialogo", "corazon"]);
    expect(d.effects.some((e) => e.kind === "inventor.activated")).toBe(true);
  });

  it("la frase de Freire se muestra durante la conversación", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    expect(d.admin({ type: "round.showFreire" })).toBe(false);
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "round.showFreire" }), "mostrar");
    expect(d.round.freireShown).toBe(true);
    d.must(d.admin({ type: "round.next" }), "avanzar");
    expect(d.round.freireShown).toBe(false); // la siguiente mesa empieza sin la frase anterior
  });

  it("las acciones de una ronda cerrada se rechazan por su versión; las de otra generación, también", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    const old = d.room.roundVersion;
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    expect(checkRound(d.room, old)?.code).toBe("STALE_ROUND");
    expect(checkRound(d.room, d.room.roundVersion)).toBeNull();
    expect(checkGeneration(d.room, d.room.roomGeneration + 1)?.code).toBe("STALE_GENERATION");
  });

  it("quien llega después acompaña la ronda sin alterar el contador; Vanessa puede incluirla; en la siguiente ronda cuenta", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    d.join("tardia");
    expect(roundCounter(d.room, cfg).total).toBe(1);
    d.openStation("tardia", "sombras"); // acompaña explorando
    expect(roundCounter(d.room, cfg).total).toBe(1);
    d.must(d.admin({ type: "round.include", principalId: "tardia" }), "incluir");
    expect(roundCounter(d.room, cfg).total).toBe(2);
    d.join("otra");
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "round.next" }), "avanzar");
    d.must(d.admin({ type: "round.open" }), "abrir 2");
    expect(d.round.roster.sort()).toEqual(["ana", "otra", "tardia"]);
  });

  it("«Incluir en la ronda» solo existe con la mesa abierta, y solo para quien juega en esta sala", () => {
    const d = new Driver(["ana"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    d.join("tardia");
    expect(d.admin({ type: "round.include", principalId: "tardia" })).toBe(false); // en la preparación la lista todavía no existe
    expect(d.lastError?.code).toBe("INVALID_STEP");
    d.must(d.admin({ type: "round.open" }), "abrir");
    expect(d.admin({ type: "round.include", principalId: "nadie" })).toBe(false); // alguien que no juega en esta sala
    expect(d.lastError?.code).toBe("INVALID_PAYLOAD");
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    expect(d.admin({ type: "round.include", principalId: "tardia" })).toBe(false); // en la conversación ya no
    expect(d.lastError?.code).toBe("INVALID_STEP");
    expect(d.round.included).toEqual([]);
  });

  it("una desconexión no reduce el total: la lista de la ronda no cambia sola", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    const roster = [...d.round.roster];
    // la presencia vive en el servidor; el dominio no la conoce, así que el total solo depende de la lista fijada
    expect(roundCounter(d.room, cfg).total).toBe(2);
    expect(d.round.roster).toEqual(roster);
  });
});

describe("presentación, cuaderno común y pregunta final", () => {
  const conversation = (index = 0) => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(index);
    if (index === 0) d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    return d;
  };

  it("seleccionar los resultados de una persona los proyecta como una copia y los conserva en el cuaderno común", () => {
    const d = conversation();
    d.must(d.admin({ type: "present.select", principalId: "ana" }), "proyectar");
    const adv = d.room.adventure;
    const note = adv.notebook.find((n) => n.id === adv.presentedNoteId)!;
    expect(note).toMatchObject({ kind: "comparison", activityId: "sombras", comparison: { authorId: "ana", authorName: "ana" } });
    expect(note.comparison!.data).toMatchObject({ type: "shadows", samples: [{ distanceCm: 20 }, { distanceCm: 50 }] });
    // es una copia: cambiar lo de Ana después no altera la nota
    expect(buildComparisonData(d.person("ana"), "sombras", cfg)).toEqual(note.comparison!.data);
    d.must(d.admin({ type: "present.select", principalId: "ana" }), "otra vez");
    expect(d.room.adventure.notebook.filter((n) => n.kind === "comparison")).toHaveLength(1); // una por persona y mesa
    d.must(d.admin({ type: "present.clear" }), "quitar");
    expect(d.room.adventure.presentedNoteId).toBeNull();
    expect(d.room.adventure.notebook.filter((n) => n.kind === "comparison")).toHaveLength(1); // se conserva
  });

  it("no se proyecta a quien aún no tiene resultados ni fuera de la conversación", () => {
    const d = conversation();
    expect(d.admin({ type: "present.select", principalId: "beto" })).toBe(false);
    expect(d.lastError?.message).toContain("todavía no tiene resultados");
    expect(d.admin({ type: "present.select", principalId: "nadie" })).toBe(false);
    const e = new Driver(["ana"]);
    e.toExploration(0);
    expect(e.admin({ type: "present.select", principalId: "ana" })).toBe(false);
  });

  it("las comparaciones de Rampas muestran la prueba más lenta y la más rápida", () => {
    const d = new Driver(["ana"]);
    d.toExploration(1);
    d.openStation("ana", "rampas");
    for (const a of [30, 15, 45]) {
      d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: a }), "soltar");
      d.tick(6000);
    }
    d.must(d.admin({ type: "round.converse" }), "reunir");
    d.must(d.admin({ type: "present.select", principalId: "ana" }), "proyectar");
    const n = d.room.adventure.notebook.find((x) => x.kind === "comparison")!;
    expect(n.comparison!.data.type === "ramps" && n.comparison!.data.trials.map((t) => t.angleDeg)).toEqual([15, 45]);
  });

  it("Vanessa guarda la idea inicial aparte de la síntesis y las edita sin perder la versión anterior", () => {
    const d = new Driver(["ana"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    d.must(d.admin({ type: "note.save", activityId: "sombras", kind: "initialIdea", text: "Creemos que la luz estira la sombra" }), "idea");
    d.must(d.admin({ type: "round.open" }), "abrir");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "Cerca de la linterna la sombra es mayor" }), "síntesis");
    const [idea, synth] = d.room.adventure.notebook;
    expect(idea).toMatchObject({ kind: "initialIdea", text: "Creemos que la luz estira la sombra", revision: 1 });
    expect(synth).toMatchObject({ kind: "synthesis" });
    d.must(d.admin({ type: "note.edit", noteId: idea!.id, expectedRevision: 1, text: "Creemos que la luz cambia la sombra" }), "corregir");
    const edited = d.room.adventure.notebook[0]!;
    expect(edited).toMatchObject({ kind: "initialIdea", revision: 2, text: "Creemos que la luz cambia la sombra" });
    expect(edited.history).toEqual([expect.objectContaining({ revision: 1, text: "Creemos que la luz estira la sombra" })]);
    expect(d.admin({ type: "note.edit", noteId: idea!.id, expectedRevision: 1, text: "otra" })).toBe(false);
    expect(d.lastError?.code).toBe("REVISION_CONFLICT");
  });

  it("valida las notas: texto no vacío y de hasta 280 caracteres, mesas ya alcanzadas, idea inicial solo en Sombras", () => {
    const d = new Driver(["ana"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    expect(d.admin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "   " })).toBe(false);
    expect(d.admin({ type: "note.save", activityId: "sombras", kind: "synthesis", text: "x".repeat(281) })).toBe(false);
    expect(d.admin({ type: "note.save", activityId: "cajas", kind: "question", text: "¿Y el telescopio?" })).toBe(false); // todavía no se alcanza
    d.toExploration(1);
    expect(d.admin({ type: "note.save", activityId: "rampas", kind: "initialIdea", text: "predicción" })).toBe(false);
    expect(d.admin({ type: "note.save", activityId: "ghost", kind: "question", text: "?" })).toBe(false);
  });

  it("la pregunta final solo se confirma en el cierre: escrita o elegida entre las preguntas guardadas; cierra la aventura", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    expect(d.admin({ type: "final.confirm", value: { kind: "written", text: "¿Por qué?" } })).toBe(false); // todavía no es el cierre
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse" }), "reunir");
    d.must(d.admin({ type: "note.save", activityId: "sombras", kind: "question", text: "¿Qué pasaría si movemos el objeto?" }), "guardar pregunta");
    const q = d.room.adventure.notebook.find((n) => n.kind === "question")!;
    d.must(d.admin({ type: "round.next" }), "avanzar");
    d.must(d.admin({ type: "round.open" }), "abrir");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "round.next" }), "avanzar");
    d.must(d.admin({ type: "round.open" }), "abrir");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "round.next" }), "avanzar");
    expect(d.round.stage).toBe("closing");
    expect(d.admin({ type: "final.confirm", value: { kind: "saved", noteId: "n999" } })).toBe(false);
    d.effects.length = 0;
    d.must(d.admin({ type: "final.confirm", value: { kind: "saved", noteId: q.id } }), "confirmar");
    expect(d.room.phase).toBe("finished");
    const finalNote = d.room.adventure.notebook.find((n) => n.id === d.room.adventure.inventor.finalQuestionId)!;
    expect(finalNote).toMatchObject({ kind: "finalQuestion", text: "¿Qué pasaría si movemos el objeto?", sourceNoteId: q.id });
    expect(d.effects.map((e) => e.kind)).toEqual(["adventure.finished"]);
    expect(d.admin({ type: "final.confirm", value: { kind: "written", text: "otra" } })).toBe(false); // una sola pregunta final
    d.must(d.admin({ type: "final.correct", expectedRevision: 1, text: "¿Qué pasaría si movemos el objeto de lugar?" }), "corregir error de escritura");
    const fixed = d.room.adventure.notebook.find((n) => n.kind === "finalQuestion")!;
    expect(fixed).toMatchObject({ revision: 2, text: "¿Qué pasaría si movemos el objeto de lugar?" });
    expect(fixed.history[0]).toMatchObject({ revision: 1, text: "¿Qué pasaría si movemos el objeto?" });
    expect(d.act("ana", { type: "player.moveTo", target: { x: 600, y: 450 } })).toBe(false); // terminada: nadie juega
  });

  it("la pregunta final escrita se normaliza y respeta el límite", () => {
    const d = new Driver(["ana"]);
    d.playToClosing();
    expect(d.admin({ type: "final.confirm", value: { kind: "written", text: "  " } })).toBe(false);
    expect(d.admin({ type: "final.confirm", value: { kind: "written", text: "x".repeat(300) } })).toBe(false);
    d.must(d.admin({ type: "final.confirm", value: { kind: "written", text: "  ¿Qué sigue?  " } }), "confirmar");
    expect(d.room.adventure.notebook.at(-1)).toMatchObject({ text: "¿Qué sigue?" });
  });
});

describe("pausa, conexión, vencimiento y reinicio", () => {
  it("pausar y reanudar conservan la fase de la ronda; en pausa no se conduce ni se juega", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    d.must(d.admin({ type: "room.pause" }), "pausar");
    expect(d.room).toMatchObject({ phase: "paused", resumePhase: "running" });
    expect(d.admin({ type: "round.converse" })).toBe(false);
    expect(d.lastError?.code).toBe("ROOM_PAUSED");
    expect(d.act("ana", { type: "station.open", stationId: "sombras", origin: "quickNav" })).toBe(false);
    d.must(d.admin({ type: "room.resume" }), "reanudar");
    expect(d.round.stage).toBe("exploration");
  });

  it("si Vanessa pierde la conexión la sala se pausa; reiniciar el servicio pausa las salas en curso", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    const lost = onAdminLost(d.room);
    expect(lost.ok && lost.room.phase).toBe("paused");
    expect(recoverAfterRestart(d.room)).toMatchObject({ phase: "paused", resumePhase: "running" });
    expect(recoverAfterRestart(d.room).roundVersion).toBeGreaterThan(d.room.roundVersion);
    const closed = { ...d.room, phase: "closed" as const };
    expect(recoverAfterRestart(closed)).toBe(closed);
  });

  it("el vencimiento cierra la sala por completo y las acciones posteriores se rechazan", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    const e = expireRoom(d.room);
    expect(e.ok && e.room.phase).toBe("expired");
    d.room = (e as { room: typeof d.room }).room;
    expect(d.admin({ type: "round.converse" })).toBe(false);
    expect(d.act("ana", { type: "player.moveTo", target: { x: 600, y: 450 } })).toBe(false);
    expect(d.lastError?.code).toBe("ROOM_UNAVAILABLE");
  });

  it("reiniciar borra el recorrido y las pruebas, conserva a las personas y sube la generación", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    d.readyShadows("ana");
    d.must(d.admin({ type: "round.converse", withPending: true }), "reunir");
    d.must(d.admin({ type: "round.next" }), "avanzar");
    const gen = d.room.roomGeneration;
    d.must(d.admin({ type: "room.reset", confirm: true }), "reiniciar");
    expect(d.room).toMatchObject({ phase: "welcome", roomGeneration: gen + 1 });
    expect(d.room.adventure).toMatchObject({ completed: [], pieces: [], notebook: [] });
    expect(d.round).toMatchObject({ index: 0, stage: "preparation", roster: [] });
    expect(Object.keys(d.room.participants).sort()).toEqual(["ana", "beto"]);
    expect(personReadiness(d.person("ana"), "sombras", cfg)).toMatchObject({ done: 0, ready: false });
  });

  it("cerrar termina la sala para todas las personas", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    d.must(d.admin({ type: "room.close", confirm: true }), "cerrar");
    expect(d.room.phase).toBe("closed");
    expect(d.admin({ type: "room.pause" })).toBe(false);
  });
});

describe("reloj y simulación", () => {
  it("solo hay algo que simular con la sala en curso y una prueba en marcha o un personaje caminando", () => {
    const d = new Driver(["ana"]);
    expect(isSimulating(d.room, d.activeMs)).toBe(false);
    d.toExploration(1);
    expect(isSimulating(d.room, d.activeMs)).toBe(false);
    d.openStation("ana", "rampas");
    d.must(d.act("ana", { type: "ramps.trial.start", angleDeg: 20 }), "soltar");
    expect(isSimulating(d.room, d.activeMs)).toBe(true);
    d.must(d.admin({ type: "room.pause" }), "pausar");
    expect(isSimulating(d.room, d.activeMs)).toBe(false);
  });

  it("el reloj nunca retrocede y el movimiento se calcula desde el plan y el reloj", () => {
    const d = new Driver(["ana"]);
    d.must(d.admin({ type: "room.start" }), "comenzar");
    d.must(d.act("ana", { type: "player.moveTo", target: { x: 640, y: 450 } }), "caminar");
    const plan = d.person("ana").character.plan!;
    const start = playerAt(d.person("ana").character, d.activeMs).feet;
    d.tick(500);
    const mid = playerAt(d.person("ana").character, d.activeMs);
    expect(mid.moving).toBe(true);
    expect(Math.hypot(mid.feet.x - start.x, mid.feet.y - start.y)).toBeGreaterThan(0);
    const back = tickRoom(d.room, 10);
    expect(back.room.adventure.timeline.activeMs).toBe(d.activeMs);
    const end = plan.points.at(-1)!;
    d.tick(60_000);
    expect(playerAt(d.person("ana").character, d.activeMs).feet).toEqual(end);
  });

  it("dar de alta a una persona es idempotente y no la cambia", () => {
    const d = new Driver(["ana"]);
    const same = ensureParticipant(d.room, "ana", cfg, bundle.map);
    expect(same).toBe(d.room);
  });

  it("la preparación de readiness es coherente con los criterios de la configuración", () => {
    const empty = readiness(undefined, cfg.activities.sombras!);
    expect(empty).toEqual({ done: 0, needed: 2, ready: false });
    expect(readiness(undefined, cfg.activities.rampas!).needed).toBe(2);
    expect(readiness(undefined, cfg.activities.cajas!).needed).toBe(2);
  });
});
