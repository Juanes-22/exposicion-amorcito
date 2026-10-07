import { HomeView } from "../components/room/HomeView";
import { RoomView } from "../components/room/RoomView";
import { lazy, Suspense } from "react";
import { ProjectFailure, useProjectState } from "./ProjectProvider";
import { useRoute } from "./useRoute";

// La demostración (con el mapa y Phaser) se descarga solo si se visita: entrada y espera no la necesitan. La consola de Vanessa la
// precarga mientras la sala funciona (`prepareBackup`) para que el respaldo no dependa de un servidor que ya no responda.
const DemoView = lazy(() => import("../components/room/DemoView").then((m) => ({ default: m.DemoView })));

export function App() {
  const [route, navigate] = useRoute();
  const state = useProjectState();

  if (state.status === "loading") return <p role="status" style={{ padding: 16 }}>Cargando…</p>;
  if (state.status === "failed") return <ProjectFailure failure={state.failure} />;

  switch (route.name) {
    case "demo":
      return (
        <Suspense fallback={<p role="status" style={{ padding: 16 }}>Cargando el mapa…</p>}>
          <DemoView project={state.project} navigate={navigate} />
        </Suspense>
      );
    case "home":
      return <HomeView project={state.project} navigate={navigate} />;
    case "room":
      return <RoomView key={route.code} project={state.project} code={route.code} navigate={navigate} />;
    default:
      return <p style={{ padding: 24 }}>No encontramos esta página.</p>;
  }
}
