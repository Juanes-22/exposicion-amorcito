import { useEffect } from "react";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import type { VanessaTable } from "../../app/useVanessaTable";
import type { GameBridge } from "../../game/bridge/GameBridge";
import { PersonalPanel } from "../activities/PersonalPanel";

interface Props {
  config: LaboratorioConfig;
  adv: AdventureState;
  table: VanessaTable;
  bridge: GameBridge;
  /** La sala está en curso: en pausa los controles se detienen. */
  interactive: boolean;
}

/**
 * Los controles con los que Vanessa prueba la mesa abierta en la proyección (los mismos de los celulares). Su experimento vive en la
 * consola (`useVanessaTable`) y usa el reloj de la sala: la pelota rueda y termina igual que en los celulares.
 */
export function VanessaTablePanel({ config, adv, table, bridge, interactive }: Props) {
  const p = table.participant;
  const { settle } = table;
  // En los celulares el servidor termina cada prueba de rampa en su instante; aquí se hace al llegar esa hora en el reloj de la sala.
  useEffect(() => {
    const rolling = p !== null && Object.values(p.activities).some((st) => st.type === "ramps" && st.trials.some((t) => t.state === "running"));
    if (!rolling) return;
    const timer = setInterval(() => settle(bridge.clock.now()), 150);
    return () => clearInterval(timer);
  }, [p, bridge, settle]);

  if (!p) return null;
  return (
    <PersonalPanel
      config={config}
      adv={adv}
      participant={p}
      act={async (a) => table.act(a, bridge.clock.now())}
      setLocal={(patch) => bridge.setLocal(patch)}
      onLocal={(cb) => bridge.on("app:local", cb)}
      busy={false}
      interactive={interactive}
      facilitator
    />
  );
}
