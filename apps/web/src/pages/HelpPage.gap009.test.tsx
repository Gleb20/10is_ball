import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelpPage } from "./HelpPage";
const mocks=vi.hoisted(()=>({faq:vi.fn(),feedback:vi.fn(),user:{id:"u1"}}));
vi.mock("../api",()=>({api:{faq:mocks.faq,feedback:mocks.feedback}}));
vi.mock("../auth",()=>({useAuth:()=>({user:mocks.user})}));
beforeEach(()=>{vi.clearAllMocks();mocks.faq.mockResolvedValue({articles:[{id:"a",category:"Подача",title:"Подающий",body:"Правила"}]});mocks.feedback.mockResolvedValue({});});
it("GAP-009 offers categories and material-link guidance, keeps error draft and allows retry",async()=>{
 mocks.feedback.mockRejectedValueOnce(new Error("Не удалось"));
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 expect(await screen.findByText("Подающий")).toBeVisible();
 fireEvent.change(screen.getByLabelText("Категория"),{target:{value:"idea"}});
 fireEvent.change(screen.getByLabelText("Сообщение"),{target:{value:"Идея https://example.com/demo"}});
 expect(screen.getByText(/материал.*ссылк/i)).toBeVisible();
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 expect(await screen.findByText("Не удалось")).toBeVisible();
 expect(screen.getByLabelText("Сообщение")).toHaveValue("Идея https://example.com/demo");
 fireEvent.submit(screen.getByRole("form",{name:"Обратная связь"}));
 await waitFor(()=>expect(mocks.feedback).toHaveBeenLastCalledWith("idea","Идея https://example.com/demo"));
 expect(await screen.findByText("Сообщение отправлено.")).toBeVisible();
});
it("GAP-009 FAQ error has explicit retry and request recovery",async()=>{
 mocks.faq.mockRejectedValueOnce(new Error("FAQ недоступен"));
 render(<MemoryRouter><HelpPage/></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:"Повторить загрузку справки"}));
 expect(await screen.findByText("Подающий")).toBeVisible();
});
