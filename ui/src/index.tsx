import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "@nimblebrain/synapse/react";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider name="todo-board" version="0.1.0">
      <App />
    </AppProvider>
  </StrictMode>,
);
