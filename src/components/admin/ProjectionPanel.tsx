import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { currentActivityId } from "../../../shared/domain/round";
import { ComparisonView } from "./ComparisonView";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  /** El contador de la ronda: «18 de 24 listos». */
  counter: { ready: number; total: number } | null;
}

/** Durante la exploración solo se proyecta el avance del grupo, en una esquina: el laboratorio sigue ocupando toda la pantalla. */
export function ProjectionBadge({ config, adv, counter }: Props) {
  const id = currentActivityId(adv, config);
  const cfg = id ? config.activities[id] : null;
  if (adv.round.stage !== "exploration" || !cfg) return null;
  return (
    <div className="projection-badge" role="status">
      <strong>{cfg.title}</strong> · {counter ? `${counter.ready} de ${counter.total} listos` : "explorando"}
    </div>
  );
}

/**
 * Lo que se proyecta junto al laboratorio según la fase (propuesta de rondas, secciones 4 y 8): la pregunta con la que Vanessa abre la
 * mesa; en la conversación, la pregunta, los resultados que ella seleccionó y la frase de Freire cuando decide mostrarla; en el cierre,
 * la pregunta del inventor y la pregunta final del grupo. Devuelve `null` si no hay nada que proyectar (la exploración).
 */
export function ProjectionPanel({ config, adv }: Omit<Props, "counter">) {
  const id = currentActivityId(adv, config);
  const cfg = id ? config.activities[id] : null;
  const round = adv.round;
  const presented = adv.notebook.find((n) => n.id === adv.presentedNoteId && n.kind === "comparison")?.comparison ?? null;
  const final = adv.notebook.find((n) => n.id === adv.inventor.finalQuestionId) ?? null;

  if (round.stage === "preparation" && cfg) {
    return (
      <section className="projection" aria-label="Pregunta de la mesa">
        <p className="projection__kicker">
          Mesa {round.index + 1} de {config.route.length} · {cfg.title}
        </p>
        <h2 className="projection__question">{cfg.openingQuestion}</h2>
      </section>
    );
  }
  if (round.stage === "conversation" && cfg) {
    return (
      <section className="projection" aria-label="Conversación">
        <p className="projection__kicker">{cfg.title} · conversemos</p>
        <h2 className="projection__question">{cfg.conversationQuestion}</h2>
        {presented ? <ComparisonView comparison={presented} /> : null}
        {round.freireShown ? <blockquote className="projection__freire">{cfg.freirePhrase}</blockquote> : null}
      </section>
    );
  }
  if (round.stage === "closing") {
    return (
      <section className="projection" aria-label="El inventor">
        <p className="projection__kicker">El inventor · {adv.pieces.length} de {config.inventor.pieces.length} piezas</p>
        <h2 className="projection__question">{final ? (final.text ?? "") : config.inventor.prompt}</h2>
        {final ? (
          <>
            <p className="projection__kicker">{config.inventor.finalMessage}</p>
            <ul className="projection__reflection">
              {config.inventor.reflection.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="projection__pieces" aria-label="Piezas del inventor">
            {config.inventor.pieces.map((p) => (
              <li key={p.id}>
                <strong>{p.label}</strong>: {p.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return null;
}
