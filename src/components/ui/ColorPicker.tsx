import { PARTICIPANT_COLORS } from "../../../shared/contracts/limits";

/** El color no es el identificador y no es lo único que distingue: cada opción lleva su nombre y una marca de selección. */
export function ColorPicker({ value, onChange, legend = "Elige tu color" }: { value: string; onChange: (id: string) => void; legend?: string }) {
  return (
    <fieldset className="color-picker">
      <legend>{legend}</legend>
      {/* El marco mide el espacio disponible: las opciones se acomodan a él (container queries), no al ancho de la ventana. */}
      <div className="color-picker__frame">
        <div className="color-picker__options">
          {PARTICIPANT_COLORS.map((c) => (
          <label key={c.id} className={`color-option${value === c.id ? " is-selected" : ""}`}>
            <input type="radio" name="color" value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} />
            <span className="color-option__swatch" style={{ background: c.hex }} aria-hidden="true">
              {value === c.id ? "✓" : ""}
            </span>
            <span className="color-option__label">{c.label}</span>
          </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
