import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Autocomplete, Dialog } from "./src/ui";
import "ic-kit/styles.css";
import "./src/styles.css";

document.documentElement.dataset.brand = "ic";
document.documentElement.dataset.theme = "light";
const options = Array.from({ length: 30 }, (_, index) => ({ value: `u${index + 1}`, label: `Игрок ${String(index + 1).padStart(2, "0")} Длинная фамилия` }));
function App() {
  const [selected, setSelected] = useState("");
  const picker = <Autocomplete id="r2-full-picker" label="Игрок" options={options} onChange={setSelected} fullWidth />;
  return <div className="app-shell" style={{ maxWidth: "none" }}>
    {new URLSearchParams(location.search).has("dialog") ? <Dialog open title="Выбор участника" width="md">
      <div style={{ height: 440 }}>Список участников</div>
      {picker}<div style={{ height: 1200 }} />
    </Dialog> : <main className="app-main" style={{ paddingTop: 700 }}>
      {picker}<div style={{ height: 1500 }} />
    </main>}
    <output data-probe="selected" hidden>{selected}</output>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
