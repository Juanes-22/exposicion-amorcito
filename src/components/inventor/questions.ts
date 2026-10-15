import type { InventorQuestionConfig, LaboratorioConfig } from "../../../shared/contracts/config";

export interface QuestionGroup {
  activityId: string;
  title: string;
  questions: InventorQuestionConfig[];
}

/** Las preguntas sugeridas del inventor agrupadas por mesa, en el orden del recorrido. Las mesas sin preguntas no aparecen. */
export function questionGroups(config: LaboratorioConfig): QuestionGroup[] {
  return config.route
    .map((id) => ({ activityId: id, title: config.activities[id]!.title, questions: config.inventor.questions.filter((q) => q.activityId === id) }))
    .filter((g) => g.questions.length > 0);
}

/** Clave para reunir preguntas escritas iguales («¿Por qué…?» y «¿por qué… ?» son la misma). */
export const questionKey = (text: string): string => text.normalize("NFC").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
