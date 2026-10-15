import { useEffect, useState } from "react";
import type { ShadowsActivityConfig } from "../../../shared/contracts/config";
import type { ShadowsState } from "../../../shared/contracts/state";
import { describeShadow } from "../../../shared/domain/models";
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
 * sombra. Dos posiciones suficientemente distintas quedan como comparación visible en la escena. La pantalla no dice qué tan grande es la
 * sombra ni lista las posiciones: cada persona hace sus propias observaciones mirando. Solo quien usa un lector de pantalla, que no puede
 * ver la escena, recibe la descripción con palabras (SPECS 11.1).
 */
export function ShadowsControls({ cfg, st, a }: { cfg: ShadowsActivityConfig; st: ShadowsState; a: PersonalActions }) {
  const e = cfg.experiment;
  const initial = st.samples.at(-1)?.distanceCm ?? e.sourceDistanceMinCm;
  const [live, setLive] = useState(initial);
  const announced = useSettled(describeShadow(e, live));
  const counted = st.samples.filter((s) => s.counts);
  const skipped = st.samples.length - counted.length;

  return (
    <div className="experiment">
      <p className="visually-hidden" role="status" aria-live="polite">
        {announced}
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
      <p className="hint">
        {counted.length >= e.requiredSamples
          ? "Ya tienes dos posiciones para comparar: puedes seguir probando."
          : `Mueve la linterna y suéltala en otro lugar: hacen falta ${e.requiredSamples} posiciones bien distintas, una más cerca y otra más lejos (llevas ${counted.length}).`}
        {skipped > 0 ? ` ${skipped === 1 ? "Una posición era muy parecida a otra y no cuenta." : `${skipped} posiciones eran muy parecidas a otras y no cuentan.`}` : ""}
      </p>
    </div>
  );
}
