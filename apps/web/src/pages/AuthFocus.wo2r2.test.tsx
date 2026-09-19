import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";

const calls = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  firstPasswordChange: vi.fn(),
}));
vi.mock("../api", () => ({ api: calls }));

describe("WO2 R2 repeated auth error focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.me.mockResolvedValue({ user: {
      id: "wo2-r2-user", email: "wo2-r2@example.invalid", role: "user",
      mustChangePassword: true, firstName: "Тест", lastName: "Фокуса",
    } });
  });

  it("refocuses the one Alert for each explicit unchanged mismatch submit, then leaves editing focus alone", async () => {
    render(<MemoryRouter initialEntries={["/first-password"]}><App /></MemoryRouter>);
    const user = userEvent.setup();
    const password = await screen.findByLabelText("Новый пароль") as HTMLInputElement;
    const confirm = screen.getByLabelText("Повторите пароль") as HTMLInputElement;
    await user.type(password, "ValidPass1!");
    await user.type(confirm, "OtherPass1!");
    const save = screen.getByRole("button", { name: "Сохранить" });

    await user.click(save);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("Пароли не совпадают");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    await user.click(save);
    expect(alert).toHaveFocus();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByLabelText("Новый пароль")).toBe(password);
    expect(screen.getByLabelText("Повторите пароль")).toBe(confirm);
    expect(password).toHaveValue("ValidPass1!");
    expect(confirm).toHaveValue("OtherPass1!");
    expect(password.getAttribute("aria-describedby")).toContain(alert.id);
    expect(confirm.getAttribute("aria-describedby")).toContain(alert.id);

    await user.type(confirm, "x");
    expect(confirm).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Показать повторный пароль" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    expect(calls.firstPasswordChange).not.toHaveBeenCalled();
  });

  it("refocuses a repeated generic login refusal without stealing focus during correction", async () => {
    calls.me.mockRejectedValueOnce(Object.assign(new Error("unauthorized"), { status: 401 }));
    calls.login.mockRejectedValue(Object.assign(new Error("internal detail"), {
      code: "INVALID_CREDENTIALS", status: 401,
    }));
    render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);
    const user = userEvent.setup();
    const email = await screen.findByLabelText("Email") as HTMLInputElement;
    const password = screen.getByLabelText("Пароль") as HTMLInputElement;
    await user.type(email, "wo2-r2@example.invalid");
    await user.type(password, "WrongPass1!");
    const submit = screen.getByRole("button", { name: "Войти" });
    await user.click(submit);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("Неверный email или пароль");
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveFocus();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(calls.login).toHaveBeenCalledTimes(2);
    await user.type(password, "x");
    expect(password).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
