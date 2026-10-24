import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { RecoveryProvider } from "./state/RecoveryContext";
import { AuthGate } from "./auth/AuthGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <RecoveryProvider>
        <App />
      </RecoveryProvider>
    </AuthGate>
  </StrictMode>,
);
