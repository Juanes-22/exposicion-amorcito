import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadProject, type LoadFailure, type LoadedProject, type ProjectLoad } from "../config/loadProject";

type State = { status: "loading" } | { status: "ready"; project: LoadedProject } | { status: "failed"; failure: LoadFailure };

const ProjectContext = createContext<State>({ status: "loading" });

// StrictMode monta dos veces en desarrollo: se comparte la misma carga en vuelo en lugar de descargar y validar dos veces.
let inflight: Promise<ProjectLoad> | null = null;
export const resetProjectCache = () => {
  inflight = null;
};

/** Carga y valida el paquete (configuración + catálogo + TMJ) una vez, antes de inicializar Phaser (SPECS 9.5). */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void (inflight ??= loadProject()).then((r) => {
      if (!cancelled) setState(r.ok ? { status: "ready", project: r.project } : { status: "failed", failure: r.failure });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return <ProjectContext.Provider value={state}>{children}</ProjectContext.Provider>;
}

export const useProjectState = (): State => useContext(ProjectContext);

export function ProjectFailure({ failure }: { failure: LoadFailure }) {
  return (
    <div role="alert" style={{ padding: 16 }}>
      <h1>No se pudo cargar el laboratorio</h1>
      {failure.stage === "validation" ? (
        <>
          <p>El paquete de contenido, catálogo y mapa tiene problemas:</p>
          <ul>
            {failure.issues.map((i, n) => (
              <li key={n}>
                <code>[{i.file}] {i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          {failure.stage === "network" ? "No se pudo descargar" : "No se pudo leer"} <code>{failure.url}</code>: {failure.message}
        </p>
      )}
    </div>
  );
}
