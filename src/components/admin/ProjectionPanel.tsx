import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { currentActivityId } from "../../../shared/domain/round";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  /** El contador de la ronda: «18 de 24 listos». */
  counter: { ready: number; total: number } | null;
}

/**
 * Durante la exploración se proyecta el avance del grupo, en una esquina del laboratorio. En el inventor no hay esquina: el conteo de
 * preguntas está en la barra de Vanessa y la esquina taparía el título de la máquina.
 */
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
 * ¿Hay algo que proyectar junto al laboratorio? Al comenzar, la pregunta de entrada; al abrir cada mesa, su pregunta; en la conversación y
 * el cierre, siempre. Antes de abrir las mesas siguientes, nada: el laboratorio ocupa toda la pantalla mientras las personas caminan.
 */
export function hasProjection(config: LaboratorioConfig, adv: AdventureState): boolean {
  const { stage, index } = adv.round;
  if (stage === "preparation") return index === 0;
  return stage === "closing" || currentActivityId(adv, config) !== null;
}

/**
 * Lo que se proyecta junto al laboratorio según la fase (propuesta de rondas, secciones 4 y 8, y la guía de Vanessa): al comenzar, solo la
 * pregunta de entrada; al abrir cada mesa, su pregunta, mientras las personas exploran; en la conversación, la pregunta y la frase de
 * Freire cuando decide mostrarla; en el cierre, la pregunta del inventor y, al final, la pregunta del grupo, la reflexión y la invitación
 * para seguir pensando. Devuelve `null` si no hay nada que proyectar (ver `hasProjection`).
 */
export function ProjectionPanel({ config, adv }: Omit<Props, "counter">) {
  const id = currentActivityId(adv, config);
  const cfg = id ? config.activities[id] : null;
  const round = adv.round;
  const final = adv.notebook.find((n) => n.id === adv.inventor.finalQuestionId) ?? null;

  if (!hasProjection(config, adv)) return null;
  if (round.stage === "preparation") {
    return (
      <section className="projection" aria-label="Pregunta de entrada">
        <p className="projection__kicker">Pregunta de entrada</p>
        <h2 className="projection__question">{config.project.entryQuestion}</h2>
      </section>
    );
  }
  if (round.stage === "exploration" && cfg) {
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
        <h2 className="projection__question">{round.freireShown && cfg.freireQuestion ? cfg.freireQuestion : cfg.conversationQuestion}</h2>
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
            <p className="projection__kicker">Para seguir pensando</p>
            <p className="projection__next">{config.inventor.closingQuestion}</p>
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
