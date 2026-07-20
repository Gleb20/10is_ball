import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { AuthProvider } from "../auth";

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockRejectedValue(new Error("no session")),
    login: vi.fn(),
  },
}));

describe("LoginPage states", () => {
  it("renders login form", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/форма входа/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /войти/i })).toBeInTheDocument();
  });
});
