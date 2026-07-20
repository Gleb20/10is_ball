import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "ic-kit/styles.css";
import { App } from "./App";
import "./styles.css";

document.documentElement.dataset.brand = "ic";
document.documentElement.dataset.theme = "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
