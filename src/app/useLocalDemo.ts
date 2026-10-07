import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AdventureState, ParticipantState } from "../../shared/contracts/state";
import type { LoadedProject } from "../config/loadProject";
import { LocalPlayer } from "./LocalPlayer";

const noopSubscribe = () => () => undefined;
const nobody = (): ParticipantState | null => null;

export interface LocalDemo {
  /** La demostración de Vanessa está abierta. */
  active: boolean;
  /** Estado de la persona de demostración; `null` si no hay ninguna. */
  participant: ParticipantState | null;
  player: LocalPlayer | null;
  start(activityId: string, adv: AdventureState): void;
  stop(): void;
}

/**
 * Demostración de Vanessa sobre la proyección de una sala real. El jugador local nace al pedirla (no en un efecto) y se libera al
 * terminarla o al desmontar: así StrictMode, que ejecuta y deshace los efectos una vez, no destruye una demostración en uso.
 */
export function useLocalDemo(project: LoadedProject): LocalDemo {
  const [player, setPlayer] = useState<LocalPlayer | null>(null);
  const ref = useRef<LocalPlayer | null>(null);
  ref.current = player;
  const participant = useSyncExternalStore(player?.subscribe ?? noopSubscribe, player?.getParticipant ?? nobody);

  useEffect(
    () => () => {
      ref.current?.dispose();
    },
    [],
  );

  // Los efectos secundarios (temporizador) no van dentro de la función de `setPlayer`: React puede ejecutarla dos veces.
  const stop = useCallback(() => {
    ref.current?.dispose();
    ref.current = null;
    setPlayer(null);
  }, []);
  const start = useCallback(
    (activityId: string, adv: AdventureState) => {
      ref.current?.dispose();
      const next = new LocalPlayer(project.bundle, adv, activityId);
      ref.current = next;
      setPlayer(next);
    },
    [project],
  );
  return { active: player !== null, participant, player, start, stop };
}
