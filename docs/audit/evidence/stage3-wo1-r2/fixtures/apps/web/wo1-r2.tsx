import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Autocomplete, Dialog } from "./src/ui";
import "ic-kit/styles.css";
import "./src/styles.css";

document.documentElement.dataset.brand = "ic";
document.documentElement.dataset.theme = "light";
const options = Array.from({ length: 30 }, (_, index) => ({
  value: `u${index + 1}`,
  label: `Игрок ${String(index + 1).padStart(2, "0")} Длинная фамилия`,
}));
function App() {
  const [selected, setSelected] = useState("");
  const content = <>
      <div data-probe="outer" style={{ width: "min(340px, 100%)", height: 220, overflowY: "auto", marginTop: 180, border: "2px solid #777" }}>
        <div data-probe="clip" style={{ height: 120, overflow: "hidden", marginTop: 20, paddingTop: 10 }}>
          <Autocomplete id="r2-combobox" label="Игрок" options={options} onChange={setSelected} fullWidth />
        </div>
        <div style={{ height: 300 }}>Продолжение формы</div>
      </div>
      <output data-probe="selected" hidden>{selected}</output>
    </>;
  return <div className="app-shell" style={{ maxWidth: "none" }}>
    {new URLSearchParams(location.search).has("dialog") ? <Dialog open title="Тесная область" width="md">{content}</Dialog> : <main className="app-main">{content}</main>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
