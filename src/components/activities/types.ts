import type { CommandResult, ParticipantAction } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { LocalExperiment } from "../../game/bridge/events";

/** Lo que los controles de una mesa necesitan: el mismo contrato en el celular de una persona y en la demostración de Vanessa. */
export interface PersonalActions {
  /** Acción personal: se registra en el servidor (o, en la demostración, solo en local). */
  act: (action: ParticipantAction) => Promise<CommandResult>;
  /** Lo que solo existe en el dispositivo mientras se ajusta (linterna, inclinación): lo dibuja la escena sin esperar al servidor. */
  setLocal: (patch: Partial<LocalExperiment>) => void;
  /** Avisos de lo local que cambia la escena (arrastrar el visor del telescopio). Devuelve la función que retira la suscripción. */
  onLocal?: (listener: (local: LocalExperiment) => void) => () => void;
  /** Hay un comando en vuelo: se bloquean los botones para no duplicar. */
  busy: boolean;
  /** La mesa está abierta para explorar: fuera de la exploración los controles se detienen. */
  interactive: boolean;
  config: LaboratorioConfig;
}
