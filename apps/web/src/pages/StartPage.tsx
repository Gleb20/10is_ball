import { Navigate } from "react-router-dom";

/** Keep incoming /start links without an extra creation screen. */
export function StartPage() {
  return <Navigate to="/#home-actions" replace />;
}
