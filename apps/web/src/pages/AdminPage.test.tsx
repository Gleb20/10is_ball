import { render, screen, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
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
const unblockUser = vi.fn();
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
    unblockUser: (...a: unknown[]) => unblockUser(...a),
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
    unblockUser.mockReset();
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
        {
          id: "u4",
          email: "blocked@tab10.local",
          firstName: "Blocked",
          lastName: "Player",
          role: "user",
          status: "blocked",
          mustChangePassword: false,
        },
      ],
    });
    blockUser.mockResolvedValue({ ok: true });
    unblockUser.mockResolvedValue({ ok: true });
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

    const playerRow = screen
      .getByText("player@tab10.local · user")
      .closest(".list-row") as HTMLElement;
    await user.click(
      within(playerRow).getByRole("button", { name: /^блок$/i }),
    );
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

  it("BUG-009: keeps create-user submit single-flight while the request is pending", async () => {
    let resolveCreate!: (value: {
      user: { id: string; role: "user" };
      temporaryPassword: string;
    }) => void;
    createUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    const form = (await screen.findByLabelText(
      "Создание пользователя",
    )) as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(createUser).toHaveBeenCalledTimes(1);
    const submit = within(form).getByRole("button", { name: /создание/i });
    expect(submit).toBeDisabled();

    resolveCreate({
      user: { id: "u4", role: "user" },
      temporaryPassword: "CreatePass1!",
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
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

    const playerRow = screen
      .getByText("player@tab10.local · user")
      .closest(".list-row") as HTMLElement;
    expect(
      within(playerRow).getByRole("button", { name: /^сделать админом$/i }),
    ).toBeInTheDocument();

    const selfEmail = screen.getByText("admin@tab10.local · admin · вы");
    const selfRow = selfEmail.closest(".list-row");
    expect(selfRow).toBeTruthy();
    expect(
      within(selfRow as HTMLElement).queryByRole("button", {
        name: /сделать админом|снять админа/i,
      }),
    ).toBeNull();

    await user.click(
      within(playerRow).getByRole("button", { name: /^сделать админом$/i }),
    );
    expect(
      await screen.findByText(/сделать администратором/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/сессии пользователя будут сброшены/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /отмена/i }));
    expect(updateUserRole).not.toHaveBeenCalled();

    const promoteBtn = within(playerRow).getByRole("button", {
      name: /^сделать админом$/i,
    });
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

  it("BUG-011: offers unblock only for blocked targets and hides self-block", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/blocked@tab10.local/i)).toBeInTheDocument();

    const selfRow = screen
      .getByText("admin@tab10.local · admin · вы")
      .closest(".list-row") as HTMLElement;
    expect(
      within(selfRow).queryByRole("button", { name: /^блок$/i }),
    ).toBeNull();

    const blockedRow = screen
      .getByText("blocked@tab10.local · user")
      .closest(".list-row") as HTMLElement;
    expect(
      within(blockedRow).queryByRole("button", { name: /^блок$/i }),
    ).toBeNull();
    await user.click(
      within(blockedRow).getByRole("button", { name: /^разблокировать$/i }),
    );
    expect(
      await screen.findByText(/разблокировать пользователя/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(unblockUser).toHaveBeenCalledWith("u4");
    expect(blockUser).not.toHaveBeenCalled();
  });

  it("BUG-011: keeps unblock single-flight and preserves context on failure", async () => {
    let rejectUnblock!: (error: Error) => void;
    unblockUser.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUnblock = reject;
        }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AdminPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    const blockedRow = (await screen.findByText("blocked@tab10.local · user"))
      .closest(".list-row") as HTMLElement;
    await user.click(
      within(blockedRow).getByRole("button", { name: /^разблокировать$/i }),
    );
    const confirmButton = screen.getByRole("button", {
      name: /^подтвердить$/i,
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    expect(unblockUser).toHaveBeenCalledTimes(1);

    rejectUnblock(new Error("Разблокировка не выполнена"));
    expect(
      await screen.findByText("Разблокировка не выполнена"),
    ).toBeInTheDocument();
    expect(screen.getByText("blocked@tab10.local · user")).toBeInTheDocument();
    expect(
      screen.getByText(/разблокировать пользователя/i),
    ).toBeInTheDocument();
  });
});
