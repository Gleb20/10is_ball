import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "ic-kit/styles.css";
import { App } from "./App";
import { JudgeNavigationBridge } from "./judgeNavigation";
import "./styles.css";

document.documentElement.dataset.brand = "ic";
document.documentElement.dataset.theme = "light";

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <JudgeNavigationBridge>
        <App />
      </JudgeNavigationBridge>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
