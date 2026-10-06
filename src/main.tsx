import "@fontsource-variable/nunito";
import "@fontsource-variable/gelasio";
import "./styles/tokens.css";
import "./styles/game.css";
import "./styles/ui.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ProjectProvider } from "./app/ProjectProvider";

const root = document.getElementById("root");
if (!root) throw new Error("Falta el elemento #root");
createRoot(root).render(
  <StrictMode>
    <ProjectProvider>
      <App />
    </ProjectProvider>
  </StrictMode>,
);
