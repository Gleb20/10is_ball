import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Autocomplete, Dialog } from "./ui";

it("BUG-018 gives the keyboard-active option a real ID owned by its listbox", async () => {
  const user = userEvent.setup();
  render(<><Autocomplete label="Игрок A" options={[{ value: "a", label: "Анна Первая" }]} />
    <Autocomplete label="Соперник" options={[{ value: "b", label: "Борис Второй" }]} /></>);
  const first = screen.getByRole("combobox", { name: "Игрок A" });
  await user.click(first);
  await user.keyboard("{ArrowDown}");
  const activeId = first.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  const option = document.getElementById(activeId!);
  expect(option).toBe(screen.getByRole("option", { name: "Анна Первая" }));
  expect(screen.getByRole("listbox").contains(option)).toBe(true);
  expect(screen.getByRole("combobox", { name: "Соперник" })).not.toHaveAttribute("aria-activedescendant");
});
it("BUG-018 does not select a hidden active option after Escape", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Autocomplete label="Игрок" options={[{ value: "a", label: "Анна" }]} onChange={onChange} />);
  const input = screen.getByRole("combobox", { name: "Игрок" });
  await user.click(input);
  await user.keyboard("{ArrowDown}{Escape}{Enter}");
  expect(onChange).not.toHaveBeenCalled();
  expect(input).not.toHaveAttribute("aria-activedescendant");
});

it("BUG-018 closes an open option list when its picker becomes disabled", async () => {
  function Example() {
    const [disabled, setDisabled] = useState(false);
    return <><Autocomplete label="Игрок" options={[{ value: "a", label: "Анна" }]} disabled={disabled} />
      <button onClick={() => setDisabled(true)}>Отключить</button></>;
  }
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("combobox", { name: "Игрок" }));
  expect(screen.getByRole("option", { name: "Анна" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
  expect(screen.queryByRole("option", { name: "Анна" })).not.toBeInTheDocument();
});
it("BUG-018 closes the first popup on Tab without changing its value", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<><Autocomplete label="Первый" options={[{ value: "a", label: "Анна" }]} onChange={onChange} />
    <Autocomplete label="Второй" options={[{ value: "b", label: "Борис" }]} /></>);
  const first = screen.getByRole("combobox", { name: "Первый" });
  await user.click(first);
  expect(first).toHaveAttribute("aria-expanded", "true");
  await user.tab();
  expect(first).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("option", { name: "Анна" })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("BUG-023 keeps duplicate labels as distinct IDs and announces a genuine zero match", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Autocomplete label="Игрок" options={[{ value: "a", label: "Анна Первая" }, { value: "b", label: "Анна Первая" }]} onChange={onChange} />);
  const input = screen.getByRole("combobox", { name: "Игрок" });
  await user.type(input, "ПЕРВАЯ АнНа");
  const options = screen.getAllByRole("option", { name: "Анна Первая" });
  expect(options).toHaveLength(2);
  expect(onChange).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "Анна Несовпадение");
  expect(screen.getByRole("status")).toHaveTextContent("Ничего не найдено");
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
  expect(document.getElementById(input.getAttribute("aria-controls")!)).toBe(screen.getByRole("listbox"));
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(input).not.toHaveAttribute("aria-activedescendant");
  expect(input).toHaveFocus();
});
it("GAP-011 Dialog keeps focus while its parent rerenders and traps the current controls", async () => {
 function Example() {
  const [value,setValue]=useState('');const [open,setOpen]=useState(false);
  return <><button onClick={()=>setOpen(true)}>Открыть</button><Dialog open={open} onClose={()=>setOpen(false)} title="Параметры"><input aria-label="Название" value={value} onChange={e=>setValue(e.target.value)}/>{value && <button>Дополнительно</button>}</Dialog></>;
 }
 const user=userEvent.setup();render(<Example/>);const opener=screen.getByRole('button',{name:'Открыть'});await user.click(opener);
 const input=screen.getByRole('textbox',{name:'Название'});await user.click(input);await user.type(input,'А');expect(input).toHaveFocus();
 await user.tab();expect(screen.getByRole('button',{name:'Дополнительно'})).toHaveFocus();await user.tab();expect(screen.getByRole('button',{name:'Закрыть'})).toHaveFocus();
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(opener).toHaveFocus();
});

it("GAP-011 excludes controls beneath a CSS-hidden ancestor from the focus loop", async () => {
  const user = userEvent.setup();
  render(<Dialog open onClose={() => undefined} title="Параметры">
    <button>Доступная</button>
    <div style={{ display: "none" }}><button>Скрытая</button></div>
  </Dialog>);
  screen.getByRole("button", { name: "Закрыть" }).focus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Доступная" })).toHaveFocus();
});

it.each(["disabled", "removed"])("GAP-011 recovers focus when the active control becomes %s", async (mode) => {
  function Example() {
    const [busy, setBusy] = useState(false);
    return <Dialog open onClose={() => undefined} title="Параметры">
      {!(busy && mode === "removed") && <button disabled={busy} onClick={() => setBusy(true)}>Отправить</button>}
    </Dialog>;
  }
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Отправить" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Закрыть" })).toHaveFocus());
  await user.tab();
  expect(screen.getByRole("button", { name: "Закрыть" })).toHaveFocus();
});

it("GAP-011 updates the loop when an ancestor becomes hidden while open", async () => {
  function Content({ hidden }: { hidden: boolean }) {
    return <Dialog open onClose={() => undefined} title="Параметры">
      <button>Доступная</button>
      <div style={{ display: hidden ? "none" : "block" }}><button>Меняется</button></div>
    </Dialog>;
  }
  const user = userEvent.setup();
  const view = render(<Content hidden={false} />);
  screen.getByRole("button", { name: "Меняется" }).focus();
  view.rerender(<Content hidden />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Закрыть" })).toHaveFocus());
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Доступная" })).toHaveFocus();
});
