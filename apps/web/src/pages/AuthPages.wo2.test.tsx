import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { LoginPage } from "./LoginPage";

const calls = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  firstPasswordChange: vi.fn(),
}));

vi.mock("../api", () => ({ api: calls }));

const restrictedUser = {
  id: "wo2-user",
  email: "wo2@example.invalid",
  role: "user",
  mustChangePassword: true,
  firstName: "Тест",
  lastName: "Пользователь",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function renderFirstPassword() {
  return render(
    <MemoryRouter initialEntries={["/first-password"]}>
      <App />
    </MemoryRouter>,
  );
}

async function passwordFields() {
  return {
    password: await screen.findByLabelText("Новый пароль") as HTMLInputElement,
    confirm: screen.getByLabelText("Повторите пароль") as HTMLInputElement,
  };
}

describe("WO2 auth forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.me.mockResolvedValue({ user: restrictedUser });
  });

  it("ends only the current first-password session before replacing login", async () => {
    let sessionValid = true;
    calls.logout.mockImplementation(async () => { sessionValid = false; return { ok: true }; });
    renderFirstPassword();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Выйти" }));
    await waitFor(() => expect(calls.logout).toHaveBeenCalledTimes(1));
    expect(sessionValid).toBe(false);
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeVisible();
  });

  it("treats a 401 logout response as an ended current session", async () => {
    calls.logout.mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 401 }));
    renderFirstPassword();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Выйти" }));
    expect(await screen.findByRole("heading", { name: "Вход" })).toBeVisible();
    expect(calls.logout).toHaveBeenCalledTimes(1);
  });

  it("shares one flight across save and logout, then preserves values on known logout failure", async () => {
    const held = deferred<{ ok: boolean }>();
    calls.logout.mockReturnValueOnce(held.promise).mockResolvedValue({ ok: true });
    renderFirstPassword();
    const user = userEvent.setup();
    const { password, confirm } = await passwordFields();
    await user.type(password, "ValidPass1!");
    await user.type(confirm, "ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Выйти" }));
    fireEvent.click(screen.getByRole("button", { name: "Выход…" }));
    fireEvent.submit(screen.getByRole("form", { name: "Форма смены пароля" }));
    expect(calls.logout).toHaveBeenCalledTimes(1);
    expect(calls.firstPasswordChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    held.reject(Object.assign(new Error("service unavailable"), { status: 503 }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(password).toHaveValue("ValidPass1!");
    expect(confirm).toHaveValue("ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Выйти" }));
    await waitFor(() => expect(calls.logout).toHaveBeenCalledTimes(2));
  });

  it("does not start logout while the first-password save is held", async () => {
    const held = deferred<{ ok: boolean }>();
    calls.firstPasswordChange.mockReturnValue(held.promise);
    renderFirstPassword();
    const user = userEvent.setup();
    const { password, confirm } = await passwordFields();
    await user.type(password, "ValidPass1!");
    await user.type(confirm, "ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
    fireEvent.submit(screen.getByRole("form", { name: "Форма смены пароля" }));
    expect(calls.firstPasswordChange).toHaveBeenCalledTimes(1);
    expect(calls.logout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeDisabled();
    held.reject(Object.assign(new Error("service unavailable"), { status: 503 }));
    expect(await screen.findByRole("alert")).toHaveFocus();
    expect(password).toHaveValue("ValidPass1!");
  });

  it("links mismatch to both fields, focuses the alert once, and clears stale error on edit", async () => {
    renderFirstPassword();
    const user = userEvent.setup();
    const { password, confirm } = await passwordFields();
    await user.type(password, "ValidPass1!");
    await user.type(confirm, "OtherPass1!");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(password.getAttribute("aria-describedby")).toContain(alert.id);
    expect(confirm.getAttribute("aria-describedby")).toContain(alert.id);
    await user.type(confirm, "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(confirm).toHaveFocus();
  });

  it("translates known policy reasons without displaying internal codes", async () => {
    calls.firstPasswordChange.mockRejectedValueOnce(Object.assign(new Error("policy"), {
      code: "PASSWORD_POLICY",
      status: 400,
      details: { errors: ["TOO_SHORT", "MISSING_UPPERCASE", "MISSING_SPECIAL", "FUTURE_CODE"] },
    }));
    renderFirstPassword();
    const user = userEvent.setup();
    const { password, confirm } = await passwordFields();
    await user.type(password, "short1");
    await user.type(confirm, "short1");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("Не менее 10 символов");
    expect(alert).toHaveTextContent("Добавьте заглавную латинскую букву");
    expect(alert).not.toHaveTextContent(/TOO_SHORT|FUTURE_CODE/);
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password.getAttribute("aria-describedby")).toContain(alert.id);
    expect(confirm).not.toHaveAttribute("aria-invalid", "true");
  });

  it("reveals each password in its own field without submitting or replacing the input", async () => {
    renderFirstPassword();
    const user = userEvent.setup();
    const { password, confirm } = await passwordFields();
    await user.type(password, "ValidPass1!");
    await user.type(confirm, "ValidPass1!");
    const toggle = screen.getByRole("button", { name: "Показать новый пароль" });
    expect(password.type).toBe("password");
    await user.click(toggle);
    expect(password.type).toBe("text");
    expect(confirm.type).toBe("password");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Скрыть новый пароль" }));
    expect(password.type).toBe("password");
    expect(screen.getByLabelText("Новый пароль")).toBe(password);
    const confirmToggle = screen.getByRole("button", { name: "Показать повторный пароль" });
    await user.click(confirmToggle);
    expect(confirm.type).toBe("text");
    expect(password.type).toBe("password");
    expect(calls.firstPasswordChange).not.toHaveBeenCalled();
  });

  it("keeps wrong-credential errors generic and focuses a named alert", async () => {
    calls.login.mockRejectedValueOnce(Object.assign(new Error("raw server text"), {
      code: "INVALID_CREDENTIALS", status: 401,
    }));
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Email" }), "wo2@example.invalid");
    await user.type(screen.getByLabelText("Пароль"), "WrongPass1!");
    await user.click(screen.getByRole("button", { name: "Войти" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent("Неверный email или пароль");
    expect(alert).not.toHaveTextContent("raw server text");
  });

  it("keeps login single-flight while its response is held", async () => {
    const held = deferred<{ user: typeof restrictedUser }>();
    calls.login.mockReturnValue(held.promise);
    render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "wo2@example.invalid");
    await user.type(screen.getByLabelText("Пароль"), "AnyPass1!");
    const form = screen.getByRole("form", { name: "Форма входа" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(calls.login).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Вход…" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    held.reject(Object.assign(new Error("invalid"), { code: "INVALID_CREDENTIALS", status: 401 }));
    expect(await screen.findByRole("alert")).toHaveFocus();
  });
});
