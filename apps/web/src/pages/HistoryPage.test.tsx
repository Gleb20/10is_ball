import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth";
import { HistoryPage, historyDayBoundary } from "./HistoryPage";

const me = vi.fn();
const history = vi.fn();

function ActivityHistory() {
  const [mode, setMode] = useState<"visible" | "hidden">("visible");
  return (
    <>
      <button onClick={() => setMode("hidden")}>Скрыть историю</button>
      <button onClick={() => setMode("visible")}>Показать историю</button>
      <button>Фокус нового цикла</button>
      <Activity mode={mode}><HistoryPage /></Activity>
    </>
  );
}

function AuthControl() {
  const { setUser } = useAuth();
  return (
    <button onClick={() => setUser({ id: "other", email: "other@history.test", role: "user", mustChangePassword: false })}>
      Сменить пользователя
    </button>
  );
}

function LeaveHistory() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/other")}>Уйти из истории</button>;
}

vi.mock("../api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    history: (...args: unknown[]) => history(...args),
    adminDeleteMatch: vi.fn(),
  },
}));

describe("AT-ADM-MATCH-007 history purge visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
    me.mockResolvedValue({
      user: {
        id: "admin",
        email: "admin@tab10.local",
        role: "admin",
        mustChangePassword: false,
        firstName: "Admin",
        lastName: "User",
      },
    });
    history.mockResolvedValue({
      items: [
        {
          type: "match",
          id: "waiting",
          title: "Черновик",
          matchKind: "standalone",
          status: "waiting",
          scoreA: 0,
          scoreB: 0,
          occurredAt: "2026-09-07T10:00:00.000Z",
          roles: ["player", "organizer"],
          result: null,
        },
        {
          type: "match",
          id: "finished",
          title: "Завершённый",
          matchKind: "standalone",
          status: "finished",
          scoreA: 11,
          scoreB: 8,
          occurredAt: "2026-09-07T11:00:00.000Z",
          roles: ["player", "organizer"],
          result: "win",
        },
        {
          type: "match",
          id: "voided",
          title: "Аннулированный",
          matchKind: "standalone",
          status: "voided",
          scoreA: 11,
          scoreB: 9,
          occurredAt: "2026-09-07T12:00:00.000Z",
          roles: ["player", "organizer"],
          result: null,
        },
      ],
      nextCursor: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("shows hard purge only for non-finished standalone records", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Завершённый")).toBeInTheDocument();
    expect(screen.getByText("Аннулированный")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^удалить$/i })).toHaveLength(1);
  });
});

describe("AT-VIS-003 history controls and states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
    me.mockResolvedValue({
      user: {
        id: "user",
        email: "user@tab10.local",
        role: "user",
        mustChangePassword: false,
      },
    });
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("uses Moscow day boundaries independently of the browser timezone", () => {
    expect(historyDayBoundary("2026-09-01", false)).toBe(
      "2026-08-31T21:00:00.000Z",
    );
    expect(historyDayBoundary("2026-09-01", true)).toBe(
      "2026-09-01T20:59:59.999Z",
    );
  });

  it("submits search and combined filters to the dedicated endpoint", async () => {
    history.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Пока пусто");
    await user.type(screen.getByRole("searchbox", { name: /поиск/i }), "Борис");
    await user.click(screen.getByRole("button", { name: /фильтры/i }));
    await user.selectOptions(screen.getByLabelText("Роль"), "player");
    await user.selectOptions(screen.getByLabelText("Результат"), "win");
    await user.selectOptions(screen.getByLabelText("Тип события"), "match");
    await user.click(screen.getByRole("button", { name: /применить/i }));
    await user.click(screen.getByRole("button", { name: /найти/i }));

    await waitFor(() =>
      expect(history).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: "Борис",
          role: "player",
          result: "win",
          eventType: "match",
        }),
      ),
    );
    expect(screen.getByText(/Поиск: «Борис»; Роль: Игрок; Результат: Победа; Тип: Матч/)).toBeInTheDocument();
  });

  it("preserves loaded rows when next-page loading fails and permits retry", async () => {
    history
      .mockResolvedValueOnce({
        items: [
          {
            type: "tournament",
            id: "cup",
            title: "Кубок",
            status: "finished",
            format: "single_elimination",
            occurredAt: "2026-09-07T10:00:00.000Z",
            roles: ["viewer"],
            result: null,
          },
        ],
        nextCursor: "next",
      })
      .mockRejectedValueOnce(new Error("Сеть недоступна"));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Кубок")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /показать ещё/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(screen.getByText("Кубок")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /повторить/i })).toBeEnabled();
  });

  it("GAP-024: shows both match sides and keeps an old-response fallback", async () => {
    history.mockResolvedValue({
      items: [
        {
          type: "match",
          id: "new-contract",
          title: "Парная встреча",
          status: "finished",
          sideA: "Очень длинная фамилия Участника / Напарник Тимофей",
          sideB: "Соперник Борис / Григорий Гость",
          matchKind: "standalone",
          scoreA: 11,
          scoreB: 8,
          format: "2v2",
          occurredAt: "2026-09-07T10:00:00.000Z",
          roles: ["player", "organizer"],
          result: "win",
        },
        {
          type: "match",
          id: "old-contract",
          title: "Ответ старого сервера",
          status: "finished",
          matchKind: "standalone",
          scoreA: 11,
          scoreB: 9,
          format: "1v1",
          occurredAt: "2026-09-06T10:00:00.000Z",
          roles: ["player"],
          result: "win",
        },
      ],
      nextCursor: null,
    });

    render(<MemoryRouter><AuthProvider><HistoryPage /></AuthProvider></MemoryRouter>);

    expect(await screen.findByText("Очень длинная фамилия Участника / Напарник Тимофей")).toBeInTheDocument();
    expect(screen.getByText("Соперник Борис / Григорий Гость")).toBeInTheDocument();
    expect(screen.getByLabelText("Счёт стороны Очень длинная фамилия Участника / Напарник Тимофей: 11")).toHaveTextContent("11");
    expect(screen.getByLabelText("Счёт стороны Соперник Борис / Григорий Гость: 8")).toHaveTextContent("8");
    expect(screen.getByText(/Матч · 11:9 · Победа/)).toBeInTheDocument();
  });

  it("retries an initial error and replaces it with the authoritative empty state", async () => {
    history
      .mockRejectedValueOnce(new Error("API временно недоступен"))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("API временно недоступен")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /повторить/i }));
    expect(await screen.findByText("Пока пусто")).toBeInTheDocument();
  });

  it("does not let an older response overwrite newer filtered results", async () => {
    let resolveFirst!: (value: { items: []; nextCursor: null }) => void;
    history
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        items: [
          {
            type: "match",
            id: "new",
            title: "Новый ответ",
            status: "finished",
            matchKind: "standalone",
            scoreA: 11,
            scoreB: 8,
            format: "1v1",
            occurredAt: "2026-09-07T10:00:00.000Z",
            roles: ["player"],
            result: "win",
          },
        ],
        nextCursor: null,
      });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.type(screen.getByRole("searchbox", { name: /поиск/i }), "новый");
    await user.click(screen.getByRole("button", { name: /найти/i }));
    expect(await screen.findByText("Новый ответ")).toBeInTheDocument();
    resolveFirst({ items: [], nextCursor: null });
    await waitFor(() => expect(screen.getByText("Новый ответ")).toBeInTheDocument());
  });

  it("GAP-024: Activity resume rejects a late private response from the previous lifecycle", async () => {
    history.mockResolvedValueOnce({
      items: [{ type: "match", id: "initial", title: "Исходная история", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 8, format: "1v1", occurredAt: "2026-09-07T10:00:00.000Z", roles: ["player"], result: "win" }],
      nextCursor: null,
    });
    let resolveOld!: (value: { items: Array<Record<string, unknown>>; nextCursor: null }) => void;
    history
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({
        items: [{ type: "match", id: "fresh", title: "Свежая история", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 7, format: "1v1", occurredAt: "2026-09-07T11:00:00.000Z", roles: ["player"], result: "win" }],
        nextCursor: null,
      });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><ActivityHistory /></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("Исходная история")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: /поиск/i }), "история");
    await user.click(screen.getByRole("button", { name: /найти/i }));
    fireEvent.click(screen.getByRole("button", { name: "Скрыть историю" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать историю" }));
    expect(await screen.findByText("Свежая история")).toBeInTheDocument();
    const freshFocus = screen.getByRole("button", { name: "Фокус нового цикла" });
    freshFocus.focus();
    await act(async () => resolveOld({
      items: [{ type: "match", id: "private-old", title: "Чужая поздняя история" }],
      nextCursor: null,
    }));
    expect(screen.queryByText("Чужая поздняя история")).not.toBeInTheDocument();
    expect(freshFocus).toHaveFocus();
  });

  it("GAP-024: actor change hides old rows immediately and rejects the late actor response", async () => {
    let resolveFirst!: (value: { items: Array<Record<string, unknown>>; nextCursor: null }) => void;
    history
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        items: [{ type: "match", id: "other-row", title: "История другого пользователя", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 6, format: "1v1", occurredAt: "2026-09-07T11:00:00.000Z", roles: ["player"], result: "win" }],
        nextCursor: null,
      });
    const user = userEvent.setup();
    render(<MemoryRouter><AuthProvider><AuthControl /><HistoryPage /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Сменить пользователя" }));
    expect(await screen.findByText("История другого пользователя")).toBeInTheDocument();
    await act(async () => resolveFirst({
      items: [{ type: "match", id: "old-actor", title: "Закрытая история прежнего пользователя" }],
      nextCursor: null,
    }));
    expect(screen.queryByText("Закрытая история прежнего пользователя")).not.toBeInTheDocument();
  });

  it("GAP-024: route exit rejects a late history response and preserves destination focus", async () => {
    let resolveHistory!: (value: { items: Array<Record<string, unknown>>; nextCursor: null }) => void;
    history.mockImplementationOnce(() => new Promise((resolve) => { resolveHistory = resolve; }));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <AuthProvider>
          <Routes>
            <Route path="/history" element={<><HistoryPage /><LeaveHistory /></>} />
            <Route path="/other" element={<button>Фокус назначения</button>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Уйти из истории" }));
    const destination = screen.getByRole("button", { name: "Фокус назначения" });
    destination.focus();
    await act(async () => resolveHistory({
      items: [{ type: "match", id: "late-route", title: "Поздняя история старого маршрута" }],
      nextCursor: null,
    }));
    expect(screen.queryByText("Поздняя история старого маршрута")).not.toBeInTheDocument();
    expect(destination).toHaveFocus();
  });

  it("unlocks pagination after filters supersede an in-flight next page", async () => {
    let resolvePage!: (value: {
      items: Array<Record<string, unknown>>;
      nextCursor: null;
    }) => void;
    history
      .mockResolvedValueOnce({
        items: [
          {
            type: "match",
            id: "first",
            title: "Исходная строка",
            status: "finished",
            matchKind: "standalone",
            scoreA: 11,
            scoreB: 8,
            format: "1v1",
            occurredAt: "2026-09-07T10:00:00.000Z",
            roles: ["player"],
            result: "win",
          },
        ],
        nextCursor: "older-page",
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          }),
      )
      .mockResolvedValueOnce({
        items: [
          {
            type: "match",
            id: "filtered",
            title: "Новый фильтр",
            status: "finished",
            matchKind: "standalone",
            scoreA: 11,
            scoreB: 6,
            format: "1v1",
            occurredAt: "2026-09-07T11:00:00.000Z",
            roles: ["player"],
            result: "win",
          },
        ],
        nextCursor: "filtered-page",
      });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <HistoryPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Исходная строка")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /показать ещё/i }));
    await user.type(screen.getByRole("searchbox", { name: /поиск/i }), "новый");
    await user.click(screen.getByRole("button", { name: /найти/i }));
    expect(await screen.findByText("Новый фильтр")).toBeInTheDocument();

    resolvePage({
      items: [{ id: "stale", title: "Старая страница" }],
      nextCursor: null,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /показать ещё/i })).toBeEnabled(),
    );
    expect(screen.queryByText("Старая страница")).not.toBeInTheDocument();
  });

  it("restores loaded pages and filters after returning from detail", async () => {
    history
      .mockResolvedValueOnce({
        items: [{ type: "match", id: "first", title: "Первая игра", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 8, format: "1v1", occurredAt: "2026-09-07T10:00:00.000Z", roles: ["player"], result: "win" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        items: [{ type: "match", id: "second", title: "Вторая игра", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 9, format: "1v1", occurredAt: "2026-09-06T10:00:00.000Z", roles: ["player"], result: "win" }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [{ type: "match", id: "first", title: "Первая игра", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 8, format: "1v1", occurredAt: "2026-09-07T10:00:00.000Z", roles: ["player"], result: "win" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        items: [{ type: "match", id: "second", title: "Вторая игра", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 9, format: "1v1", occurredAt: "2026-09-06T10:00:00.000Z", roles: ["player"], result: "win" }],
        nextCursor: null,
      });
    const user = userEvent.setup();
    function Detail() {
      const navigate = useNavigate();
      return <button onClick={() => navigate(-1)}>Назад</button>;
    }
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <AuthProvider>
          <Routes>
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/matches/:id" element={<Detail />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: /показать ещё/i }));
    expect(await screen.findByText("Вторая игра")).toBeInTheDocument();
    const secondLink = screen.getByRole("link", { name: /вторая игра/i });
    await user.click(secondLink);
    await user.click(await screen.findByRole("button", { name: "Назад" }));
    expect(await screen.findByText("Первая игра")).toBeInTheDocument();
    expect(screen.getByText("Вторая игра")).toBeInTheDocument();
    expect(history).toHaveBeenCalledTimes(4);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /вторая игра/i })).toHaveFocus(),
    );
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("opens a history detail when session storage rejects return context", async () => {
    history.mockResolvedValue({
      items: [{ type: "match", id: "m1", title: "Матч для перехода", status: "finished", matchKind: "standalone", scoreA: 11, scoreB: 8, format: "1v1", occurredAt: "2026-09-07T10:00:00.000Z", roles: ["player"], result: "win" }],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/history"]}>
        <AuthProvider>
          <Routes>
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/matches/:id" element={<div>Деталь открыта</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /Матч для перехода/ });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("StorageError"); });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    try {
      await user.click(link);
      expect(await screen.findByText("Деталь открыта")).toBeInTheDocument();
    } finally {
      storage.mockRestore();
      scrollTo.mockRestore();
    }
  });
});
