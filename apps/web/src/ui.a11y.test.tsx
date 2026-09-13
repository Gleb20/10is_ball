import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Dialog } from "./ui";
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
