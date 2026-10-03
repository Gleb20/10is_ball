import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { GuestDetailPage } from "./GuestDetailPage";

const mutationMock = vi.hoisted(() => ({
  state: { kind: "idle" } as Record<string, unknown>,
}));

vi.mock("../api", () => ({ api: { getGuestHistory: vi.fn() } }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "actor" }, explicitAuthEpoch: 0 }) }));
vi.mock("../useGuestIdentityMutation", () => ({
  useGuestIdentityMutation: () => ({
    attempt: null,
    state: mutationMock.state,
    message: null,
    create: vi.fn(), rename: vi.fn(), reset: vi.fn(),
    checkFrozenAttempt: vi.fn(), resendFrozenAttempt: vi.fn(),
  }),
}));

describe("GAP-040 guest detail", () => {
  beforeEach(() => {
    mutationMock.state = { kind: "idle" };
    vi.mocked(api.getGuestHistory).mockResolvedValue({
      guest: {
        id: "00000000-0000-4000-8000-000000000001",
        firstName: "Новое",
        lastName: "Имя",
        displayName: "Имя Новое",
        avatarKey: "avatar_4",
        version: 8,
        canRename: true,
        createdAt: "2026-10-01T12:00:00.000Z",
        updatedAt: "2026-10-03T12:00:00.000Z",
      },
      items: [{
        type: "match",
        id: "00000000-0000-4000-8000-000000000101",
        title: "Прошлый матч",
        status: "finished",
        occurredAt: "2026-10-02T12:00:00.000Z",
        roles: ["player"],
        result: "win",
        matchKind: "standalone",
        scoreA: 11,
        scoreB: 7,
        sideA: "Старое Имя",
        sideB: "Соперник Исторический",
        format: "1v1",
      }],
      nextCursor: null,
    });
  });

  it("keeps historical snapshot names and hides the technical version", async () => {
    render(
      <MemoryRouter initialEntries={["/guests/00000000-0000-4000-8000-000000000001"]}>
        <Routes><Route path="/guests/:id" element={<GuestDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Прошлый матч")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem")).getByRole("link")).toHaveAttribute("href", "/matches/00000000-0000-4000-8000-000000000101");
    expect(screen.getByText(/Старое Имя — Соперник Исторический/)).toBeInTheDocument();
    expect(screen.getByText(/11:7/)).toBeInTheDocument();
    expect(screen.queryByText(/Версия/)).not.toBeInTheDocument();
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();
  });

  it("ignores a late history page after navigation to another guest", async () => {
    let resolveOldPage!: (value: Awaited<ReturnType<typeof api.getGuestHistory>>) => void;
    const oldPage = new Promise<Awaited<ReturnType<typeof api.getGuestHistory>>>((resolve) => { resolveOldPage = resolve; });
    const guest = (id: string, firstName: string) => ({
      id,
      firstName,
      lastName: "Гость",
      displayName: `Гость ${firstName}`,
      avatarKey: "avatar_4" as const,
      version: 0,
      canRename: true,
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-03T12:00:00.000Z",
    });
    const firstGuest = guest("00000000-0000-4000-8000-000000000001", "Первый");
    const secondGuest = guest("00000000-0000-4000-8000-000000000002", "Второй");
    vi.mocked(api.getGuestHistory)
      .mockResolvedValueOnce({ guest: firstGuest, items: [], nextCursor: "2" })
      .mockReturnValueOnce(oldPage)
      .mockResolvedValueOnce({ guest: secondGuest, items: [], nextCursor: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={[`/guests/${firstGuest.id}`]}>
        <Routes>
          <Route path="/guests/:id" element={<><Link to={`/guests/${secondGuest.id}`}>Другой гость</Link><GuestDetailPage /></>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "Показать ещё" }));
    await user.click(screen.getByRole("link", { name: "Другой гость" }));
    expect(await screen.findByRole("heading", { name: "Гость Второй", level: 1 })).toBeInTheDocument();

    resolveOldPage({
      guest: firstGuest,
      items: [{
        type: "match",
        id: "00000000-0000-4000-8000-000000000199",
        title: "Поздняя старая история",
        status: "finished",
        occurredAt: "2026-10-02T12:00:00.000Z",
        roles: ["player"],
        result: "win",
        matchKind: "standalone",
        scoreA: 11,
        scoreB: 7,
        sideA: "Старый",
        sideB: "Соперник",
        format: "1v1",
      }],
      nextCursor: null,
    });
    await Promise.resolve();
    expect(screen.queryByText("Поздняя старая история")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Гость Второй", level: 1 })).toBeInTheDocument();
  });

  it("never applies a rename success that belongs to another guest id", async () => {
    mutationMock.state = {
      kind: "success",
      recovered: true,
      guest: {
        id: "00000000-0000-4000-8000-000000000099",
        firstName: "Чужой",
        lastName: "Гость",
        displayName: "Гость Чужой",
        avatarKey: "avatar_1",
        version: 2,
        canRename: true,
        createdAt: "2026-10-01T12:00:00.000Z",
        updatedAt: "2026-10-03T12:00:00.000Z",
      },
    };
    render(
      <MemoryRouter initialEntries={["/guests/00000000-0000-4000-8000-000000000001"]}>
        <Routes><Route path="/guests/:id" element={<GuestDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Имя Новое", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("Гость Чужой")).not.toBeInTheDocument();
  });
});
