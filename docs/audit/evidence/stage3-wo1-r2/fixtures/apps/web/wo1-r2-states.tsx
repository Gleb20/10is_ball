import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Autocomplete, TextField } from "./src/ui";
import { BracketAlgorithmDialog } from "./src/components/BracketAlgorithmDialog";
import "ic-kit/styles.css";
import "./src/styles.css";

document.documentElement.dataset.brand = "ic";
document.documentElement.dataset.theme = "light";
const options = [
  { value: "u1", label: "Анна А" },
  { value: "u2", label: "Игрок Два Длинная фамилия" },
];
function App() {
  const [selected, setSelected] = useState("");
  const [algorithm, setAlgorithm] = useState<"compact" | "power_of_two">("compact");
  if (new URLSearchParams(location.search).has("dialog")) {
    return <div className="app-shell"><BracketAlgorithmDialog open format="single_elimination" selected={algorithm} onSelect={setAlgorithm} onCancel={() => {}} onConfirm={() => {}} /></div>;
  }
  return <div className="app-shell"><main className="app-main stack">
    <TextField label="Проверка ошибки" defaultValue="Копируемое значение" error helperText="Ошибка поля" fullWidth />
    <Autocomplete id="r2-selected" label="Выбор игрока" options={options} onChange={setSelected} fullWidth />
    <output data-probe="selected">{selected}</output>
  </main></div>;
}
createRoot(document.getElementById("root")!).render(<App />);
