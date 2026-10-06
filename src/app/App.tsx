import { HomeView } from "../components/room/HomeView";
import { RoomView } from "../components/room/RoomView";
import { lazy, Suspense } from "react";
import { ProjectFailure, useProjectState } from "./ProjectProvider";
import { useRoute } from "./useRoute";

// La vista con el mapa (y Phaser) se descarga solo si se visita: entrada y espera no la necesitan.
const MapPreview = lazy(() => import("./MapPreview").then((m) => ({ default: m.MapPreview })));

export function App() {
  const [route, navigate] = useRoute();
  const state = useProjectState();

  if (state.status === "loading") return <p role="status" style={{ padding: 16 }}>Cargando…</p>;
  if (state.status === "failed") return <ProjectFailure failure={state.failure} />;

  switch (route.name) {
    case "demo":
      return (
        <Suspense fallback={<p role="status" style={{ padding: 16 }}>Cargando el mapa…</p>}>
          <MapPreview project={state.project} />
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
