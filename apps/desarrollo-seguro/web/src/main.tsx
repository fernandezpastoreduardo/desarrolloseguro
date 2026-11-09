import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PublicScanPortal } from "./index.js";

const ROOT_ELEMENT_ID = "root";
const rootElement = document.getElementById(ROOT_ELEMENT_ID);

if (!rootElement) throw new Error("web_root_element_missing");

createRoot(rootElement).render(
  <StrictMode>
    <PublicScanPortal />
  </StrictMode>,
);
