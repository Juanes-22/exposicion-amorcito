import type { ActivityConfig, ShadowsActivityConfig, SuggestedOption } from "../../../shared/contracts/config";
import type { Modality, RecordField } from "../../../shared/contracts/state";
import { FIELD_RULES } from "../../../shared/domain/adventure";

/** Modalidades válidas de un campo: las define el dominio, no la interfaz (así servidor, demo y pantalla no pueden discrepar). */
export function modalitiesFor(type: ActivityConfig["type"], field: RecordField): readonly Modality[] {
  return FIELD_RULES[`${type}.${field}`]?.modalities ?? [];
}

/** Sugerencias aplicables a un campo (las ideas de Sombras no son preguntas). */
export function suggestionsFor(cfg: ActivityConfig, field: RecordField): SuggestedOption[] {
  return FIELD_RULES[`${cfg.type}.${field}`]?.suggestions?.(cfg) ?? (cfg.type === "shadows" && field === "firstIdea" ? (cfg as ShadowsActivityConfig).ideaSuggestions : []);
}
