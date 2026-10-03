import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestIdentity } from "@tab10/shared";
import { GuestPicker } from "./GuestPicker";

const listGuests = vi.fn();
const mutationMock = vi.hoisted(() => ({
  state: { kind: "idle" } as Record<string, unknown>,
  reset: vi.fn(),
}));

vi.mock("../api", () => ({
  api: { listGuests: (...args: unknown[]) => listGuests(...args) },
}));

vi.mock("../useGuestIdentityMutation", () => ({
  useGuestIdentityMutation: () => ({
    attempt: null,
    state: mutationMock.state,
    message: null,
    create: vi.fn(),
    resendFrozenAttempt: vi.fn(),
    checkFrozenAttempt: vi.fn(),
    reset: mutationMock.reset,
  }),
}));

const guest = (id: string): GuestIdentity => ({
  id,
  firstName: "Анна",
  lastName: "Первая",
  displayName: "Первая Анна",
  avatarKey: "avatar_1",
  version: 0,
  canRename: true,
  createdAt: "2026-10-03T12:00:00.000Z",
  updatedAt: "2026-10-03T12:00:00.000Z",
});

describe("GAP-040 GuestPicker", () => {
  beforeEach(() => {
    listGuests.mockReset();
    mutationMock.state = { kind: "idle" };
    mutationMock.reset.mockReset();
  });

  it("keeps identical names distinguishable by a short stable record number", async () => {
    const first = guest("00000000-0000-4000-8000-000000000001");
    const second = guest("00000000-0000-4000-8000-000000000002");
    listGuests.mockResolvedValue({ guests: [first, second], nextCursor: null });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<GuestPicker label="Гость" value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Гость" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.click(input);

    expect(screen.getByRole("option", { name: "Первая Анна · № 000001" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Первая Анна · № 000002" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Первая Анна · № 000002" }));
    expect(onChange).toHaveBeenCalledWith(second);
  });

  it("does not clear an explicit selection when a catalogue response no longer contains it", async () => {
    const selected = guest("00000000-0000-4000-8000-000000000003");
    listGuests.mockResolvedValue({ guests: [], nextCursor: null });
    const onChange = vi.fn();

    render(<GuestPicker label="Гость" value={selected} onChange={onChange} />);

    expect(await screen.findByText("Первая Анна")).toBeInTheDocument();
    expect(screen.getByText("№ 000003")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Сохранённых гостей пока нет");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never auto-selects a recovered create until the current field confirms it explicitly", async () => {
    const recovered = guest("00000000-0000-4000-8000-000000000004");
    mutationMock.state = { kind: "success", guest: recovered, recovered: true };
    listGuests.mockResolvedValue({ guests: [], nextCursor: null });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<GuestPicker label="Гость" value={null} onChange={onChange} mutationScope={{ purposeKey: "slot-a" }} />);

    expect(await screen.findByText("Гость сохранён")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Выбрать Первая Анна" }));
    expect(mutationMock.reset).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(recovered);
  });
});
