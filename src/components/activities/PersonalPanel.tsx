import type { CommandResult, ParticipantAction } from "../../../shared/contracts/actions";
import type { LaboratorioConfig } from "../../../shared/contracts/config";
import type { AdventureState, ParticipantState } from "../../../shared/contracts/state";
import { readiness } from "../../../shared/domain/results";
import type { LocalExperiment } from "../../game/bridge/events";
import { RampsControls } from "./RampsControls";
import { ShadowsControls } from "./ShadowsControls";
import { TelescopeControls } from "./TelescopeControls";
import type { PersonalActions } from "./types";

export interface PersonalPanelProps {
  config: LaboratorioConfig;
  adv: AdventureState;
  participant: ParticipantState;
  act: (action: ParticipantAction) => Promise<CommandResult>;
  setLocal: (patch: Partial<LocalExperiment>) => void;
  /** Avisos de lo local que cambia la escena (arrastrar el visor del telescopio). */
  onLocal?: (listener: (local: LocalExperiment) => void) => () => void;
  busy: boolean;
  /** La mesa está abierta para explorar: fuera de la exploración los controles se detienen. */
  interactive: boolean;
  /** Vanessa explora en la proyección: los mismos controles, sin «Volver al mapa» ni avance propio (su prueba no cuenta para el grupo). */
  facilitator?: boolean;
}

/**
 * Lo que cada persona usa en su celular mientras explora la mesa habilitada (propuesta de rondas, secciones 5–7): el objetivo corto, los
 * controles del experimento y si ya quedó lista para conversar; «Volver al mapa» aparece recién al completarla. Los resultados se
 * registran solos; no hay formularios, modalidades de respuesta ni botones de «anotar» o «entendido».
 */
export function PersonalPanel({ config, adv, participant, act, setLocal, onLocal, busy, interactive, facilitator = false }: PersonalPanelProps) {
  if (participant.view.kind !== "activity") return null;
  const id = participant.view.activityId;
  const cfg = config.activities[id];
  const st = participant.activities[id];
  if (!cfg || !st) return null;
  const r = readiness(st, cfg);
  const labels = config.ui.labels;
  const actions: PersonalActions = { act, setLocal, ...(onLocal ? { onLocal } : {}), busy, interactive, config };

  if (facilitator) {
    return (
      <section className="personal" aria-labelledby="personal-title">
        <h2 id="personal-title" className="visually-hidden">Prueba la mesa: {cfg.title}</h2>
        <p className="hint">Prueba la mesa en la proyección: es tu propio experimento y no cuenta para el grupo.</p>
        {!interactive ? <p className="hint" role="status">La mesa está en pausa.</p> : null}
        {cfg.type === "shadows" && st.type === "shadows" ? <ShadowsControls cfg={cfg} st={st} a={actions} /> : null}
        {cfg.type === "ramps" && st.type === "ramps" ? <RampsControls cfg={cfg} st={st} a={actions} /> : null}
        {cfg.type === "telescope" && st.type === "telescope" ? <TelescopeControls cfg={cfg} st={st} a={actions} /> : null}
      </section>
    );
  }

  return (
    <section className="personal" aria-labelledby="personal-title">
      <header className="personal__head">
        <h2 id="personal-title">{cfg.title}</h2>
        {/* Solo quien ya completó la mesa puede volver al mapa: antes, la mesa se queda abierta hasta terminarla. */}
        {r.ready ? (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void act({ type: "adventure.returnToMap" })}>
            Volver al mapa
          </button>
        ) : null}
      </header>
      <p className="personal__goal">{cfg.goal}</p>
      <p className={`chip ${r.ready ? "chip--ok" : ""}`} role="status">
        {r.ready ? "✓ Listo para conversar" : `Explorando · ${r.done} de ${r.needed}`}
      </p>
      <p className="hint">{r.ready ? (cfg.readyText ?? labels.readyYou) : labels.notReadyYou}</p>
      {!interactive ? <p className="hint" role="status">{adv.round.stage === "exploration" ? "La mesa está en pausa." : labels.roundConversationPhone}</p> : null}
      {cfg.type === "shadows" && st.type === "shadows" ? <ShadowsControls cfg={cfg} st={st} a={actions} /> : null}
      {cfg.type === "ramps" && st.type === "ramps" ? <RampsControls cfg={cfg} st={st} a={actions} /> : null}
      {cfg.type === "telescope" && st.type === "telescope" ? <TelescopeControls cfg={cfg} st={st} a={actions} /> : null}
    </section>
  );
}
