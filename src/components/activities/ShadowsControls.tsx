import { useEffect, useState } from "react";
import type { ShadowsActivityConfig } from "../../../shared/contracts/config";
import type { ShadowsState } from "../../../shared/contracts/state";
import { describeShadow, formatNumber, shadowHeightCm } from "../../../shared/domain/models";
import { LightControls } from "./LightControls";
import type { PersonalActions } from "./types";

/** Mantiene un texto estable un momento antes de anunciarlo a lectores de pantalla: arrastrar el slider no debe inundarlos. */
function useSettled(text: string, ms = 700): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setShown(text), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return shown;
}

/**
 * Sombras (propuesta de rondas, sección 5): una persona mueve la linterna y, al terminar cada ajuste, el juego registra la posición y su
 * sombra. Dos posiciones suficientemente distintas quedan como comparación visible, descrita también con texto.
 */
export function ShadowsControls({ cfg, st, a }: { cfg: ShadowsActivityConfig; st: ShadowsState; a: PersonalActions }) {
  const e = cfg.experiment;
  const initial = st.samples.at(-1)?.distanceCm ?? e.sourceDistanceMinCm;
  const [live, setLive] = useState(initial);
  const description = describeShadow(live, shadowHeightCm(live, e.screenDistanceCm, e.objectHeightCm), e.objectHeightCm);
  const announced = useSettled(description);
  const counted = st.samples.filter((s) => s.counts);
  const skipped = st.samples.length - counted.length;

  return (
    <div className="experiment">
      <p className="experiment__readout" role="status" aria-live="polite">
        <span className="visually-hidden">{announced}</span>
        <span aria-hidden="true">{description}</span>
      </p>
      <LightControls
        experiment={e}
        initialCm={initial}
        disabled={!a.interactive}
        onMove={(d) => {
          setLive(d);
          a.setLocal({ lanternCm: d });
        }}
        onCommit={(d) => void a.act({ type: "shadows.sample", distanceCm: d })}
      />
      <ol className="results" aria-label="Posiciones registradas">
        {counted.map((s, i) => (
          <li key={i}>
            Posición {i + 1}: linterna a {formatNumber(s.distanceCm)} cm → sombra de {formatNumber(s.shadowCm, 1)} cm
          </li>
        ))}
      </ol>
      <p className="hint">
        {counted.length >= e.requiredSamples
          ? "Ya tienes dos posiciones para comparar: puedes seguir probando."
          : `Mueve la linterna y suéltala en otro lugar: hacen falta ${e.requiredSamples} posiciones separadas al menos ${formatNumber(e.minDistinctDistanceCm)} cm (llevas ${counted.length}).`}
        {skipped > 0 ? ` ${skipped === 1 ? "Una posición era muy parecida a otra y no cuenta." : `${skipped} posiciones eran muy parecidas a otras y no cuentan.`}` : ""}
      </p>
    </div>
  );
}
