import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  /** Explica el efecto de la acción antes de confirmarla (SPECS 2.3). */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Diálogo modal accesible: foco al abrir (en «Cancelar», la opción segura), Escape cierra, Tab no sale del diálogo. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Cancelar", danger, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Tab" && ref.current) {
      const items = ref.current.querySelectorAll<HTMLElement>("button:not([disabled])");
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last?.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first?.focus());
    }
  };

  return (
    <div className="modal-backdrop" onKeyDown={onKeyDown}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" ref={ref}>
        <h2 id="confirm-title">{title}</h2>
        <div id="confirm-body">{children}</div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${danger ? "btn--danger" : "btn--primary"}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
