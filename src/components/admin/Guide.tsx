import type { LaboratorioConfig } from "../../../shared/contracts/config";
import { SUPPORT_PHRASE_KEYS } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { currentActivityId } from "../../../shared/domain/round";

const SUPPORT_LABEL: Record<(typeof SUPPORT_PHRASE_KEYS)[number], string> = {
  inicio: "Para empezar",
  antesDeReunir: "Antes de reunir al grupo",
  alExplicar: "Al explicar con Freire",
  cierre: "Para cerrar",
};

/** Guion de Vanessa para el momento actual y las frases de apoyo (contenido editable en `laboratorio.json`). */
export function Guide({ config, adv, phase }: { config: LaboratorioConfig; adv: AdventureState; phase: string }) {
  const id = currentActivityId(adv, config);
  const key = phase === "welcome" ? "bienvenida" : (id ?? "cierre");
  const notes = config.facilitatorNotes[key] ?? [];
  return (
    <div className="stack">
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <details>
        <summary>Frases de apoyo</summary>
        <dl className="support-phrases">
          {SUPPORT_PHRASE_KEYS.map((k) => (
            <div key={k}>
              <dt>{SUPPORT_LABEL[k]}</dt>
              <dd>{config.supportPhrases[k]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
