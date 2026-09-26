import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AudienceDisplay from "./components/AudienceDisplay";
import DesignSystemShowcase from "./components/DesignSystemShowcase";
import { LanguageProvider } from "./i18n";
import { registerPwa } from "./pwa";
import "./styles.css";
import "./theme.css";

const designSystemPath = window.location.pathname.replace(/\/+$/, "") === "/design-system";
const audienceDisplayPath = window.location.pathname.replace(/\/+$/, "") === "/display";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>{audienceDisplayPath ? <AudienceDisplay /> : designSystemPath ? <DesignSystemShowcase /> : <App />}</LanguageProvider>
  </StrictMode>,
);

registerPwa();
