import type { AudioEventId, LaboratorioConfig } from "../../../shared/contracts/config";
import type { EffectEvent, GroupSnapshot, MeSnapshot } from "../../../shared/contracts/events";
import type { ParticipantState } from "../../../shared/contracts/state";
import { countedSamples } from "../../../shared/domain/results";

/** Una señal importante de la aventura: su evento sonoro y SIEMPRE su texto equivalente (SPECS 10.4). */
export interface Signal {
  /** Estable y único por transición: sirve para no repetirla. */
  id: string;
  event: AudioEventId;
  text: string;
}

const countOf = (p: ParticipantState, id: string): number => {
  const st = p.activities[id];
  return st?.type === "shadows" ? countedSamples(st).length : 0;
};

/**
 * Detecta las señales sonoras y escritas POR TRANSICIÓN (SPECS 10.4): no se repite un clic o una pieza después de un snapshot, una
 * reconexión o un reinicio de la sala, y no se reproducen celebraciones históricas al abrir o reabrir el juego.
 * - Señales de grupo (pieza conseguida, inventor encendido, aventura terminada): vienen como efectos del servidor en el estado de grupo,
 *   se deduplican por `effectId` y los llevan todas las pantallas.
 * - Señales personales (la posición de la linterna que se registró): se deducen comparando MI estado con el anterior de la
 *   misma generación y de versión igual o mayor. Solo las produce lo que hice yo.
 * - El primer estado tras conectar (o tras un cambio de generación) solo fija la línea de base: no emite nada.
 */
export function createSignalTracker(config: LaboratorioConfig) {
  let prevGroup: { generation: number; version: number } | null = null;
  let prevMe: { generation: number; version: number; participant: ParticipantState } | null = null;
  const seen = new Set<string>();
  const labels = config.ui.labels;
  const pieceLabel = (id: string | undefined) => config.inventor.pieces.find((p) => p.id === id)?.label ?? "una pieza";

  const fromEffect = (e: EffectEvent): Signal | null => {
    switch (e.kind) {
      case "piece.earned":
        return { id: e.effectId, event: "piece.earned", text: (labels.signalPieceEarned ?? "Pieza conseguida: {pieza}.").replace("{pieza}", pieceLabel(e.pieceId)) };
      case "inventor.activated":
        return { id: e.effectId, event: "inventor.activated", text: labels.signalPiecesPlaced ?? "El inventor se encendió." };
      case "adventure.finished":
        return { id: e.effectId, event: "adventure.finished", text: labels.signalFinished ?? "Terminamos la aventura." };
      default:
        return null;
    }
  };

  return {
    /** Tras perder la conexión: el siguiente estado vuelve a ser solo línea de base. */
    reset(): void {
      prevGroup = null;
      prevMe = null;
    },

    group(snapshot: GroupSnapshot): Signal[] {
      const before = prevGroup;
      const baseline = before === null || before.generation !== snapshot.roomGeneration;
      if (before !== null && !baseline && snapshot.stateVersion < before.version) return []; // un estado viejo no cuenta
      prevGroup = { generation: snapshot.roomGeneration, version: snapshot.stateVersion };
      if (baseline) {
        for (const e of snapshot.effects) seen.add(e.effectId);
        return [];
      }
      const out: Signal[] = [];
      for (const e of snapshot.effects) {
        const s = fromEffect(e);
        if (s && !seen.has(s.id)) {
          seen.add(s.id);
          out.push(s);
        }
      }
      return out;
    },

    me(snapshot: MeSnapshot): Signal[] {
      const before = prevMe;
      const baseline = before === null || before.generation !== snapshot.roomGeneration;
      if (before !== null && !baseline && snapshot.stateVersion < before.version) return [];
      prevMe = { generation: snapshot.roomGeneration, version: snapshot.stateVersion, participant: snapshot.participant };
      if (baseline || snapshot.stateVersion <= before!.version) return [];
      const out: Signal[] = [];
      const stamp = (event: AudioEventId) => `${snapshot.roomGeneration}:${snapshot.stateVersion}:${event}`;
      for (const id of Object.keys(snapshot.participant.activities)) {
        if (countOf(snapshot.participant, id) > countOf(before!.participant, id)) out.push({ id: stamp("shadows.click"), event: "shadows.click", text: labels.signalClick ?? "Se anotó la posición de la linterna." });
      }
      return out.filter((s, i) => out.findIndex((x) => x.id === s.id) === i);
    },
  };
}

export type SignalTracker = ReturnType<typeof createSignalTracker>;
