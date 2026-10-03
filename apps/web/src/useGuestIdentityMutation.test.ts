import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  clearHeldGuestIdentityMutationForTests,
  guestCreatePurposeKey,
  useGuestIdentityMutation,
} from "./useGuestIdentityMutation";

vi.mock("./api", () => ({
  api: {
    createGuest: vi.fn(),
    renameGuest: vi.fn(),
    getGuestMutationOutcome: vi.fn(),
    getGuest: vi.fn(),
  },
}));

const createGuest = vi.mocked(api.createGuest);
const renameGuest = vi.mocked(api.renameGuest);
const getOutcome = vi.mocked(api.getGuestMutationOutcome);
const getGuest = vi.mocked(api.getGuest);

const GUEST = {
  id: "22222222-2222-4222-8222-222222222222",
  firstName: "Анна",
  lastName: "Первая",
  displayName: "Первая Анна",
  avatarKey: "avatar_1",
  version: 0,
  canRename: true,
  createdAt: "2026-10-03T12:00:00.000Z",
  updatedAt: "2026-10-03T12:00:00.000Z",
} as const;

describe("GAP-040 guest mutation recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearHeldGuestIdentityMutationForTests();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  afterEach(() => vi.useRealTimers());

  it("freezes an uncertain create and resends the exact same request only explicitly", async () => {
    createGuest
      .mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 }))
      .mockResolvedValueOnce({ guest: GUEST });
    const { result } = renderHook(() => useGuestIdentityMutation());

    await act(() => result.current.create("Анна", "Первая"));
    expect(result.current.state.kind).toBe("unknown");
    expect(result.current.attempt?.requestId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );

    await act(() => result.current.resendFrozenAttempt());

    expect(createGuest).toHaveBeenCalledTimes(2);
    expect(createGuest.mock.calls[1]?.[0]).toEqual(createGuest.mock.calls[0]?.[0]);
    expect(result.current.state).toEqual({ kind: "success", guest: GUEST, recovered: false });
  });

  it("checks the frozen receipt before resolving a committed mutation", async () => {
    createGuest.mockRejectedValue(Object.assign(new Error("timeout"), { status: 0 }));
    getOutcome.mockResolvedValue({
      outcome: "committed",
      operation: "create",
      guestId: GUEST.id,
      resultingVersion: 0,
    });
    getGuest.mockResolvedValue({ guest: GUEST });
    const { result } = renderHook(() => useGuestIdentityMutation());

    await act(() => result.current.create("Анна", "Первая"));
    await act(() => result.current.checkFrozenAttempt());

    expect(getOutcome).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(result.current.state).toEqual({ kind: "success", guest: GUEST, recovered: false });
  });

  it("keeps rename input frozen and explains a version conflict without exposing versions", async () => {
    const current = { ...GUEST, version: 3, lastName: "Новая" };
    renameGuest.mockRejectedValue(
      Object.assign(new Error("VERSION_CONFLICT"), {
        status: 409,
        code: "VERSION_CONFLICT",
        details: { state: { currentVersion: 3 } },
      }),
    );
    getGuest.mockResolvedValue({ guest: current });
    const { result } = renderHook(() => useGuestIdentityMutation());

    await act(() => result.current.rename(GUEST, "Анна", "Вторая"));

    expect(renameGuest).toHaveBeenCalledWith(GUEST.id, {
      requestId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 0,
      firstName: "Анна",
      lastName: "Вторая",
    });
    expect(result.current.state.kind).toBe("conflict");
    expect(result.current.message).toContain("уже изменил");
    expect(result.current.message).not.toMatch(/\b[03]\b/);
  });

  it("turns a hung mutation into an explicit unknown state after fifteen seconds", async () => {
    vi.useFakeTimers();
    createGuest.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a" }));

    let mutation!: Promise<void>;
    act(() => { mutation = result.current.create("Анна", "Первая"); });
    expect(result.current.state.kind).toBe("pending");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await mutation;
    });

    expect(result.current.state.kind).toBe("unknown");
    expect(createGuest).toHaveBeenCalledTimes(1);
  });

  it("keeps the same frozen attempt across reauthentication and ignores the late old-epoch response", async () => {
    let resolveCreate!: (value: { guest: typeof GUEST }) => void;
    createGuest.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    getOutcome.mockResolvedValue({
      outcome: "committed",
      operation: "create",
      guestId: GUEST.id,
      resultingVersion: 0,
    });
    getGuest.mockResolvedValue({ guest: GUEST });
    const { result, rerender } = renderHook(
      ({ authEpoch }) => useGuestIdentityMutation({ actorId: "actor-a", authEpoch, routeKey: "/guests" }),
      { initialProps: { authEpoch: 0 } },
    );

    let mutation!: Promise<void>;
    act(() => { mutation = result.current.create("Анна", "Первая"); });
    const requestId = result.current.attempt?.requestId;
    rerender({ authEpoch: 1 });
    expect(result.current.state.kind).toBe("unknown");

    await act(async () => {
      resolveCreate({ guest: GUEST });
      await mutation;
    });
    expect(result.current.state.kind).toBe("unknown");
    expect(result.current.attempt?.requestId).toBe(requestId);

    await act(() => result.current.checkFrozenAttempt());
    expect(getOutcome).toHaveBeenCalledWith(requestId);
    expect(result.current.state).toEqual({ kind: "success", guest: GUEST, recovered: false });
  });

  it("restores an unknown attempt for the same actor after remount but never exposes it to another actor", async () => {
    createGuest.mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 }));
    const first = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a", routeKey: "/guests" }));
    await act(() => first.result.current.create("Анна", "Первая"));
    const frozen = first.result.current.attempt;
    first.unmount();

    const sameActor = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a", routeKey: "/matches/new" }));
    expect(sameActor.result.current.state.kind).toBe("unknown");
    expect(sameActor.result.current.attempt).toEqual(frozen);

    const otherActor = renderHook(() => useGuestIdentityMutation({ actorId: "actor-b", routeKey: "/guests" }));
    expect(otherActor.result.current.state.kind).toBe("idle");
    expect(otherActor.result.current.attempt).toBeNull();
    await act(() => otherActor.result.current.resendFrozenAttempt());
    expect(createGuest).toHaveBeenCalledTimes(1);

    createGuest.mockResolvedValueOnce({ guest: GUEST });
    await act(() => sameActor.result.current.resendFrozenAttempt());
    expect(createGuest).toHaveBeenCalledTimes(2);
    expect(createGuest.mock.calls[1]?.[0]).toEqual(createGuest.mock.calls[0]?.[0]);
  });

  it("drops visible mutation state on actor change and ignores the old actor's late success", async () => {
    let resolveCreate!: (value: { guest: typeof GUEST }) => void;
    createGuest.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const { result, rerender } = renderHook(
      ({ actorId }) => useGuestIdentityMutation({ actorId, routeKey: "/guests" }),
      { initialProps: { actorId: "actor-a" } },
    );

    let mutation!: Promise<void>;
    act(() => { mutation = result.current.create("Анна", "Первая"); });
    rerender({ actorId: "actor-b" });
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.attempt).toBeNull();

    await act(async () => {
      resolveCreate({ guest: GUEST });
      await mutation;
    });
    expect(result.current.state.kind).toBe("idle");
    expect(result.current.attempt).toBeNull();
  });

  it("does not expose a held create or rename to a different logical consumer", async () => {
    createGuest.mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 }));
    const createA = renderHook(() => useGuestIdentityMutation({
      actorId: "actor-a",
      purposeKey: guestCreatePurposeKey({ kind: "catalogue" }),
    }));
    await act(() => createA.result.current.create("Анна", "Первая"));
    createA.unmount();

    const detailY = renderHook(() => useGuestIdentityMutation({
      actorId: "actor-a",
      purposeKey: "guest-rename:guest-y",
    }));
    expect(detailY.result.current.state.kind).toBe("idle");
    expect(detailY.result.current.attempt).toBeNull();
    detailY.unmount();

    renameGuest.mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 }));
    const renameX = renderHook(() => useGuestIdentityMutation({
      actorId: "actor-a",
      purposeKey: "guest-rename:guest-x",
    }));
    await act(() => renameX.result.current.rename(GUEST, "Анна", "Вторая"));
    renameX.unmount();

    const renameY = renderHook(() => useGuestIdentityMutation({
      actorId: "actor-a",
      purposeKey: "guest-rename:guest-y",
    }));
    expect(renameY.result.current.state.kind).toBe("idle");
    expect(renameY.result.current.attempt).toBeNull();
  });

  it("isolates 2v2 slots and new drafts, then recovers the original slot with the exact key", async () => {
    const slotA = guestCreatePurposeKey({ kind: "match", draftToken: "draft-a", slotKey: "partner" });
    const slotB = guestCreatePurposeKey({ kind: "match", draftToken: "draft-a", slotKey: "opponent2" });
    const newDraftSlotA = guestCreatePurposeKey({ kind: "match", draftToken: "draft-b", slotKey: "partner" });
    createGuest.mockRejectedValueOnce(Object.assign(new Error("network"), { status: 0 }));
    const original = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a", purposeKey: slotA }));
    await act(() => original.result.current.create("Анна", "Первая"));
    const frozenPayload = createGuest.mock.calls[0]?.[0];
    original.unmount();

    const sibling = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a", purposeKey: slotB }));
    const newDraft = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a", purposeKey: newDraftSlotA }));
    expect(sibling.result.current.state.kind).toBe("idle");
    expect(newDraft.result.current.state.kind).toBe("idle");

    createGuest.mockResolvedValueOnce({ guest: GUEST });
    const restored = renderHook(() => useGuestIdentityMutation({ actorId: "actor-a", purposeKey: slotA }));
    expect(restored.result.current.state.kind).toBe("unknown");
    await act(() => restored.result.current.resendFrozenAttempt());

    expect(createGuest.mock.calls[1]?.[0]).toEqual(frozenPayload);
    expect(restored.result.current.state).toEqual({ kind: "success", guest: GUEST, recovered: true });
  });
});
