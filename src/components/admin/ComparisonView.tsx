import type { Comparison } from "../../../shared/contracts/state";
import { formatNumber } from "../../../shared/domain/models";

/**
 * Resultados de una persona proyectados para conversar: barras proporcionales y, siempre, el mismo contenido escrito (los resultados
 * no dependen del color ni del tamaño de una barra). Es una copia de lo que la persona registró: seleccionarla no cambia su cuaderno.
 */
export function ComparisonView({ comparison }: { comparison: Comparison }) {
  const d = comparison.data;
  let rows: Array<{ label: string; value: string; ratio: number }> = [];
  if (d.type === "shadows") {
    const max = Math.max(...d.samples.map((s) => s.shadowCm), 1);
    rows = d.samples.map((s) => ({ label: `Linterna a ${formatNumber(s.distanceCm)} cm`, value: `sombra de ${formatNumber(s.shadowCm, 1)} cm`, ratio: s.shadowCm / max }));
  } else {
    const max = Math.max(...d.trials.map((t) => t.durationMs), 1);
    rows = d.trials.map((t) => ({ label: `Inclinación de ${formatNumber(t.angleDeg)}°`, value: `${formatNumber(t.durationMs / 1000, 1)} s en la simulación`, ratio: t.durationMs / max }));
  }
  return (
    <figure className="comparison">
      <figcaption>Resultados de {comparison.authorName}</figcaption>
      <ul className="comparison__rows">
        {rows.map((r, i) => (
          <li key={i}>
            <span className="comparison__label">{r.label}</span>
            <span className="comparison__bar" aria-hidden="true">
              <span style={{ width: `${Math.round(Math.max(0.08, r.ratio) * 100)}%` }} />
            </span>
            <span className="comparison__value">{r.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
