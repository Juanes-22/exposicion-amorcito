import type { AdventureAction, CommandResult } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState } from "../../../shared/contracts/state";
import { BoxesPanel } from "./BoxesPanel";
import { RampsPanel } from "./RampsPanel";
import { RecordsList } from "./RecordsList";
import { ShadowsPanel } from "./ShadowsPanel";
import { stepProgress } from "./steps";
import type { PanelCommon } from "./types";

export interface ActivityViewProps {
  room: string;
  config: LaboratorioConfig;
  adv: AdventureState;
  /** Quien tiene el turno y la sala está en curso: formularios y controles. El resto (proyección) solo lee. */
  interactive: boolean;
  /** Puede volver al mapa aunque la sala ya terminó. */
  canReturn: boolean;
  busy: boolean;
  ownerName: string | null;
  send: (action: AdventureAction) => Promise<CommandResult>;
}

/**
 * Mesa abierta: el avance por pasos, el control del experimento y lo que el grupo ya compartió. El escenario (Phaser) va aparte y
 * se dibuja desde el mismo snapshot; aquí solo hay HTML accesible. Nada de lo escrito sale del dispositivo hasta confirmarlo.
 */
export function ActivityView({ room, config, adv, interactive, canReturn, busy, ownerName, send }: ActivityViewProps) {
  if (adv.view.kind !== "activity") return null;
  const id = adv.view.activityId;
  const cfg = config.activities[id];
  const st = adv.activities[id];
  if (!cfg || !st) return null;

  const common: PanelCommon = { id, room, adv, labels: config.ui.labels, dialogues: config.dialogues, pieces: config.inventor.pieces, maxChars: config.ui.maxRecordCharacters, interactive, busy, ownerName, send };
  const progress = stepProgress(st);
  const piece = config.inventor.pieces.find((p) => p.id === cfg.pieceId);
  const records = adv.notebook.filter((r) => r.activityId === id);

  return (
    <section className="activity" aria-labelledby={`activity-title-${id}`}>
      <header className="activity__head">
        <div>
          <h2 id={`activity-title-${id}`}>{cfg.title}</h2>
          <p className="hint" aria-label={progress.done ? "Mesa completada" : `Paso ${progress.n} de ${progress.total}`}>
            {progress.done ? "Mesa completada" : `Paso ${progress.n} de ${progress.total}`}
          </p>
        </div>
        {canReturn || (interactive && st.type !== "boxes") ? (
          <div className="activity__actions">
            {interactive && st.type !== "boxes" ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void send({ type: "experiment.reset" })}>
                Reiniciar experimento
              </button>
            ) : null}
            {canReturn ? (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void send({ type: "adventure.returnToMap" })}>
                Volver al mapa
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {progress.done && piece ? (
        <div className="banner banner--piece">
          <strong>Conseguimos una pieza: {piece.label}.</strong> {piece.message}
        </div>
      ) : null}

      <div className="activity__body">
        {st.type === "shadows" && cfg.type === "shadows" ? <ShadowsPanel cfg={cfg} st={st} c={common} /> : null}
        {st.type === "ramps" && cfg.type === "ramps" ? <RampsPanel cfg={cfg} st={st} c={common} /> : null}
        {st.type === "boxes" && cfg.type === "boxes" ? <BoxesPanel cfg={cfg} st={st} c={common} /> : null}
      </div>

      <RecordsList records={records} labels={config.ui.labels} />
      {!interactive && ownerName ? <p className="hint">Explora {ownerName}. Esta pantalla solo muestra lo que el grupo comparte.</p> : null}
    </section>
  );
}
