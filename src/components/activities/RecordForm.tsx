import { useEffect, useId, useRef, useState } from "react";
import type { CommandResult, RecordValueInput } from "../../../shared/contracts/actions";
import type { BoxesSharedObject, SuggestedOption } from "../../../shared/contracts/config";
import type { Modality, RecordField } from "../../../shared/contracts/state";
import { countChars } from "../../../shared/domain/text";
import { drafts } from "./drafts";

export interface RecordFormProps {
  room: string;
  activityId: string;
  field: RecordField;
  /** Lo que se pregunta en este paso (contenido editable de laboratorio.json). */
  prompt: string;
  /** Modalidades válidas para el campo (las define el dominio: `FIELD_RULES`). */
  modalities: readonly Modality[];
  suggestions: SuggestedOption[];
  suggestionsLabel: string;
  /** Cajas: objetos entre los que elegir para una pregunta escrita u oral (una pregunta sugerida ya trae el suyo). */
  objects?: BoxesSharedObject[];
  initialObjectId?: string;
  labels: Record<string, string>;
  maxChars: number;
  /** Hay un comando en vuelo: no se puede enviar otro. */
  busy: boolean;
  /** Devuelve el resultado del servidor; el formulario no se vacía si fue denegado. */
  onSubmit: (value: RecordValueInput, objectId?: string) => Promise<CommandResult>;
  /** Edición de un registro: parte de su valor vigente y no deja enviar lo mismo. */
  initial?: { modality: Modality; text: string | null; optionId?: string };
  /** Clave propia del borrador (p. ej. una edición no comparte borrador con el formulario de confirmar). */
  draftField?: string;
  submitLabel?: string;
  onCancel?: () => void;
}

const MODE_LABEL: Record<Modality, string> = { written: "Escribir", suggested: "Elegir", oral: "Lo diremos en voz alta", uncertain: "Todavía no sé" };

/**
 * Formulario común de registros (SPECS 3.1, PLAN P4-04). Recuerda que lo confirmado se comparte con el grupo; el texto escrito es un
 * BORRADOR LOCAL que no se proyecta letra por letra y solo viaja al pulsar «Compartir». La validación definitiva es del servidor.
 */
export function RecordForm(props: RecordFormProps) {
  const { room, activityId, field, modalities, suggestions, objects, labels, maxChars, busy } = props;
  const { initial } = props;
  const key = { room, activityId, field: props.draftField ?? field };
  const uid = useId();
  const available = modalities.filter((m) => m !== "suggested" || suggestions.length > 0);
  const [mode, setMode] = useState<Modality>(initial && available.includes(initial.modality) ? initial.modality : (available[0] ?? "written"));
  const [text, setText] = useState(() => drafts.get(key) || initial?.text || "");
  const [optionId, setOptionId] = useState(initial?.optionId ?? "");
  const [objectId, setObjectId] = useState(props.initialObjectId ?? "");
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);

  // Si el paso cambia de campo, se recupera el borrador de ese campo (y solo de ese).
  useEffect(() => setText(drafts.get({ room, activityId, field: props.draftField ?? field }) || initial?.text || ""), [room, activityId, field, props.draftField]);
  useEffect(() => {
    if (props.initialObjectId) setObjectId(props.initialObjectId);
  }, [props.initialObjectId]);

  const chars = countChars(text.trim());
  const tooLong = chars > maxChars;
  const needsObject = objects !== undefined && (mode === "written" || mode === "oral");
  const chosen = suggestions.find((s) => s.id === optionId);
  const valid =
    (mode === "written" ? chars > 0 && !tooLong : mode === "suggested" ? chosen !== undefined : true) && (!needsObject || objectId !== "");
  // Editar sin cambiar nada no crea una versión nueva.
  const unchanged =
    initial !== undefined &&
    mode === initial.modality &&
    (mode === "written" ? text.trim() === (initial.text ?? "") : mode === "suggested" ? optionId === initial.optionId : true);
  const disabled = busy || sending || !valid || unchanged;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const value: RecordValueInput = mode === "written" ? { modality: "written", text: text.trim() } : mode === "suggested" ? { modality: "suggested", optionId } : { modality: mode };
    setSending(true);
    try {
      const result = await props.onSubmit(value, needsObject ? objectId : undefined);
      // Una denegación se avisa (lo hace el controlador) y se conserva lo escrito: nada se pierde ni queda bloqueado.
      if (result.ok) {
        drafts.clear(key);
        setText("");
        setOptionId("");
      }
    } finally {
      setSending(false);
    }
  };

  // Con el teclado del celular abierto el botón de compartir debe seguir al alcance.
  const reveal = (el: HTMLElement | null) => window.setTimeout(() => el?.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 300);

  return (
    <form className="record-form" onSubmit={submit} noValidate>
      <p className="record-form__notice" role="note">{labels.shareNotice ?? "Esta idea se compartirá con el grupo"}</p>
      <p className="record-form__prompt">{props.prompt}</p>

      {available.length > 1 ? (
        <fieldset className="record-form__modes">
          <legend className="visually-hidden">Cómo quieres responder</legend>
          {available.map((m) => (
            <label key={m} className={`mode${mode === m ? " is-selected" : ""}`}>
              <input type="radio" name={`${uid}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)} />
              <span>{m === "suggested" ? props.suggestionsLabel : MODE_LABEL[m]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {mode === "written" ? (
        <div className="field">
          <label htmlFor={`${uid}-text`}>Tu respuesta</label>
          <textarea
            id={`${uid}-text`}
            ref={area}
            className="input record-form__text"
            rows={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              drafts.set(key, e.target.value);
            }}
            onFocus={(e) => reveal(e.currentTarget)}
            aria-describedby={`${uid}-count`}
            aria-invalid={tooLong}
            autoComplete="off"
          />
          <span id={`${uid}-count`} className={`hint${tooLong ? " error" : ""}`}>
            {chars}/{maxChars} caracteres. Tu borrador se queda en este dispositivo hasta que lo compartas.
          </span>
        </div>
      ) : null}

      {mode === "suggested" ? (
        <fieldset className="record-form__options">
          <legend className="visually-hidden">{props.suggestionsLabel}</legend>
          {suggestions.map((s) => (
            <label key={s.id} className={`option${optionId === s.id ? " is-selected" : ""}`}>
              <input type="radio" name={`${uid}-option`} value={s.id} checked={optionId === s.id} onChange={() => setOptionId(s.id)} />
              <span>{s.text}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {mode === "oral" ? <p className="record-form__fixed">{labels.oralRecord ?? "Lo compartiremos en voz alta"}</p> : null}
      {mode === "uncertain" ? <p className="record-form__fixed">{labels.uncertainRecord ?? "Todavía no tenemos una explicación"}</p> : null}

      {needsObject ? (
        <fieldset className="record-form__options">
          <legend>¿Sobre qué objeto es tu pregunta?</legend>
          {objects!.map((o) => (
            <label key={o.id} className={`option${objectId === o.id ? " is-selected" : ""}`}>
              <input type="radio" name={`${uid}-object`} value={o.id} checked={objectId === o.id} onChange={() => setObjectId(o.id)} />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="record-form__actions">
        <button type="submit" className="btn btn--primary" disabled={disabled} onFocus={(e) => reveal(e.currentTarget)}>
          {sending || busy ? "Compartiendo…" : (props.submitLabel ?? "Compartir con el grupo")}
        </button>
        {props.onCancel ? (
          <button type="button" className="btn btn--ghost" onClick={props.onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
