import { useEffect, useRef, useState } from "react";
import type { TelescopeActivityConfig } from "../../../shared/contracts/config";
import type { TelescopeState } from "../../../shared/contracts/state";
import { centeredTargets, clampView, fieldRadius, HORIZON_Y, isVisible, startView, TELESCOPE_TARGETS, TELESCOPE_ZONES, type TelescopeView } from "../../../shared/domain/telescope";
import type { PersonalActions } from "./types";

/** Cuánto se mueve el visor con cada flecha, en fracción de lo que se ve. */
const STEP = 0.35;
/** Sin una observación nueva, la vista quieta se guarda (para reabrir la mesa ahí) tras esta pausa. */
const PERSIST_MS = 2000;

const sameView = (a: TelescopeView, b: TelescopeView) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && a.zoom === b.zoom;

/** Mantiene un texto estable un momento antes de anunciarlo a lectores de pantalla: mover el visor no debe inundarlos. */
function useSettled(text: string, ms = 700): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setShown(text), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return shown;
}

/** Lo que se ve por el visor, dicho con palabras (SPECS 11.1): la misma información que la escena, sin depender de verla. */
function describe(view: TelescopeView, st: TelescopeState, cfg: TelescopeActivityConfig, curtainJustClosed: boolean): string {
  const exp = cfg.experiment;
  const c = centeredTargets(view, exp);
  const parts: string[] = [view.zoom >= 1 ? "Aumento cercano." : "Aumento general."];
  if (c.moon) parts.push("La Luna de cerca: zonas claras y oscuras y algunos cráteres.");
  else if (isVisible(view, exp, TELESCOPE_TARGETS.moon)) parts.push("La Luna está a la vista.");
  if (c.stars) parts.push("Un grupo de estrellas brillantes, muy juntas.");
  else if (isVisible(view, exp, TELESCOPE_TARGETS.stars)) parts.push("Hay un grupo de estrellas a la vista.");
  if (view.y + fieldRadius(exp, view.zoom) > HORIZON_Y) parts.push("Abajo se ven los tejados de unas casas.");
  if (isVisible(view, exp, TELESCOPE_TARGETS.window)) {
    if (curtainJustClosed) parts.push("Una persona cierra la cortina.");
    else parts.push(st.curtain === "open" ? "Ventana iluminada; dos siluetas gesticulan como si discutieran." : "La ventana tiene la cortina cerrada.");
  }
  if (parts.length === 1) parts.push("Cielo oscuro con estrellas pequeñas.");
  return parts.join(" ");
}

/**
 * El observatorio (SPECS 3.4): mover el telescopio con flechas o por zonas, acercar y alejar, y volver al cielo. Es la alternativa
 * accesible de arrastrar en el visor y produce las mismas observaciones. No hay ningún botón ni zona que lleve a la ventana de la casa:
 * se encuentra, o no, explorando. La vista mientras se mueve es local; cuando queda quieta se envía y el servidor decide qué se observó.
 */
export function TelescopeControls({ cfg, st, a }: { cfg: TelescopeActivityConfig; st: TelescopeState; a: PersonalActions }) {
  const exp = cfg.experiment;
  const [view, setView] = useState<TelescopeView>(() => clampView({ x: st.x, y: st.y, zoom: st.zoom }, exp));
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastSent = useRef<TelescopeView>(clampView({ x: st.x, y: st.y, zoom: st.zoom }, exp));
  const disabled = !a.interactive;

  // Al abrir la mesa, la escena dibuja desde esta vista; al salir se olvida (la próxima vez se parte de lo que guardó el servidor).
  // Lo que la persona arrastre en el visor llega por `onLocal`.
  useEffect(() => {
    a.setLocal({ telescope: viewRef.current });
    const off = a.onLocal?.((l) => {
      if (l.telescope && !sameView(l.telescope, viewRef.current)) setView(l.telescope);
    });
    return () => {
      off?.();
      a.setLocal({ telescope: null });
    };
    // Solo al abrir y cerrar la mesa: el puente es el mismo durante toda la visita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (next: TelescopeView) => {
    const v = clampView(next, exp);
    setView(v);
    a.setLocal({ telescope: v });
  };

  // Vista quieta: si centra algo nuevo (o la ventana con la cortina abierta) se envía tras la pausa de observación; si solo se movió,
  // se guarda un poco después, para poder reabrir la mesa en el mismo lugar sin escribir en cada movimiento.
  const observedKey = st.observed.join(",");
  useEffect(() => {
    if (!a.interactive) return;
    const c = centeredTargets(view, exp);
    const observes = (c.moon && !st.observed.includes("moon")) || (c.stars && !st.observed.includes("stars"));
    const closesCurtain = c.window && st.curtain === "open";
    if (!observes && !closesCurtain && sameView(view, lastSent.current)) return;
    const wait = closesCurtain ? exp.curtainDelayMs : observes ? exp.dwellMs : PERSIST_MS;
    const t = setTimeout(() => {
      lastSent.current = view;
      void a.act({ type: "telescope.aim", x: view.x, y: view.y, zoom: view.zoom });
    }, wait);
    return () => clearTimeout(t);
    // `a` cambia en cada render; lo que importa es la vista, si se puede explorar y lo ya registrado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.x, view.y, view.zoom, a.interactive, st.curtain, observedKey]);

  // «Una persona cierra la cortina» se anuncia una vez, cuando ocurre; después se describe como cerrada.
  const [justClosed, setJustClosed] = useState(false);
  const prevCurtain = useRef(st.curtain);
  useEffect(() => {
    if (prevCurtain.current === "open" && st.curtain === "closed") {
      setJustClosed(true);
      const t = setTimeout(() => setJustClosed(false), 4000);
      prevCurtain.current = st.curtain;
      return () => clearTimeout(t);
    }
    prevCurtain.current = st.curtain;
    return undefined;
  }, [st.curtain]);

  const description = describe(view, st, cfg, justClosed);
  const announced = useSettled(description);
  const step = STEP * fieldRadius(exp, view.zoom);
  const goTo = (p: { x: number; y: number }) => move({ ...p, zoom: view.zoom });

  return (
    <div className="experiment">
      <p className="experiment__readout" role="status" aria-live="polite">
        <span className="visually-hidden">{announced}</span>
        <span aria-hidden="true">{description}</span>
      </p>

      <ul className="observations" aria-label="Observaciones del cielo">
        <li className={st.observed.includes("moon") ? "is-done" : ""}>{st.observed.includes("moon") ? "✓ Luna observada" : "Luna: acércala y céntrala"}</li>
        <li className={st.observed.includes("stars") ? "is-done" : ""}>{st.observed.includes("stars") ? "✓ Estrellas observadas" : "Grupo de estrellas: búscalo y céntralo"}</li>
      </ul>

      <div className="telescope-controls">
        <div className="telescope-pad" role="group" aria-label="Mover el telescopio">
          <button type="button" className="btn btn--round telescope-pad__up" disabled={disabled} onClick={() => move({ ...view, y: view.y - step })} aria-label="Mirar más arriba">
            ↑
          </button>
          <button type="button" className="btn btn--round telescope-pad__left" disabled={disabled} onClick={() => move({ ...view, x: view.x - step })} aria-label="Mirar a la izquierda">
            ←
          </button>
          <button type="button" className="btn btn--round telescope-pad__right" disabled={disabled} onClick={() => move({ ...view, x: view.x + step })} aria-label="Mirar a la derecha">
            →
          </button>
          <button type="button" className="btn btn--round telescope-pad__down" disabled={disabled} onClick={() => move({ ...view, y: view.y + step })} aria-label="Mirar más abajo">
            ↓
          </button>
        </div>
        <div className="telescope-zoom" role="group" aria-label="Aumento">
          <button type="button" className="btn btn--round" disabled={disabled || view.zoom <= 0} onClick={() => move({ ...view, zoom: view.zoom - 1 })} aria-label="Alejar la vista: aumento general">
            −
          </button>
          <span className="hint">{view.zoom >= 1 ? "Cercano" : "General"}</span>
          <button type="button" className="btn btn--round" disabled={disabled || view.zoom >= exp.zoomLevels.length - 1} onClick={() => move({ ...view, zoom: view.zoom + 1 })} aria-label="Acercar la vista: aumento cercano">
            +
          </button>
        </div>
      </div>

      <div className="row telescope-zones" role="group" aria-label="Ir a una zona del panorama">
        <button type="button" className="btn btn--small" disabled={disabled} onClick={() => goTo(TELESCOPE_ZONES.moon)}>
          Luna
        </button>
        <button type="button" className="btn btn--small" disabled={disabled} onClick={() => goTo(TELESCOPE_ZONES.stars)}>
          Estrellas
        </button>
        <button type="button" className="btn btn--small" disabled={disabled} onClick={() => goTo(TELESCOPE_ZONES.horizon)}>
          Horizonte
        </button>
        <button type="button" className="btn btn--small" disabled={disabled} onClick={() => move(startView(exp))}>
          Volver al cielo
        </button>
      </div>
      <p className="hint">También puedes arrastrar dentro del visor para mirar hacia otro lado.</p>
    </div>
  );
}
