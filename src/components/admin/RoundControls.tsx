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
  disabled: boolean;
  admin: (action: AdminAction) => Promise<unknown>;
  /** Observatorio, en la conversación: la demostración de Vanessa con la ventana y la cortina. */
  houseDemo?: { active: boolean; start: () => void; stop: () => void } | null;
}

/**
 * Los pasos de la ronda (propuesta de rondas, sección 4): abrir la mesa, reunir al grupo con «Conversemos», mostrar la frase de Freire y
 * abrir la siguiente mesa. Solo se ofrece el paso que corresponde a la fase, con el nombre de lo que va a pasar.
 */
export function RoundControls({ config, adv, counter, pending, disabled, admin, houseDemo }: Props) {
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
          {houseDemo ? (
            houseDemo.active ? (
              <button type="button" className="btn" onClick={houseDemo.stop}>
                Volver al laboratorio
              </button>
            ) : (
              <button type="button" className="btn" disabled={off} onClick={houseDemo.start}>
                Mostrar la casa
              </button>
            )
          ) : null}
          <button type="button" className="btn" disabled={off || round.freireShown} onClick={() => void run({ type: "round.showFreire" })}>
            {round.freireShown ? "Frase de Freire mostrada" : "Mostrar la frase de Freire"}
          </button>
          <button type="button" className="btn btn--primary" disabled={off} onClick={() => void run({ type: "round.next" })}>
            {nextTitle ? `Abrir siguiente mesa: ${nextTitle}` : "Pasar al inventor"}
          </button>
          {round.pendingAtConversation.length > 0 ? <span className="hint">Pasamos a conversar con {round.pendingAtConversation.length} {round.pendingAtConversation.length === 1 ? "persona pendiente" : "personas pendientes"}.</span> : null}
        </>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title="Pasar a conversación con pendientes"
          confirmLabel="Pasar a conversación con pendientes"
          busy={sending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void run({ type: "round.converse", withPending: true }).then(() => setConfirm(false))}
        >
          <p>
            Faltan {pending.length} {pending.length === 1 ? "persona" : "personas"} por terminar: {pending.join(", ")}.
          </p>
          <p>Se conserva lo que hicieron, pero no se les da la mesa por terminada, y las pruebas que estén en marcha se cancelan. Esto se usa solo cuando el tiempo no alcanza.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
