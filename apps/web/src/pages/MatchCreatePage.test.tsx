import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MatchCreatePage } from "./MatchCreatePage";
import { AuthProvider } from "../auth";

const directory = vi.fn();
const createMatch = vi.fn();

vi.mock("../api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({
      user: {
        id: "u1",
        email: "a@tab10.local",
        role: "user",
        mustChangePassword: false,
        firstName: "A",
        lastName: "User",
      },
    }),
    directory: (...args: unknown[]) => directory(...args),
    createMatch: (...args: unknown[]) => createMatch(...args),
  },
}));

describe("REQ_ui__match_create_autocomplete", () => {
  beforeEach(() => {
    directory.mockResolvedValue({
      users: [{ id: "u2", firstName: "B", lastName: "Rival", displayName: "Rival B" }],
    });
    createMatch.mockResolvedValue({ match: { id: "m1" } });
  });

  it("offers guest and player modes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <MatchCreatePage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("form", { name: /создание матча/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/гость/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^игрок$/i }));
    expect(await screen.findByText(/соперник/i)).toBeInTheDocument();
  });
});
