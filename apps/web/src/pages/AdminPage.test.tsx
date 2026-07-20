import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { AdminPage } from "./AdminPage";
import { AuthProvider } from "../auth";
import { TempPasswordPanel } from "../authUi";

const listUsers = vi.fn();
const createUser = vi.fn();
const blockUser = vi.fn();
const resetPassword = vi.fn();
const updateUserRole = vi.fn();
const copyText = vi.fn().mockResolvedValue(true);

vi.mock("../copyText", () => ({
  copyText: (...a: unknown[]) => copyText(...a),
}));

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "admin1",
        email: "admin@tab10.local",
        role: "admin",
        mustChangePassword: false,
        firstName: "Admin",
        lastName: "User",
      },
    }),
    login: vi.fn(),
    listUsers: (...a: unknown[]) => listUsers(...a),
    createUser: (...a: unknown[]) => createUser(...a),
    blockUser: (...a: unknown[]) => blockUser(...a),
    resetPassword: (...a: unknown[]) => resetPassword(...a),
    updateUserRole: (...a: unknown[]) => updateUserRole(...a),
  },
}));

describe("REQ_ui__auth_layout", () => {
  it("shows brand and login form in AuthLayout", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("auth-layout")).toBeInTheDocument();
    expect(screen.getByLabelText("Tab-10")).toHaveTextContent("Tab-10");
    expect(screen.getByLabelText(/форма входа/i)).toBeInTheDocument();
  });
});

describe("REQ_ui__temp_password_copy", () => {
  beforeEach(() => {
    copyText.mockClear();
    copyText.mockResolvedValue(true);
  });

  it("copies temporary password on CTA", async () => {
    const user = userEvent.setup();
    render(<TempPasswordPanel password="TempPass1!" />);
    expect(screen.getByTestId("temp-password-value")).toHaveTextContent(
      "TempPass1!",
    );
    await user.click(screen.getByRole("button", { name: /скопировать/i }));
    expect(copyText).toHaveBeenCalledWith("TempPass1!");
    expect(
      await screen.findByRole("button", { name: /скопировано/i }),
    ).toBeInTheDocument();
  });
});

describe("REQ_ui__admin_confirm_dialogs", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    listUsers.mockReset();
    blockUser.mockReset();
    resetPassword.mockReset();
    updateUserRole.mockReset();
    createUser.mockReset();
    listUsers.mockResolvedValue({
      users: [
        {
          id: "admin1",
          email: "admin@tab10.local",
          firstName: "Admin",
          lastName: "User",
          role: "admin",
          status: "active",
          mustChangePassword: false,
        },
        {
          id: "u2",
          email: "player@tab10.local",
          firstName: "P",
          lastName: "Layer",
          role: "user",
          status: "active",
          mustChangePassword: false,
        },
        {
          id: "u3",
          email: "other-admin@tab10.local",
          firstName: "Other",
          lastName: "Admin",
          role: "admin",
          status: "active",
          mustChangePassword: false,
        },
      ],
    });
    blockUser.mockResolvedValue({ ok: true });
    resetPassword.mockResolvedValue({ temporaryPassword: "ResetPass1!" });
    updateUserRole.mockResolvedValue({
      user: { id: "u2", role: "admin" },
    });
    createUser.mockResolvedValue({
      user: { id: "u4", role: "admin" },
      temporaryPassword: "CreatePass1!",
    });
  });

  it("asks confirm before block and shows temp password dialog on reset", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/player@tab10.local/i)).toBeInTheDocument();

    const blockButtons = screen.getAllByRole("button", { name: /^блок$/i });
    await user.click(blockButtons[1]!);
    expect(
      await screen.findByText(/заблокировать пользователя/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(blockUser).toHaveBeenCalledWith("u2");

    const resetButtons = screen.getAllByRole("button", { name: /^сброс$/i });
    await user.click(resetButtons[1]!);
    expect(await screen.findByText(/сбросить пароль/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(resetPassword).toHaveBeenCalledWith("u2");
    expect(
      await screen.findByText("ResetPass1!", { selector: "code" }),
    ).toBeInTheDocument();
  });

  it("creates user with selected admin role", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/player@tab10.local/i)).toBeInTheDocument();

    const createForm = document.querySelector(
      'form[aria-label="Создание пользователя"]',
    ) as HTMLElement;
    const inputs = createForm.querySelectorAll("input");
    fireEvent.change(inputs[0]!, { target: { value: "new@tab10.local" } });
    fireEvent.change(inputs[1]!, { target: { value: "New" } });
    fireEvent.change(inputs[2]!, { target: { value: "Admin" } });
    await user.selectOptions(within(createForm).getByLabelText(/^роль$/i), "admin");
    await user.click(within(createForm).getByRole("button", { name: /^создать$/i }));
    expect(createUser).toHaveBeenCalledWith({
      email: "new@tab10.local",
      firstName: "New",
      lastName: "Admin",
      role: "admin",
    });
  });

  it("confirms promote/demote and hides role buttons for self", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/player@tab10.local/i)).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /^сделать админом$/i }),
    ).toBeInTheDocument();

    const selfEmail = screen.getByText("admin@tab10.local · admin · вы");
    const selfRow = selfEmail.closest(".list-row");
    expect(selfRow).toBeTruthy();
    expect(
      within(selfRow as HTMLElement).queryByRole("button", {
        name: /сделать админом|снять админа/i,
      }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: /^сделать админом$/i }));
    expect(
      await screen.findByText(/сделать администратором/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/сессии пользователя будут сброшены/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /отмена/i }));
    expect(updateUserRole).not.toHaveBeenCalled();

    const promoteBtn = screen.getAllByRole("button", {
      name: /^сделать админом$/i,
    })[0]!;
    await user.click(promoteBtn);
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(updateUserRole).toHaveBeenCalledWith("u2", "admin");

    const demoteBtn = screen.getAllByRole("button", {
      name: /^снять админа$/i,
    })[0]!;
    await user.click(demoteBtn);
    expect(
      await screen.findByText(/снять права администратора/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(updateUserRole).toHaveBeenCalledWith("u3", "user");
  });
});
