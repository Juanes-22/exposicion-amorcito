import type { ActivityState, GroupNote, NoteKind } from "../../../shared/contracts/state";
import { formatNumber } from "../../../shared/domain/models";
import { countedSamples, describeComparison, finishedTrials } from "../../../shared/domain/results";

/** Cómo se llama cada nota del cuaderno común. La idea de Vanessa se identifica siempre como del grupo (propuesta de rondas, sección 8). */
export const NOTE_LABEL: Record<NoteKind, string> = {
  initialIdea: "Idea inicial del grupo",
  synthesis: "Idea del grupo",
  question: "Pregunta del grupo",
  comparison: "Resultados comparados",
  finalQuestion: "Pregunta final",
};

/** Texto de una nota. Las comparaciones se escriben con sus datos, para lectores de pantalla y para el cuaderno. */
export function noteText(n: GroupNote): string {
  if (n.kind === "comparison" && n.comparison) return `${n.comparison.authorName}: ${describeComparison(n.comparison)}`;
  return n.text ?? "";
}

/** Las líneas de los resultados propios de una mesa: lo que el juego registró, nunca lo que alguien escribió a mano. */
export function personalLines(state: ActivityState | undefined): string[] {
  if (!state) return [];
  if (state.type === "shadows") return countedSamples(state).map((s, i) => `Posición ${i + 1}: linterna a ${formatNumber(s.distanceCm)} cm → sombra de ${formatNumber(s.shadowCm, 1)} cm`);
  if (state.type === "ramps") return finishedTrials(state).map((t, i) => `Prueba ${i + 1}: ${formatNumber(t.angleDeg)}° → ${formatNumber(t.durationMs / 1000, 1)} s (simulación)`);
  // Solo las observaciones del cielo: la ventana y la cortina nunca se registran en el cuaderno.
  return state.observed
    .slice()
    .sort((a, b) => (a === "moon" ? -1 : b === "moon" ? 1 : 0))
    .map((t) => (t === "moon" ? "Luna observada" : "Estrellas observadas"));
}
