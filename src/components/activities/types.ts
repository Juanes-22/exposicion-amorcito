import type { AdventureAction, CommandResult } from "../../../shared/contracts/actions";
import type { PieceConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";

/** Lo que todas las mesas necesitan para mostrarse y actuar. `interactive` = quien tiene el turno; el resto (proyección) solo lee. */
export interface PanelCommon {
  id: string;
  room: string;
  adv: AdventureState;
  labels: Record<string, string>;
  dialogues: Record<string, string>;
  pieces: PieceConfig[];
  maxChars: number;
  interactive: boolean;
  /** Hay un comando en vuelo: se bloquean los botones para no duplicar. */
  busy: boolean;
  /** Quién tiene el turno (para el texto de la proyección). */
  ownerName: string | null;
  send: (action: AdventureAction) => Promise<CommandResult>;
}
