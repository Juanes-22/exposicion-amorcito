import type { ActivityConfig } from "../../../shared/contracts/config";
import type { ActivityState, GroupNote, NoteKind } from "../../../shared/contracts/state";
import { angleLabel } from "../../../shared/domain/models";
import { countedSamples, finishedTrials } from "../../../shared/domain/results";

/** Cómo se llama cada nota del cuaderno común. La idea de Vanessa se identifica siempre como del grupo (propuesta de rondas, sección 8). */
export const NOTE_LABEL: Record<NoteKind, string> = {
  initialIdea: "Idea inicial del grupo",
  synthesis: "Idea del grupo",
  question: "Pregunta del grupo",
  finalQuestion: "Pregunta final",
};

/**
 * Las notas que el cuaderno muestra. Una sala guardada antes de quitar la proyección de resultados puede traer notas de otro tipo
 * («comparison»): ya no se muestran.
 */
export const isShownNote = (n: GroupNote): boolean => Object.hasOwn(NOTE_LABEL, n.kind);

/** Texto de una nota: lo que Vanessa escribió. */
export function noteText(n: GroupNote): string {
  return n.text ?? "";
}

const SKY_LABEL = { moon: "Luna observada", stars: "Estrellas observadas", galaxy: "Galaxia observada" } as const;

/**
 * Las líneas de los resultados propios de una mesa: lo que el juego registró, nunca lo que alguien escribió a mano. Sin medidas ni
 * conclusiones: en Sombras, cuántas posiciones probó (qué tan grande fue la sombra lo observa cada persona); en Rampas, qué inclinación
 * se probó (no cuánto demoró).
 */
export function personalLines(state: ActivityState | undefined, cfg: ActivityConfig | undefined): string[] {
  if (!state || !cfg) return [];
  if (state.type === "shadows" && cfg.type === "shadows") {
    const n = countedSamples(state).length;
    if (n === 0) return [];
    return [n === 1 ? "Probaste la linterna en 1 posición." : `Probaste la linterna en ${n} posiciones distintas.`];
  }
  if (state.type === "ramps" && cfg.type === "ramps") return finishedTrials(state).map((t, i) => `Prueba ${i + 1}: ${angleLabel(cfg.experiment, t.angleDeg).toLowerCase()}`);
  if (state.type === "telescope")
    // Solo las observaciones del cielo, en un orden fijo: la ventana y la cortina nunca se registran en el cuaderno.
    return (["moon", "stars", "galaxy"] as const).filter((t) => state.observed.includes(t)).map((t) => SKY_LABEL[t]);
  return [];
}
