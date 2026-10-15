import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandResult, ParticipantAction } from "../../shared/contracts/actions";
import type { ProjectBundle } from "../../shared/config/validateProject";
import type { AdventureState, ParticipantState, RoomState } from "../../shared/contracts/state";
import { reduceParticipant, settleTrials } from "../../shared/domain/participant";
import { tableShowcase } from "./tableShowcase";

/** Identidad de la persona ficticia con la que Vanessa explora: nunca coincide con la de nadie de la sala. */
const VANESSA = "vanessa:proyeccion";

/** Lo que Vanessa puede hacer en su mesa: solo los experimentos (no camina, no entra al inventor). */
const ALLOWED: ReadonlyArray<ParticipantAction["type"]> = ["shadows.sample", "ramps.trial.start", "telescope.aim"];

export interface VanessaTable {
  /** Su estado en la mesa abierta, o `null` fuera de la exploración. Lo dibuja la proyección. */
  participant: ParticipantState | null;
  /** Aplica una acción con las mismas reglas que en los celulares, en el reloj de la sala (`activeMs`). */
  act(action: ParticipantAction, activeMs: number): CommandResult;
  /** Termina la prueba de rampa cuya hora llegó (la pelota llegó abajo). */
  settle(activeMs: number): void;
}

/**
 * Vanessa también explora la mesa abierta, en la proyección (15 de octubre de 2026): mueve la linterna, suelta la pelota o mira por
 * el telescopio. Es su propio experimento, local a la consola, con las reglas del dominio compartido y el reloj de la sala: no pasa por
 * el servidor, no cuenta en «N de M listos», no va al cuaderno y no toca el de nadie. Empieza en el estado inicial de la mesa cada vez
 * que se abre una y desaparece al conversar.
 */
export function useVanessaTable(adv: AdventureState | null, bundle: Pick<ProjectBundle, "config" | "map" | "nav">): VanessaTable {
  const { config } = bundle;
  const initial = useMemo(() => (adv ? tableShowcase(adv, config) : null), [adv?.round.stage, adv?.round.index, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<{ p: ParticipantState; trial: number } | null>(initial ? { p: initial, trial: 0 } : null);
  useEffect(() => setState(initial ? { p: initial, trial: 0 } : null), [initial]);

  const act = useCallback(
    (action: ParticipantAction, activeMs: number): CommandResult => {
      const fail = (message: string): CommandResult => ({ ok: false, requestId: "vanessa", code: "INVALID_STEP", message });
      if (!state || !adv) return fail("La mesa no está abierta.");
      if (!ALLOWED.includes(action.type)) return fail("En la proyección solo se hace el experimento.");
      const room = { adventure: { ...adv, counters: { ...adv.counters, trial: state.trial } }, participants: { [VANESSA]: state.p } } as unknown as RoomState;
      const r = reduceParticipant(room, VANESSA, action, { config, map: bundle.map, nav: bundle.nav, activeMs });
      if (!r.ok) return fail(r.message);
      setState({ p: r.participant, trial: r.counters.trial });
      return { ok: true, requestId: "vanessa", stateVersion: 0, roundVersion: 0 };
    },
    [state, adv, config, bundle.map, bundle.nav],
  );

  const settle = useCallback((activeMs: number) => {
    setState((cur) => {
      if (!cur) return cur;
      const p = structuredClone(cur.p);
      return settleTrials(p, activeMs) ? { ...cur, p } : cur;
    });
  }, []);

  return { participant: state?.p ?? null, act, settle };
}
