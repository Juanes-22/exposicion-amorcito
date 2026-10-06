import type { PieceConfig } from "../../../shared/contracts/config";
import { PieceIcon } from "../ui/PieceIcon";

/**
 * Piezas colectivas conseguidas. Las piezas las deriva el servidor al completar cada mesa: aquí solo se muestran. El estado se dice
 * con texto (no solo con la forma o el color) para lectores de pantalla y para quien no distingue colores.
 */
export function PieceTray({ pieces, have, compact = false }: { pieces: PieceConfig[]; have: string[]; compact?: boolean }) {
  const got = pieces.filter((p) => have.includes(p.id));
  const summary = got.length === pieces.length ? "Tenemos las tres piezas" : `Piezas conseguidas: ${got.length} de ${pieces.length}`;
  return (
    <ul className={`piece-tray${compact ? " piece-tray--compact" : ""}`} aria-label={summary}>
      {pieces.map((p) => {
        const ok = have.includes(p.id);
        return (
          <li key={p.id} className={`piece${ok ? " is-collected" : ""}`}>
            <PieceIcon id={p.id} size={compact ? 30 : 40} collected={ok} />
            <span className={compact ? "visually-hidden" : "piece__label"}>
              {p.label}
              {compact ? (ok ? ": conseguida" : ": falta") : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
