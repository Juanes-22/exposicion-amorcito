import { describe, expect, it } from "vitest";
import type { AdminAction } from "../../../shared/contracts/actions";
import type { EffectEvent, GroupSnapshot, MeSnapshot } from "../../../shared/contracts/events";
import type { ShadowsState, TelescopeState } from "../../../shared/contracts/state";
import { CLOSE_ZOOM, TELESCOPE_TARGETS } from "../../../shared/domain/telescope";
import { bundle, Driver } from "../../../shared/testing/drive";
import { createSignalTracker } from "./signals";

const { config } = bundle;
const labels = config.ui.labels;

/** El estado de grupo que recibirían todas las pantallas: la sala del Driver con la versión y los efectos que se indiquen. */
const grupo = (d: Driver, version: number, effects: EffectEvent[] = [], generation = 1): GroupSnapshot => ({
  roomGeneration: generation,
  stateVersion: version,
  roundVersion: d.room.roundVersion,
  phase: d.room.phase,
  adventure: d.room.adventure,
  effects,
});
/** Mi estado personal tal como lo recibiría esa persona: solo SU participante. */
const mio = (d: Driver, id: string, version: number, generation = 1): MeSnapshot => ({ roomGeneration: generation, stateVersion: version, participant: d.person(id) });

/** Los mismos efectos que emite el dominio (`round.ts`): único por generación y pieza. */
const earned = (pieceId: string, generation = 1): EffectEvent => ({ effectId: `${generation}:piece:${pieceId}`, kind: "piece.earned", pieceId });
const activated = (generation = 1): EffectEvent => ({ effectId: `${generation}:inventor.activated`, kind: "inventor.activated" });
const finished = (generation = 1): EffectEvent => ({ effectId: `${generation}:adventure.finished`, kind: "adventure.finished" });

/** Una sala en exploración con Ana ya en la mesa de Sombras. */
function sombras(): Driver {
  const d = new Driver(["ana", "beto"]);
  d.toExploration(0);
  d.openStation("ana", "sombras");
  return d;
}
/** Una sala en la tercera mesa con Ana ya mirando por el telescopio del observatorio. */
function observatorio(): Driver {
  const d = new Driver(["ana", "beto"]);
  d.toExploration(2);
  d.openStation("ana", "cajas");
  return d;
}
const muestra = (d: Driver, cm: number) => d.must(d.act("ana", { type: "shadows.sample", distanceCm: cm }), `posición ${cm}`);
const apuntar = (d: Driver, target: keyof typeof TELESCOPE_TARGETS, zoom = CLOSE_ZOOM) =>
  d.must(d.act("ana", { type: "telescope.aim", x: TELESCOPE_TARGETS[target].x, y: TELESCOPE_TARGETS[target].y, zoom }), `mirar ${target}`);

describe("señales de grupo: efectos del servidor (SPECS 10.4)", () => {
  it("el primer estado solo fija la línea de base: no hay celebraciones históricas al abrir o reabrir el juego", () => {
    const t = createSignalTracker(config);
    expect(t.group(grupo(new Driver(), 1, [earned("lupa"), activated(), finished()]))).toEqual([]);
  });

  it("un efecto produce su evento y su texto, y no se repite aunque llegue otra vez", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 1));
    expect(t.group(grupo(d, 2, [earned("lupa")]))).toEqual([{ id: "1:piece:lupa", event: "piece.earned", text: "Pieza conseguida: Lupa." }]);
    expect(t.group(grupo(d, 3, [earned("lupa")]))).toEqual([]); // mismo effectId: ya sonó
    expect(t.group(grupo(d, 4, [earned("dialogo")]))).toMatchObject([{ event: "piece.earned", text: "Pieza conseguida: Bocadillo." }]);
  });

  it("encender el inventor y terminar la aventura tienen su evento y su texto, en el orden en que llegan", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 1));
    const out = t.group(grupo(d, 2, [earned("corazon"), activated(), finished()]));
    expect(out.map((s) => s.event)).toEqual(["piece.earned", "inventor.activated", "adventure.finished"]);
    expect(out[0]!.text).toBe("Pieza conseguida: Corazón.");
    expect(out[1]!.text).toBe(labels.signalPiecesPlaced);
    expect(out[2]!.text).toBe(labels.signalFinished);
    expect(new Set(out.map((s) => s.id)).size).toBe(3); // cada señal con su propio ID
  });

  it("un recorrido real: cada «Abrir siguiente mesa» anuncia su pieza, el cierre enciende el inventor y la pregunta final termina la aventura", () => {
    const d = new Driver(["ana"]);
    const t = createSignalTracker(config);
    let version = 1;
    t.group(grupo(d, version)); // la sala en bienvenida: línea de base
    /** Una acción de Vanessa; lo que el servidor emitiría como efectos viaja en el estado de grupo siguiente. */
    const admin = (action: AdminAction) => {
      const antes = d.effects.length;
      d.must(d.admin(action), action.type);
      return t.group(grupo(d, ++version, d.effects.slice(antes)));
    };

    d.toExploration(0);
    d.readyShadows("ana");
    expect(admin({ type: "round.converse" })).toEqual([]); // conversar no es una celebración
    expect(admin({ type: "round.next" }).map((s) => s.text)).toEqual(["Pieza conseguida: Lupa."]);

    expect(admin({ type: "round.open" })).toEqual([]);
    d.readyRamps("ana");
    admin({ type: "round.converse" });
    expect(admin({ type: "round.next" }).map((s) => s.text)).toEqual(["Pieza conseguida: Bocadillo."]);

    admin({ type: "round.open" });
    d.readyTelescope("ana");
    admin({ type: "round.converse" });
    expect(admin({ type: "round.next" }).map((s) => [s.event, s.text])).toEqual([
      ["piece.earned", "Pieza conseguida: Corazón."],
      ["inventor.activated", labels.signalPiecesPlaced],
    ]);

    expect(admin({ type: "final.confirm", value: { kind: "written", text: "¿Por qué cambia la sombra?" } }).map((s) => [s.event, s.text])).toEqual([["adventure.finished", labels.signalFinished]]);
  });

  it("tras perder la conexión el siguiente estado vuelve a ser línea de base: una reconexión no repite nada", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 1));
    t.group(grupo(d, 2, [earned("lupa")]));
    t.reset();
    expect(t.group(grupo(d, 5, [earned("lupa"), earned("dialogo")]))).toEqual([]); // ni lo ya sonado ni lo ocurrido mientras estaba desconectado
    expect(t.group(grupo(d, 6, [earned("corazon")]))).toHaveLength(1); // pero lo nuevo sí
  });

  it("un reinicio de la sala (otra generación) también es línea de base, y lo que pasa después vuelve a sonar", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 1));
    t.group(grupo(d, 2, [earned("lupa")]));
    expect(t.group(grupo(new Driver(), 1, [], 2))).toEqual([]);
    // La misma pieza en el recorrido nuevo es otro efecto (su ID lleva la generación) y vuelve a sonar.
    expect(t.group(grupo(new Driver(), 2, [earned("lupa", 2)], 2))).toHaveLength(1);
  });

  it("el primer estado de otra generación no suena aunque su versión sea mayor y traiga efectos", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 1));
    expect(t.group(grupo(new Driver(), 50, [earned("lupa", 2), finished(2)], 2))).toEqual([]);
  });

  it("los efectos vistos en la línea de base no suenan cuando el siguiente estado los repite", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    expect(t.group(grupo(d, 1, [earned("lupa")]))).toEqual([]);
    expect(t.group(grupo(d, 2, [earned("lupa")]))).toEqual([]); // el servidor sigue listándolo: ya estaba cuando se abrió el juego
    expect(t.group(grupo(d, 3, [earned("lupa"), earned("dialogo")]))).toHaveLength(1); // solo lo nuevo
  });

  it("un estado de grupo más viejo o repetido no produce señales ni retrasa la línea de base", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 5));
    expect(t.group(grupo(d, 6, [earned("lupa")]))).toHaveLength(1);
    expect(t.group(grupo(d, 4, [earned("dialogo")]))).toEqual([]); // viejo, aunque traiga un efecto que no se había visto
    expect(t.group(grupo(d, 6, [earned("lupa")]))).toEqual([]); // repetido
    expect(t.group(grupo(d, 7, [earned("corazon")]))).toHaveLength(1); // lo siguiente se compara con la versión 6, no con la vieja
  });

  it("el grupo no necesita estado personal: quien acompaña como observadora oye lo de todas", () => {
    const t = createSignalTracker(config);
    const d = new Driver();
    t.group(grupo(d, 1));
    expect(t.group(grupo(d, 2, [earned("lupa")]))).toHaveLength(1); // sin que haya llegado nunca un `me.state`
  });
});

describe("señales personales: lo que hice yo, por comparación de mi propio estado (SPECS 10.4)", () => {
  it("el primer estado personal solo fija la línea de base: abrir el juego con posiciones ya anotadas no hace «clic»", () => {
    const d = sombras();
    muestra(d, 20);
    const t = createSignalTracker(config);
    expect(t.me(mio(d, "ana", 5))).toEqual([]);
    muestra(d, 50);
    expect(t.me(mio(d, "ana", 6))).toMatchObject([{ event: "shadows.click" }]);
  });

  it("anotar una posición que cuenta hace «clic»; una muy parecida, o la misma otra vez, no", () => {
    const d = sombras();
    const t = createSignalTracker(config);
    t.me(mio(d, "ana", 1));
    muestra(d, 20);
    const primero = t.me(mio(d, "ana", 2));
    expect(primero).toMatchObject([{ event: "shadows.click", text: "Se anotó la posición de la linterna." }]);
    muestra(d, 22); // demasiado parecida (menos de 5 cm): se guarda pero no cuenta
    expect(t.me(mio(d, "ana", 3))).toEqual([]);
    muestra(d, 22); // la misma posición seguida no se registra dos veces: el estado no cambia
    expect(t.me(mio(d, "ana", 4))).toEqual([]);
    muestra(d, 50);
    const segundo = t.me(mio(d, "ana", 5));
    expect(segundo).toHaveLength(1);
    expect(segundo[0]!.id).not.toBe(primero[0]!.id); // otra posición, otra señal
  });

  it("moverme, abrir la mesa o volver al mapa no suenan", () => {
    const d = new Driver(["ana", "beto"]);
    d.toExploration(0);
    const t = createSignalTracker(config);
    t.me(mio(d, "ana", 1));
    d.openStation("ana", "sombras");
    expect(t.me(mio(d, "ana", 2))).toEqual([]);
    muestra(d, 20);
    t.me(mio(d, "ana", 3));
    d.must(d.act("ana", { type: "adventure.returnToMap" }), "volver al mapa");
    expect(t.me(mio(d, "ana", 4))).toEqual([]); // sus posiciones siguen ahí, pero no hay una nueva
    d.must(d.act("ana", { type: "player.moveTo", target: { x: 640, y: 450 } }), "caminar");
    expect(t.me(mio(d, "ana", 5))).toEqual([]);
  });

  it("el observatorio funciona sin sonido: observar la Luna o las estrellas, o que se cierre la cortina, no producen señales", () => {
    const d = observatorio();
    const t = createSignalTracker(config);
    t.me(mio(d, "ana", 10));
    apuntar(d, "moon");
    expect(t.me(mio(d, "ana", 11))).toEqual([]);
    apuntar(d, "stars", 0);
    expect(t.me(mio(d, "ana", 12))).toEqual([]);
    apuntar(d, "window");
    expect((d.person("ana").activities.cajas as TelescopeState).curtain).toBe("closed");
    expect(t.me(mio(d, "ana", 13))).toEqual([]); // la casa no tiene recompensas ni avisos
  });

  it("mi estado y el del grupo tienen cada uno su línea de base: ninguno fija la del otro", () => {
    const d = sombras();
    muestra(d, 20);
    const t = createSignalTracker(config);
    expect(t.group(grupo(d, 1))).toEqual([]);
    expect(t.me(mio(d, "ana", 1))).toEqual([]); // mi primer estado es base aunque el de grupo ya tenía la suya
    muestra(d, 50);
    expect(t.me(mio(d, "ana", 2))).toHaveLength(1);
    expect(t.group(grupo(d, 2, [earned("lupa")]))).toHaveLength(1); // y lo mío no adelantó ni retrasó lo del grupo
  });

  it("tras perder la conexión también mi estado vuelve a ser línea de base", () => {
    const d = sombras();
    const t = createSignalTracker(config);
    t.me(mio(d, "ana", 1));
    muestra(d, 20);
    expect(t.me(mio(d, "ana", 2))).toHaveLength(1);
    t.reset();
    muestra(d, 50);
    expect(t.me(mio(d, "ana", 5))).toEqual([]); // lo anotado mientras estaba desconectada no se anuncia al volver
    muestra(d, 35);
    expect(t.me(mio(d, "ana", 6))).toHaveLength(1); // pero lo nuevo sí
  });

  it("un reinicio de la sala (otra generación) fija de nuevo mi línea de base, aunque el estado nuevo traiga más posiciones", () => {
    const d = sombras();
    const t = createSignalTracker(config);
    t.me(mio(d, "ana", 1));
    const otra = sombras();
    muestra(otra, 20);
    muestra(otra, 50);
    expect(t.me(mio(otra, "ana", 50, 2))).toEqual([]);
    muestra(otra, 35);
    expect(t.me(mio(otra, "ana", 51, 2))).toHaveLength(1);
  });

  it("un estado personal más viejo o repetido no produce señales ni retrasa la línea de base", () => {
    const d = sombras();
    const t = createSignalTracker(config);
    const antes = mio(d, "ana", 5);
    t.me(antes);
    muestra(d, 20);
    const actual = mio(d, "ana", 6);
    expect(t.me(actual)).toHaveLength(1);
    expect(t.me({ ...antes, stateVersion: 4 })).toEqual([]); // viejo
    expect(t.me(actual)).toEqual([]); // repetido
    muestra(d, 50);
    expect(t.me(mio(d, "ana", 7))).toHaveLength(1); // se compara con la versión 6, no con la vieja (que tenía una posición menos)
  });

  it("si llegan de golpe varios cambios míos (se perdió un estado intermedio), suena cada tipo una vez", () => {
    const d = new Driver(["ana"]);
    d.toExploration(0);
    const t = createSignalTracker(config);
    const antes = mio(d, "ana", 1);
    t.me(antes);
    const despues = structuredClone(antes.participant);
    (despues.activities.sombras as ShadowsState).samples.push({ distanceCm: 20, shadowCm: 10, counts: true, atActiveMs: 0 }, { distanceCm: 50, shadowCm: 6, counts: true, atActiveMs: 1 });
    Object.assign(despues.activities.cajas as TelescopeState, { observed: ["moon"], curtain: "closed" });
    const out = t.me({ ...antes, stateVersion: 3, participant: despues });
    expect(out.map((s) => s.event)).toEqual(["shadows.click"]); // dos posiciones nuevas, un solo «clic»; el telescopio no suena
  });
});
