import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { GuestsPage } from "./GuestsPage";

const mutationMock = vi.hoisted(() => ({
  state: { kind: "idle" } as Record<string, unknown>,
  reset: vi.fn(),
}));

vi.mock("../api", () => ({ api: { listGuests: vi.fn() } }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "actor" }, explicitAuthEpoch: 0 }) }));
vi.mock("../useGuestIdentityMutation", () => ({
  guestCreatePurposeKey: (target: { kind: string; draftToken?: string; slotKey?: string; tournamentId?: string }) =>
    target.kind === "match"
      ? `guest-create:match:${target.draftToken}:${target.slotKey}`
      : target.kind === "tournament"
        ? `guest-create:tournament:${target.tournamentId}`
        : "guest-create:catalogue",
  useGuestIdentityMutation: () => ({
    attempt: null,
    state: mutationMock.state,
    message: null,
    create: vi.fn(), rename: vi.fn(), reset: mutationMock.reset,
    checkFrozenAttempt: vi.fn(), resendFrozenAttempt: vi.fn(),
  }),
}));

const base = {
  firstName: "Анна",
  lastName: "Первая",
  displayName: "Первая Анна",
  avatarKey: "avatar_1",
  version: 0,
  canRename: true,
  createdAt: "2026-10-03T12:00:00.000Z",
  updatedAt: "2026-10-03T12:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}|{JSON.stringify(location.state)}</output>;
}

describe("GAP-040 guest catalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationMock.state = { kind: "idle" };
    vi.mocked(api.listGuests).mockResolvedValue({
      guests: [
        { ...base, id: "00000000-0000-4000-8000-000000000001" },
        { ...base, id: "00000000-0000-4000-8000-000000000002" },
      ],
      nextCursor: null,
    });
  });

  it("shows same-name records as separate cards without technical versions", async () => {
    render(<MemoryRouter><GuestsPage /></MemoryRouter>);

    expect(await screen.findAllByText("Первая Анна")).toHaveLength(2);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/guests/00000000-0000-4000-8000-000000000001");
    expect(screen.getByText("№ 000001")).toBeInTheDocument();
    expect(screen.getByText("№ 000002")).toBeInTheDocument();
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Версия/)).not.toBeInTheDocument();
  });

  it("keeps the catalogue query in the URL and preserves it as the detail return target", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/guests?q=%D0%90%D0%BD%D0%BD%D0%B0"]}>
        <Routes>
          <Route path="/guests" element={<><GuestsPage /><LocationProbe /></>} />
          <Route path="/guests/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.listGuests).toHaveBeenCalledWith(expect.objectContaining({ q: "Анна" })));
    expect(screen.getByLabelText("Поиск гостей")).toHaveValue("Анна");
    await user.click((await screen.findAllByText("Первая Анна"))[0]!);
    expect(screen.getByTestId("location")).toHaveTextContent("/guests/00000000-0000-4000-8000-000000000001");
    expect(screen.getByTestId("location")).toHaveTextContent('"returnTo":"/guests?q=%D0%90%D0%BD%D0%BD%D0%B0"');
  });

  it("ignores a late continuation page after the search query changes", async () => {
    const oldPage = deferred<Awaited<ReturnType<typeof api.listGuests>>>();
    vi.mocked(api.listGuests)
      .mockResolvedValueOnce({
        guests: [{ ...base, id: "00000000-0000-4000-8000-000000000001" }],
        nextCursor: "2",
      })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({
        guests: [{ ...base, id: "00000000-0000-4000-8000-000000000003", firstName: "Борис", displayName: "Первая Борис" }],
        nextCursor: null,
      });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/guests"]}><GuestsPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Показать ещё" }));
    const search = screen.getByLabelText("Поиск гостей");
    await user.clear(search);
    await user.type(search, "Борис");
    await user.click(screen.getByRole("button", { name: "Найти" }));
    expect(await screen.findByText("Первая Борис")).toBeInTheDocument();

    oldPage.resolve({
      guests: [{ ...base, id: "00000000-0000-4000-8000-000000000099", displayName: "Старая страница" }],
      nextCursor: null,
    });
    await Promise.resolve();
    expect(screen.queryByText("Старая страница")).not.toBeInTheDocument();
  });

  it("requires an explicit choice before a recovered create returns to its original match slot", async () => {
    const recovered = { ...base, id: "00000000-0000-4000-8000-000000000077" };
    mutationMock.state = { kind: "success", guest: recovered, recovered: true };
    vi.mocked(api.listGuests).mockResolvedValue({ guests: [], nextCursor: null });
    const user = userEvent.setup();
    const guestSelectionContext = {
      kind: "match",
      returnTo: "/matches/new",
      returnLabel: "К подготовке",
      draftToken: "draft-a",
      slotKey: "opponent1",
    };
    render(
      <MemoryRouter initialEntries={[{ pathname: "/guests", state: { guestSelectionContext } }]}>
        <Routes>
          <Route path="/guests" element={<><GuestsPage /><LocationProbe /></>} />
          <Route path="/matches/new" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Гость сохранён")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/guests");
    await user.click(screen.getByRole("button", { name: "Выбрать Первая Анна" }));
    expect(mutationMock.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/matches/new");
    expect(screen.getByTestId("location")).toHaveTextContent('"slotKey":"opponent1"');
    expect(screen.getByTestId("location")).toHaveTextContent('"id":"00000000-0000-4000-8000-000000000077"');
  });
});
