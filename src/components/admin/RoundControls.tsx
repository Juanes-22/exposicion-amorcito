import { useState } from "react";
import type { AdminAction } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { currentActivityId } from "../../../shared/domain/round";
import { ConfirmDialog } from "../ui/ConfirmDialog";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  /** El contador de la ronda: «18 de 24 listos». */
  counter: { ready: number; total: number } | null;
  /** Nombres de quienes no terminaron (para decidir con pendientes). */
  pending: string[];
  /** En el inventor abierto: cuántas personas ya registraron su pregunta. */
  questions?: { registered: number; total: number };
  disabled: boolean;
  admin: (action: AdminAction) => Promise<unknown>;
}

/**
 * Los pasos de la ronda (propuesta de rondas, sección 4): abrir la mesa, reunir al grupo con «Conversemos», mostrar la frase de Freire y
 * abrir la siguiente mesa; al final, abrir el inventor. Solo se ofrece el paso que corresponde, con el nombre de lo que va a pasar: en la
 * conversación, «Abrir siguiente mesa» aparece recién cuando ya se mostró la frase de Freire, en lugar de ese botón.
 */
export function RoundControls({ config, adv, counter, pending, questions, disabled, admin }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const round = adv.round;
  const id = currentActivityId(adv, config);
  const cfg = id ? config.activities[id] : null;
  const nextId = round.index + 1 < config.route.length ? config.route[round.index + 1]! : null;
  const nextTitle = nextId ? config.activities[nextId]!.title : null;
  const run = async (action: AdminAction) => {
    setSending(true);
    try {
      await admin(action);
    } finally {
      setSending(false);
    }
  };
  const off = disabled || sending;

  return (
    <div className="round-controls">
      {round.stage === "preparation" && cfg ? (
        <>
          <button type="button" className="btn btn--primary" disabled={off} onClick={() => void run({ type: "round.open" })}>
            Abrir mesa: {cfg.title}
          </button>
        </>
      ) : null}

      {round.stage === "exploration" && cfg ? (
        <>
          <span className="round-controls__counter" role="status" aria-live="polite">
            <strong>{counter ? `${counter.ready} de ${counter.total}` : "—"}</strong> listos
          </span>
          {counter && counter.total > 0 && counter.ready === counter.total ? (
            <span className="chip chip--ok" role="status">
              ✓ Todas las personas están listas
            </span>
          ) : null}
          <button type="button" className="btn btn--primary" disabled={off} onClick={() => (pending.length > 0 ? setConfirm(true) : void run({ type: "round.converse" }))}>
            Conversemos
          </button>
        </>
      ) : null}

      {round.stage === "conversation" && cfg ? (
        <>
          {/* Un paso a la vez: primero la frase de Freire; ya mostrada, ese botón deja su lugar al de la siguiente mesa. */}
          {round.freireShown ? (
            <button type="button" className="btn btn--primary" disabled={off} onClick={() => void run({ type: "round.next" })}>
              {nextTitle ? `Abrir siguiente mesa: ${nextTitle}` : "Pasar al inventor"}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={off} onClick={() => void run({ type: "round.showFreire" })}>
              Mostrar la frase de Freire
            </button>
          )}
          {round.pendingAtConversation.length > 0 ? <span className="hint">Pasamos a conversar con {round.pendingAtConversation.length} {round.pendingAtConversation.length === 1 ? "persona pendiente" : "personas pendientes"}.</span> : null}
        </>
      ) : null}

      {round.stage === "closing" ? (
        adv.inventor.open ? (
          questions ? (
            <span className="round-controls__counter" role="status" aria-live="polite">
              <strong>{`${questions.registered} de ${questions.total}`}</strong> preguntas registradas
            </span>
          ) : null
        ) : (
          // Como en una mesa: primero todas las personas caminan hasta la máquina; Vanessa la abre cuando el grupo está ahí.
          <button type="button" className="btn btn--primary" disabled={off} onClick={() => void run({ type: "inventor.open" })}>
            Abrir inventor
          </button>
        )
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title="Todavía hay personas explorando"
          confirmLabel="Conversar ahora"
          cancelLabel="Esperar un poco más"
          busy={sending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void run({ type: "round.converse", withPending: true }).then(() => setConfirm(false))}
        >
          {counter ? (
            <p>
              Ya terminaron <strong>{`${counter.ready} de ${counter.total}`}</strong>.
            </p>
          ) : null}
          <p>{pending.length === 1 ? "Aún no termina:" : `Aún no terminan ${pending.length} personas:`}</p>
          <ul className="modal__names" aria-label="Personas que aún no terminan">
            {pending.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p>Si pasan a conversar ahora:</p>
          <ul className="modal__notes">
            <li>lo que hicieron se conserva;</li>
            <li>no se les da la mesa por terminada;</li>
            {cfg?.type === "ramps" ? <li>si alguna pelota sigue rodando, esa prueba se cancela.</li> : null}
          </ul>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
