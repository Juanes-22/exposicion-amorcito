import type { ActivityState, NotebookRecord, RecordField } from "../../../shared/contracts/state";

/** Pasos mostrados al público: algunos pasos internos se presentan como uno solo (p. ej. sorpresa + primera idea). */
const SHADOWS = ["firstIdea", "explore", "observation", "nextQuestion"] as const;
const RAMPS = ["closedAnswer", "question", "prediction", "trials", "observation"] as const;
const BOXES = ["exploreShared", "askPermission", "refusal", "nextQuestion"] as const;

const DISPLAY: Record<ActivityState["type"], Record<string, number>> = {
  shadows: { surprise: 0, firstIdea: 0, explore: 1, observation: 2, nextQuestion: 3 },
  ramps: { closedAnswer: 0, question: 1, prediction: 2, trials: 3, observation: 4 },
  boxes: { exploreShared: 0, askPermission: 1, refusal: 2, respect: 2, nextQuestion: 3 },
};
const TOTAL: Record<ActivityState["type"], number> = { shadows: SHADOWS.length, ramps: RAMPS.length, boxes: BOXES.length };

/** «Paso 2 de 4». Una mesa completada no tiene paso en curso. */
export function stepProgress(state: ActivityState): { n: number; total: number; done: boolean } {
  const total = TOTAL[state.type];
  if (state.step === "completed") return { n: total, total, done: true };
  return { n: (DISPLAY[state.type][state.step] ?? 0) + 1, total, done: false };
}

export const FIELD_LABEL: Record<RecordField, string> = {
  firstIdea: "Primera idea",
  observation: "Observación",
  nextQuestion: "Nueva pregunta",
  question: "Pregunta",
  prediction: "Predicción",
  finalQuestion: "Pregunta final",
};

/** Texto de un registro confirmado: el texto, o la frase de «lo diremos en voz alta» / «todavía no tenemos una explicación». */
export function recordText(r: Pick<NotebookRecord, "modality" | "text">, labels: Record<string, string>): string {
  if (r.modality === "oral") return labels.oralRecord ?? "Lo compartiremos en voz alta";
  if (r.modality === "uncertain") return labels.uncertainRecord ?? "Todavía no tenemos una explicación";
  return r.text ?? "";
}
