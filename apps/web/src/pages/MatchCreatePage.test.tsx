import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MatchCreatePage } from "./MatchCreatePage";
import { AuthProvider } from "../auth";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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
    createMatch.mockClear();
    matchCreateOptions.mockResolvedValue({
      users: [{ id: "u2", firstName: "B", lastName: "Rival", displayName: "Rival B" }],
      teams: [],
      recentOpponentIds: [],
      frequentOpponentIds: [],
    });
    createMatch.mockResolvedValue({ match: { id: "m1" } });
  });

  it("GAP-013 puts the complete roster before a collapsed, truthful rules summary and omits an empty shortcut frame", async () => {
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    const form = await screen.findByRole("form", { name: /создание матча/i });
    const playerA = screen.getByRole("group", { name: "Игрок A" });
    const opponent = screen.getByRole("group", { name: "Соперник" });
    const rules = screen.getByRole("button", { name: "Изменить правила" });

    expect(form.compareDocumentPosition(playerA) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(playerA.compareDocumentPosition(opponent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(opponent.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rules).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("До 11 · сухая 5:0 · первая подача вручную")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Быстрый выбор игроков" })).not.toBeInTheDocument();
  });

  it("GAP-013 keeps the secondary title editor collapsed for a new form and preserves edits across disclosure", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });

    const disclosure = screen.getByRole("button", { name: "Изменить название" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Название" })).not.toBeInTheDocument();

    await user.click(disclosure);
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "Вечерний матч");
    await user.click(screen.getByRole("button", { name: "Скрыть название" }));
    expect(screen.getByText("Вечерний матч")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Изменить название" }));
    expect(screen.getByRole("textbox", { name: "Название" })).toHaveValue("Вечерний матч");
  });

  it("D38 keeps the current custom value inside this form, exposes numeric step controls, and does not change it with format", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByRole("button", { name: "Изменить правила" }));
    await user.click(screen.getByRole("button", { name: "21" }));
    expect(screen.getByText("До 21 · сухая 10:0 · первая подача вручную")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Своё" }));
    const custom = screen.getByRole("spinbutton", { name: "Своё значение" });
    expect(custom).toHaveAttribute("inputmode", "numeric");
    await user.clear(custom);
    await user.type(custom, "1");
    await user.click(screen.getByRole("button", { name: "Уменьшить очки до победы" }));
    expect(custom).toHaveValue(1);
    await user.clear(custom);
    await user.type(custom, "15");
    await user.click(screen.getByRole("button", { name: "Увеличить очки до победы" }));
    expect(custom).toHaveValue(16);
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    expect(custom).toHaveValue(16);
    await user.click(screen.getByRole("button", { name: "Скрыть правила" }));
    expect(screen.getByText("До 16 · сухая 8:0 · первая подача вручную")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Изменить правила" }));
    expect(screen.getByRole("spinbutton", { name: "Своё значение" })).toHaveValue(16);
  });

  it("GAP-013 shows actor-relative recent choices only when the operator plays and previews replacement of B1", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Frequent", lastName: "Player" },
        { id: "u3", firstName: "Recent", lastName: "Player" },
      ],
      teams: [], recentOpponentIds: ["u3"], frequentOpponentIds: ["u2"],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("combobox", { name: "Соперник" });
    expect(screen.queryByRole("heading", { name: "Частые соперники" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Недавние соперники" })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Создатель играет"));
    await user.click(screen.getByRole("button", { name: "Frequent Player" }));
    expect(screen.getByRole("combobox", { name: "Соперник" })).toHaveValue("Frequent Player");
    await user.click(screen.getByRole("button", { name: "Recent Player" }));
    expect(screen.getByRole("combobox", { name: "Соперник" })).toHaveValue("Frequent Player");
    const preview = screen.getByRole("region", { name: "Предпросмотр быстрого выбора" });
    expect(preview).toHaveTextContent("B1: Recent Player");
    await user.click(within(preview).getByRole("button", { name: "Применить" }));
    expect(screen.getByRole("combobox", { name: "Соперник" })).toHaveValue("Recent Player");
  });

  it("GAP-013 always previews exact B1/B2 team destinations before applying them", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Blue", lastName: "One" },
        { id: "u3", firstName: "Blue", lastName: "Two" },
      ],
      teams: [{ id: "t1", name: "Синяя команда", userIds: ["u2", "u3"] }],
      recentOpponentIds: [], frequentOpponentIds: [],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    await user.click(screen.getByRole("button", { name: "Синяя команда" }));
    const preview = screen.getByRole("region", { name: "Предпросмотр быстрого выбора" });
    expect(preview).toHaveTextContent("B1: Blue One");
    expect(preview).toHaveTextContent("B2: Blue Two");
    expect(screen.getByRole("combobox", { name: "Соперник 1" })).toHaveValue("");
    await user.click(within(preview).getByRole("button", { name: "Применить" }));
    expect(screen.getByRole("combobox", { name: "Соперник 1" })).toHaveValue("Blue One");
    expect(screen.getByRole("combobox", { name: "Соперник 2" })).toHaveValue("Blue Two");
  });

  it("GAP-013 excludes every registered Side A player from team shortcuts and previews", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Alpha", lastName: "One" },
        { id: "u3", firstName: "Alpha", lastName: "Two" },
        { id: "u4", firstName: "Blue", lastName: "One" },
        { id: "u5", firstName: "Blue", lastName: "Two" },
      ],
      teams: [
        { id: "t1", name: "Занятая команда", userIds: ["u2", "u3"] },
        { id: "t2", name: "Свободная команда", userIds: ["u4", "u5"] },
      ],
      recentOpponentIds: [], frequentOpponentIds: [],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    await user.click(screen.getByRole("combobox", { name: "Игрок A" }));
    await user.click(await screen.findByText("Alpha One"));
    await user.click(screen.getByRole("combobox", { name: "Партнёр" }));
    await user.click(await screen.findByText("Alpha Two"));

    expect(screen.queryByRole("button", { name: "Занятая команда" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Свободная команда" }));
    const preview = screen.getByRole("region", { name: "Предпросмотр быстрого выбора" });
    expect(preview).toHaveTextContent("B1: Blue One");
    expect(preview).toHaveTextContent("B2: Blue Two");
    const partner = screen.getByRole("combobox", { name: "Партнёр" });
    await user.clear(partner);
    await user.type(partner, "Blue");
    await user.click(await screen.findByRole("option", { name: "Blue One" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Предпросмотр быстрого выбора" })).not.toBeInTheDocument();
    });
  });

  it("GAP-013 excludes the registered Side A partner from actor-relative recent shortcuts", async () => {
    matchCreateOptions.mockResolvedValue({
      users: [
        { id: "u2", firstName: "Partner", lastName: "Recent" },
        { id: "u3", firstName: "Open", lastName: "Recent" },
      ],
      teams: [], recentOpponentIds: ["u2", "u3"], frequentOpponentIds: ["u2"],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByLabelText("Создатель играет"));
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    await user.click(screen.getByRole("combobox", { name: "Партнёр" }));
    await user.click(await screen.findByRole("option", { name: "Partner Recent" }));

    expect(screen.queryByRole("button", { name: "Partner Recent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Частые соперники" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Recent" })).toBeVisible();
  });

  it("U01-FORM-004 keeps a manually edited mercy threshold across point choices in this form", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByRole("button", { name: "Изменить правила" }));
    await user.click(screen.getByRole("button", { name: "Своё" }));
    const custom = screen.getByRole("spinbutton", { name: "Своё значение" });
    const mercy = screen.getByRole("spinbutton", { name: "Порог" });
    await user.clear(custom);
    await user.type(custom, "12");
    expect(mercy).toHaveValue(6);
    await user.clear(mercy);
    await user.type(mercy, "7");
    await user.click(screen.getByRole("button", { name: "21" }));
    expect(mercy).toHaveValue(7);
    await user.click(screen.getByRole("button", { name: "11" }));
    expect(mercy).toHaveValue(7);
    await user.click(screen.getByRole("button", { name: "Своё" }));
    const customAgain = screen.getByRole("spinbutton", { name: "Своё значение" });
    await user.clear(customAgain);
    await user.type(customAgain, "13");
    expect(mercy).toHaveValue(7);
  });

  it("GAP-013 opens collapsed rules and focuses the invalid custom score without sending a mutation", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByLabelText("Создатель играет"));
    const opponent = screen.getByRole("group", { name: "Соперник" });
    await user.click(within(opponent).getByRole("button", { name: "Гость" }));
    await user.type(screen.getByRole("textbox", { name: /гость/i }), "Иван Иванов");
    await user.click(screen.getByRole("button", { name: "Изменить правила" }));
    await user.click(screen.getByRole("button", { name: "Своё" }));
    const custom = screen.getByRole("spinbutton", { name: "Своё значение" });
    await user.clear(custom);
    await user.click(screen.getByRole("button", { name: "Скрыть правила" }));
    await user.click(screen.getByRole("button", { name: "Создать матч" }));

    expect(createMatch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Скрыть правила" })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Своё значение" })).toHaveFocus());
  });

  it("BUG-026 freezes every visible match payload control while create is pending, then preserves a rejected attempt", async () => {
    const held = deferred<{ match: { id: string } }>();
    createMatch.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByLabelText("Создатель играет"));
    const opponent = screen.getByRole("group", { name: "Соперник" });
    await user.click(within(opponent).getByRole("button", { name: /^гость$/i }));
    const guest = screen.getByRole("textbox", { name: /гость/i });
    await user.type(guest, "Иван Иванов");
    await user.click(screen.getByRole("button", { name: "Изменить название" }));
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.click(screen.getByRole("button", { name: "Создать матч" }));
    expect(createMatch).toHaveBeenCalledTimes(1);
    expect(createMatch.mock.calls[0]?.[0]).toMatchObject({
      format: "1v1", participants: [{ side: "A", userId: "u1" }, { side: "B", guestFirstName: "Иван", guestLastName: "Иванов" }],
    });
    expect(screen.getByLabelText("Создатель играет")).toBeDisabled();
    expect(guest).toBeDisabled();
    expect(title).toBeDisabled();
    expect(screen.getByRole("button", { name: "1 × 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeEnabled();
    held.reject(Object.assign(new Error("Проверка отклонила матч"), { status: 409, code: "VALIDATION" }));
    expect(await screen.findByText("Проверка отклонила матч")).toBeInTheDocument();
    expect(guest).toHaveValue("Иван Иванов");
    expect(guest).toBeEnabled();
  });

  it("GAP-013 keeps an unknown create outcome visible without automatically replaying the mutation", async () => {
    createMatch.mockRejectedValueOnce(new Error("Не удалось получить ответ сервера"));
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    await screen.findByRole("form", { name: /создание матча/i });
    await user.click(screen.getByLabelText("Создатель играет"));
    const opponent = screen.getByRole("group", { name: "Соперник" });
    await user.click(within(opponent).getByRole("button", { name: /^гость$/i }));
    const guest = screen.getByRole("textbox", { name: /гость/i });
    await user.type(guest, "Иван Иванов");
    await user.click(screen.getByRole("button", { name: "Создать матч" }));

    expect(await screen.findByText("Не удалось получить ответ сервера")).toBeInTheDocument();
    await waitFor(() => expect(createMatch).toHaveBeenCalledTimes(1));
    expect(guest).toHaveValue("Иван Иванов");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
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
    expect(screen.getByText("До 11 · сухая 5:0 · первая подача вручную")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Изменить правила" }));
    expect(screen.getByRole("note", { name: "Подсказка о подаче" })).toHaveTextContent(
      /двух подач.*после достижения порога.*каждого очка/i,
    );
  });

  it("BUG-018 keeps the same focused player field after Enter selects a user", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    const input = await screen.findByRole("combobox", { name: "Соперник" });
    await user.type(input, "Rival");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("combobox", { name: "Соперник" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("B Rival");
  });

  it("BUG-018 preserves a search typed before match options finish loading", async () => {
    const held = deferred<{
      users: Array<{ id: string; firstName: string; lastName: string }>;
      teams: never[];
      recentOpponentIds: never[];
      frequentOpponentIds: never[];
    }>();
    matchCreateOptions.mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    const input = await screen.findByRole("combobox", { name: "Игрок A" });
    await user.type(input, "Alpha");
    held.resolve({
      users: [{ id: "u2", firstName: "Alpha", lastName: "Player" }],
      teams: [], recentOpponentIds: [], frequentOpponentIds: [],
    });
    const option = await screen.findByRole("option", { name: "Alpha Player" });
    expect(option).toBeVisible();
    expect(input).toHaveValue("Alpha");
    await user.click(option);
    expect(input).toHaveValue("Alpha Player");
    expect(input).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Очистить" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("BUG-018 clears an unfinished player search after guest mode resets the slot", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><MatchCreatePage /></AuthProvider></MemoryRouter>);
    const group = await screen.findByRole("group", { name: "Игрок A" });
    const input = within(group).getByRole("combobox", { name: "Игрок A" });
    await user.type(input, "Alpha");
    await user.click(within(group).getByRole("button", { name: "Гость" }));
    await user.click(within(group).getByRole("button", { name: "Игрок" }));
    expect(within(group).getByRole("combobox", { name: "Игрок A" })).toHaveValue("");
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
    await user.click(screen.getByRole("button", { name: "Изменить правила" }));
    await user.click(screen.getByRole("button", { name: "Своё" }));
    await user.clear(screen.getByLabelText("Своё значение"));
    await user.type(screen.getByLabelText("Своё значение"), "15");
    await user.clear(screen.getByLabelText("Порог"));
    await user.type(screen.getByLabelText("Порог"), "7");
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

    await screen.findByRole("form", { name: /создание матча/i });
    expect(screen.queryByRole("heading", { name: "Частые соперники" })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Создатель играет"));
    expect(await screen.findByRole("heading", { name: "Частые соперники" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Недавние соперники" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2 × 2" }));
    await user.click(screen.getByRole("button", { name: "Синяя команда" }));

    const preview = screen.getByRole("region", { name: "Предпросмотр быстрого выбора" });
    expect(preview).toHaveTextContent("B1: Recent Player");
    expect(preview).toHaveTextContent("B2: Team Mate");
    await user.click(within(preview).getByRole("button", { name: "Применить" }));
    expect(screen.getByRole("combobox", { name: "Соперник 1" })).toHaveValue("Recent Player");
    expect(screen.getByRole("combobox", { name: "Соперник 2" })).toHaveValue("Team Mate");
  });
});
