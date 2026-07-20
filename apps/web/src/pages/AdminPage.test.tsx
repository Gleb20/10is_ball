import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  beforeEach(() => {
    listUsers.mockResolvedValue({
      users: [
        {
          id: "u2",
          email: "player@tab10.local",
          firstName: "P",
          lastName: "Layer",
          role: "user",
          status: "active",
          mustChangePassword: false,
        },
      ],
    });
    blockUser.mockResolvedValue({ ok: true });
    resetPassword.mockResolvedValue({ temporaryPassword: "ResetPass1!" });
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

    await user.click(screen.getByRole("button", { name: /^блок$/i }));
    expect(
      await screen.findByText(/заблокировать пользователя/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(blockUser).toHaveBeenCalledWith("u2");

    await user.click(screen.getByRole("button", { name: /^сброс$/i }));
    expect(await screen.findByText(/сбросить пароль/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /подтвердить/i }));
    expect(resetPassword).toHaveBeenCalledWith("u2");
    expect(
      await screen.findByText("ResetPass1!", { selector: "code" }),
    ).toBeInTheDocument();
  });
});
