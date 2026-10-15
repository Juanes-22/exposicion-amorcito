import { HomeView } from "../components/room/HomeView";
import { RoomView } from "../components/room/RoomView";
import { ProjectFailure, useProjectState } from "./ProjectProvider";
import { useRoute } from "./useRoute";

export function App() {
  const [route, navigate] = useRoute();
  const state = useProjectState();

  if (state.status === "loading") return <p role="status" style={{ padding: 16 }}>Cargando…</p>;
  if (state.status === "failed") return <ProjectFailure failure={state.failure} />;

  switch (route.name) {
    case "home":
      return <HomeView project={state.project} navigate={navigate} />;
    case "room":
      return <RoomView key={route.code} project={state.project} code={route.code} navigate={navigate} />;
    default:
      return <p style={{ padding: 24 }}>No encontramos esta página.</p>;
  }
}
