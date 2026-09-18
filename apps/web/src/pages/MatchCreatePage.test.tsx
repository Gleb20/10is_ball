import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MatchCreatePage } from "./MatchCreatePage";
import { AuthProvider } from "../auth";

const matchCreateOptions = vi.fn();
const createMatch = vi.fn();
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }

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
    matchCreateOptions: (...args: unknown[]) => matchCreateOptions(...args),
    createMatch: (...args: unknown[]) => createMatch(...args),
  },
}));

describe("REQ_ui__match_create_autocomplete", () => {
  beforeEach(() => {
    cleanup();
    matchCreateOptions.mockResolvedValue({
      users: [{ id: "u2", firstName: "B", lastName: "Rival", displayName: "Rival B" }],
      teams: [],
      recentOpponentIds: [],
      frequentOpponentIds: [],
    });
    createMatch.mockResolvedValue({ match: { id: "m1" } });
  });

  it("defaults to player mode with opponent autocomplete", async () => {
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
    expect(
      await screen.findByRole("combobox", { name: "Соперник" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/сухая победа при счёте 5:0/i)).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Подсказка о подаче" })).toHaveTextContent(
      /двух подач.*после достижения порога.*каждого очка/i,
    );
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

    const opponent = screen.getByRole("group", { name: "Соперник" });
    await user.click(within(opponent).getByRole("button", { name: /^гость$/i }));
    expect(await screen.findByLabelText(/гость/i)).toBeInTheDocument();

    await user.click(within(opponent).getByRole("button", { name: /^игрок$/i }));
    expect(
      await screen.findByRole("combobox", { name: "Соперник" }),
    ).toBeInTheDocument();
  });

  it("GAP-029: removes legacy challenge query without applying its player or invite intent", async () => {
    render(
      <MemoryRouter
        initialEntries={["/matches/new?opponentId=u1&opponentName=A%20User&source=revenge&returnTo=home"]}
      >
        <AuthProvider>
          <MatchCreatePage />
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/matches/new?returnTo=home");
    expect(screen.getByLabelText("Создатель играет")).not.toBeChecked();
    expect(screen.queryByText(/вызов|реванш/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Пригласить выбранных игроков")).not.toBeInTheDocument();
    expect(createMatch).not.toHaveBeenCalled();
  });

  it("GAP-012: submits manual A-vs-B without the operator and without invitations by default", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Alpha", lastName: "Player" },
        { id: "u3", firstName: "Beta", lastName: "Player" },
      ],
      teams: [], recentOpponentIds: [], frequentOpponentIds: [],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await user.click(await screen.findByRole("combobox", { name: "Игрок A" }));
    await user.click(await screen.findByText("Alpha Player"));
    await user.click(screen.getByRole("combobox", { name: "Соперник" }));
    await user.click(await screen.findByText("Beta Player"));
    await user.click(screen.getByRole("button", { name: /создать матч/i }));
    expect(createMatch).toHaveBeenCalledWith(expect.objectContaining({
      source: "manual",
      sendPlayerInvitations: false,
      participants: [
        { side: "A", userId: "u2" },
        { side: "B", userId: "u3" },
      ],
    }));
  });

  it("GAP-029: legacy challenge URL only creates a manually chosen match", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/matches/new?opponentId=u2&opponentName=B%20Rival"]}>
        <AuthProvider><MatchCreatePage /></AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("form", { name: /создание матча/i });
    expect(screen.getByLabelText("Создатель играет")).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Соперник" })).toHaveValue("");
    await user.click(screen.getByLabelText("Создатель играет"));
    await user.click(screen.getByRole("combobox", { name: "Соперник" }));
    await user.click(await screen.findByText("B Rival"));
    await user.click(screen.getByRole("button", { name: /создать матч/i }));
    expect(createMatch).toHaveBeenCalledWith(expect.objectContaining({
      source: "manual",
      sendPlayerInvitations: false,
      participants: [
        { side: "A", userId: "u1" },
        { side: "B", userId: "u2" },
      ],
    }));
  });

  it("GAP-005: submits a complete 2v2 roster with custom rules and first-server mode", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Partner", lastName: "Two", displayName: "Partner Two" },
        { id: "u3", firstName: "Rival", lastName: "Three", displayName: "Rival Three" },
        { id: "u4", firstName: "Rival", lastName: "Four", displayName: "Rival Four" },
      ],
      teams: [],
      recentOpponentIds: [],
      frequentOpponentIds: [],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <MatchCreatePage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByLabelText("Создатель играет"));
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    await user.clear(screen.getByLabelText("Очков до победы"));
    await user.type(screen.getByLabelText("Очков до победы"), "15");
    await user.clear(screen.getByLabelText("Порог сухой победы"));
    await user.type(screen.getByLabelText("Порог сухой победы"), "7");
    await user.click(screen.getByRole("button", { name: "Случайно" }));
    await user.click(screen.getByLabelText("Партнёр"));
    await user.click(await screen.findByText("Partner Two"));
    await user.click(screen.getByLabelText("Соперник 1"));
    await user.click(await screen.findByText("Rival Three"));
    await user.click(screen.getByLabelText("Соперник 2"));
    await user.click(await screen.findByText("Rival Four"));
    expect(screen.queryByLabelText("Судья (необязательно)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /создать матч/i }));

    expect(createMatch).toHaveBeenCalledWith(expect.objectContaining({
      format: "2v2",
      pointsToWin: 15,
      mercyPoints: 7,
      firstServerMethod: "random",
      sendPlayerInvitations: false,
      participants: [
        { side: "A", userId: "u1" },
        { side: "A", userId: "u2" },
        { side: "B", userId: "u3" },
        { side: "B", userId: "u4" },
      ],
    }));
  });

  it("MATCH-004: uses frequent, recent and team groups from the create options", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Frequent", lastName: "Player", displayName: "Frequent Player" },
        { id: "u3", firstName: "Recent", lastName: "Player", displayName: "Recent Player" },
        { id: "u4", firstName: "Team", lastName: "Mate", displayName: "Team Mate" },
      ],
      teams: [{ id: "t1", name: "Синяя команда", userIds: ["u3", "u4"] }],
      recentOpponentIds: ["u3"],
      frequentOpponentIds: ["u2"],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <MatchCreatePage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Частые соперники" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Недавние соперники" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    await user.click(screen.getByRole("button", { name: "Синяя команда" }));

    expect(screen.getByRole("combobox", { name: "Соперник 1" })).toHaveValue("Recent Player");
    expect(screen.getByRole("combobox", { name: "Соперник 2" })).toHaveValue("Team Mate");
  });
});
