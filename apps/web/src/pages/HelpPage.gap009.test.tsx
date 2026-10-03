import { beforeEach, expect, it, vi } from "vitest";
import { Activity } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HelpPage } from "./HelpPage";
const mocks=vi.hoisted(()=>({faq:vi.fn(),feedback:vi.fn(),user:{id:"u1"} as {id:string}|null}));
vi.mock("../api",()=>({api:{faq:mocks.faq,feedback:mocks.feedback}}));
vi.mock("../auth",()=>({useAuth:()=>({user:mocks.user})}));
beforeEach(()=>{vi.clearAllMocks();mocks.user={id:"u1"};mocks.faq.mockResolvedValue({articles:[{id:"a",category:"Подача",title:"Подающий",body:"Правила"}]});mocks.feedback.mockResolvedValue({});});
function deferred<T>() {
 let resolve!:(value:T)=>void;
 let reject!:(reason:Error)=>void;
 const promise=new Promise<T>((resolvePromise,rejectPromise)=>{resolve=resolvePromise;reject=rejectPromise;});
 return {promise,resolve,reject};
}
it("GAP-016 uses a bounded multiline field and preserves its payload and draft on a known error",async()=>{
 const knownError=Object.assign(new Error("Проверьте сообщение"),{status:400});
 mocks.feedback.mockRejectedValueOnce(knownError);
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 expect(await screen.findByText("Подающий")).toBeVisible();
 fireEvent.change(screen.getByLabelText("Категория"),{target:{value:"idea"}});
 const message="Идея\nhttps://example.com/demo";
 const field=screen.getByLabelText("Сообщение");
 expect(field.tagName).toBe("TEXTAREA");
 expect(field).toHaveAttribute("rows","5");
 expect(field).toHaveAttribute("maxlength","4000");
 expect(field).toHaveStyle({resize:"vertical",maxHeight:"40vh"});
 fireEvent.change(field,{target:{value:message}});
 expect(screen.getByText(/материал.*ссылк/i)).toBeVisible();
 expect(screen.getByText(`${message.length} из 4000 символов`)).toBeVisible();
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 expect(await screen.findByText("Проверьте сообщение")).toBeVisible();
 expect(screen.getByRole("alert")).toHaveFocus();
 expect(screen.getByLabelText("Сообщение")).toHaveValue(message);
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 await waitFor(()=>expect(mocks.feedback).toHaveBeenLastCalledWith("idea",message));
 expect(await screen.findByText("Сообщение отправлено.")).toBeVisible();
});

it.each([
 ["transport",new TypeError("connection lost")],
 ["5xx",Object.assign(new Error("service unavailable"),{status:503})],
])("GAP-016 treats a %s feedback result as unknown without replay",async(_label,failure)=>{
 mocks.feedback.mockRejectedValueOnce(failure);
 const user=userEvent.setup();
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 await screen.findByText("Подающий");
 await user.type(screen.getByLabelText("Сообщение"),"Подробности");
 await user.click(screen.getByRole("button",{name:"Отправить"}));
 expect(await screen.findByText(/обращение могло сохраниться/i)).toBeVisible();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("Подробности");
 expect(screen.getByRole("button",{name:"Отправить ещё раз"})).toBeVisible();
 expect(mocks.feedback).toHaveBeenCalledTimes(1);
});

it("GAP-016 ignores a late success across same-actor reauth while preserving the draft",async()=>{
 let resolveFeedback!:()=>void;
 mocks.feedback.mockReturnValue(new Promise<void>((resolve)=>{resolveFeedback=resolve;}));
 const view=render(<MemoryRouter><HelpPage/></MemoryRouter>);
 await screen.findByText("Подающий");
 fireEvent.change(screen.getByLabelText("Сообщение"),{target:{value:"Черновик"}});
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 mocks.user=null;view.rerender(<MemoryRouter><HelpPage/></MemoryRouter>);
 mocks.user={id:"u1"};view.rerender(<MemoryRouter><HelpPage/></MemoryRouter>);
 resolveFeedback();
 await Promise.resolve();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("Черновик");
 expect(screen.queryByText("Сообщение отправлено.")).not.toBeInTheDocument();
});

it("GAP-016 ignores actor A late failure after actor B remount",async()=>{
 let rejectFeedback!:(error:Error)=>void;
 mocks.feedback.mockReturnValue(new Promise<void>((_resolve,reject)=>{rejectFeedback=reject;}));
 const first=render(<MemoryRouter><HelpPage/></MemoryRouter>);
 await screen.findByText("Подающий");
 fireEvent.change(screen.getByLabelText("Сообщение"),{target:{value:"Черновик A"}});
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 first.unmount();
 mocks.user={id:"u2"};
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 rejectFeedback(Object.assign(new Error("late service error"),{status:503}));
 await Promise.resolve();
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("");
 expect(document.activeElement).not.toHaveAttribute("id","feedback-form-error");
});

it("GAP-016 keeps a new Activity feedback request pending when the interrupted request settles late",async()=>{
 const firstFeedback=deferred<void>();
 const secondFeedback=deferred<void>();
 mocks.feedback.mockReturnValueOnce(firstFeedback.promise).mockReturnValueOnce(secondFeedback.promise);
 const viewFor=(mode:"visible"|"hidden")=>(<MemoryRouter><Activity mode={mode}><HelpPage/></Activity></MemoryRouter>);
 const user=userEvent.setup();
 const view=render(viewFor("visible"));
 await screen.findByText("Подающий");
 await user.type(screen.getByLabelText("Сообщение"),"Черновик");
 await user.click(screen.getByRole("button",{name:"Отправить"}));
 expect(mocks.feedback).toHaveBeenCalledTimes(1);

 view.rerender(viewFor("hidden"));
 view.rerender(viewFor("visible"));
 expect(await screen.findByText(/обращение могло сохраниться/i)).toBeVisible();
 expect(screen.getByRole("alert")).toHaveFocus();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("Черновик");

 await user.click(screen.getByRole("button",{name:"Отправить ещё раз"}));
 await waitFor(()=>expect(mocks.feedback).toHaveBeenCalledTimes(2));
 expect(screen.getByRole("button",{name:"Отправка…"})).toBeDisabled();
 const focusBeforeLateResult=document.activeElement;
 await act(async()=>firstFeedback.resolve());

 expect(screen.getByRole("button",{name:"Отправка…"})).toBeDisabled();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("Черновик");
 expect(screen.queryByText("Сообщение отправлено.")).not.toBeInTheDocument();
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(document.activeElement).toBe(focusBeforeLateResult);

 await act(async()=>secondFeedback.resolve());
 expect(await screen.findByText("Сообщение отправлено.")).toBeVisible();
});

it("GAP-016 clears actor A Activity draft and uncertainty before actor B resumes",async()=>{
 const firstFeedback=deferred<void>();
 mocks.feedback.mockReturnValueOnce(firstFeedback.promise);
 const viewFor=(mode:"visible"|"hidden")=>(<MemoryRouter><Activity mode={mode}><HelpPage/></Activity></MemoryRouter>);
 const view=render(viewFor("visible"));
 await screen.findByText("Подающий");
 fireEvent.change(screen.getByLabelText("Сообщение"),{target:{value:"Черновик A"}});
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));

 view.rerender(viewFor("hidden"));
 mocks.user={id:"u2"};
 view.rerender(viewFor("hidden"));
 view.rerender(viewFor("visible"));

 expect(screen.getByLabelText("Сообщение")).toHaveValue("");
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Отправить"})).toBeEnabled();
 await act(async()=>firstFeedback.reject(Object.assign(new Error("late service error"),{status:503})));
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("");
});

it("GAP-016 rejects whitespace before the request and focuses the validation error",async()=>{
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 await screen.findByText("Подающий");
 fireEvent.change(screen.getByLabelText("Сообщение"),{target:{value:"   "}});
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 expect(await screen.findByText("Введите сообщение.")).toBeVisible();
 expect(screen.getByRole("alert")).toHaveFocus();
 expect(mocks.feedback).not.toHaveBeenCalled();
});

it("GAP-016 enforces the 4000 character limit before the request",async()=>{
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 await screen.findByText("Подающий");
 fireEvent.change(screen.getByLabelText("Сообщение"),{target:{value:"а".repeat(4001)}});
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 expect(await screen.findByText("Сообщение длиннее 4000 символов.")).toBeVisible();
 expect(mocks.feedback).not.toHaveBeenCalled();
});
it("GAP-009 FAQ error has explicit retry and request recovery",async()=>{
 mocks.faq.mockRejectedValueOnce(new Error("FAQ недоступен"));
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Повторить загрузку справки"}));
 expect(await screen.findByText("Подающий")).toBeVisible();
});
