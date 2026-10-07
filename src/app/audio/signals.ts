import type { AudioEventId, LaboratorioConfig } from "../../../shared/contracts/config";
import type { EffectEvent, RoomSnapshot } from "../../../shared/contracts/events";
import type { RoomState } from "../../../shared/contracts/state";

/** Una señal importante de la aventura: su evento sonoro y SIEMPRE su texto equivalente (SPECS 10.4). */
export interface Signal {
  /** Estable y único por transición: sirve para no repetirla. */
  id: string;
  event: AudioEventId;
  text: string;
}

/** La campanita de La caja de las sorpresas suena al mirarla (SPECS 3.4: «sonido opcional»). */
export const BELL_OBJECT_ID = "campanita";

/**
 * Detecta las señales sonoras y escritas POR TRANSICIÓN (SPECS 10.4): no se repite una campana o una pieza después de un snapshot, una
 * reconexión o un reinicio de la sala, y no se reproducen celebraciones históricas al abrir o reabrir el juego.
 * - El primer snapshot tras conectar (o tras un cambio de generación) solo fija la línea de base: no emite nada.
 * - Los efectos del servidor (`effects`) se deduplican por `effectId`.
 * - Lo que el servidor no marca como efecto (la campanita, la posición anotada de la linterna) se deduce comparando un snapshot con el
 *   anterior de la MISMA generación y de versión igual o mayor.
 */
export function createSignalTracker(config: LaboratorioConfig) {
  let prev: RoomState | null = null;
  const seen = new Set<string>();
  const labels = config.ui.labels;
  const pieceLabel = (id: string | undefined) => config.inventor.pieces.find((p) => p.id === id)?.label ?? "una pieza";

  const fromEffect = (e: EffectEvent): Signal | null => {
    switch (e.kind) {
      case "piece.earned":
        return { id: e.effectId, event: "piece.earned", text: (labels.signalPieceEarned ?? "Pieza conseguida: {pieza}.").replace("{pieza}", pieceLabel(e.pieceId)) };
      case "pieces.placed":
        return { id: e.effectId, event: "inventor.activated", text: labels.signalPiecesPlaced ?? "El inventor se encendió." };
      case "adventure.finished":
        return { id: e.effectId, event: "adventure.finished", text: labels.signalFinished ?? "Terminamos la aventura." };
      default:
        return null;
    }
  };

  const countedSamples = (s: RoomState, id: string): number => {
    const st = s.adventure.activities[id];
    return st?.type === "shadows" ? st.samples.filter((x) => x.counts).length : 0;
  };
  const selectedObject = (s: RoomState, id: string): string | undefined => {
    const st = s.adventure.activities[id];
    return st?.type === "boxes" ? st.selectedObjectId : undefined;
  };

  return {
    /** Tras perder la conexión: el siguiente snapshot vuelve a ser solo línea de base. */
    reset(): void {
      prev = null;
    },

    consume(snapshot: RoomSnapshot): Signal[] {
      const state = snapshot.state;
      const before = prev;
      const baseline = before === null || before.roomGeneration !== state.roomGeneration;
      if (before !== null && state.roomGeneration === before.roomGeneration && state.stateVersion < before.stateVersion) return []; // un snapshot viejo no cuenta
      prev = state;
      if (baseline) {
        for (const e of snapshot.effects) seen.add(e.effectId);
        return [];
      }

      const out: Signal[] = [];
      const push = (s: Signal | null) => {
        if (s && !seen.has(s.id)) {
          seen.add(s.id);
          out.push(s);
        }
      };
      for (const e of snapshot.effects) push(fromEffect(e));
      if (state.stateVersion > before!.stateVersion) {
        const stamp = (event: AudioEventId) => `${state.roomGeneration}:${state.stateVersion}:${event}`;
        for (const id of Object.keys(state.adventure.activities)) {
          if (countedSamples(state, id) > countedSamples(before!, id)) push({ id: stamp("shadows.click"), event: "shadows.click", text: labels.signalClick ?? "Se anotó la posición de la linterna." });
          const now = selectedObject(state, id);
          if (now === BELL_OBJECT_ID && now !== selectedObject(before!, id)) push({ id: stamp("boxes.bell"), event: "boxes.bell", text: labels.signalBell ?? "Suena la campanita." });
        }
      }
      return out;
    },
  };
}

export type SignalTracker = ReturnType<typeof createSignalTracker>;
