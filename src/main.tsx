import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { RecoveryProvider } from "./state/RecoveryContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RecoveryProvider>
      <App />
    </RecoveryProvider>
  </StrictMode>,
);
