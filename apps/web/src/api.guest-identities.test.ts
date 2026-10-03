import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GAP-040 reusable guest client contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("encodes catalogue filters and cursors without changing GET semantics", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, { guests: [], nextCursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listGuests({ q: "Анна П", cursor: "cursor/next", limit: 12 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/guests?q=%D0%90%D0%BD%D0%BD%D0%B0+%D0%9F&cursor=cursor%2Fnext&limit=12",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("uses the same frozen request id in create and rename headers and bodies", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { guest: { id: "guest-1" } }))
      .mockResolvedValueOnce(jsonResponse(200, { guest: { id: "guest-1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.createGuest({ requestId, firstName: "Анна", lastName: "Первая" });
    await api.renameGuest("guest/1", {
      requestId,
      expectedVersion: 4,
      firstName: "Анна",
      lastName: "Вторая",
    });

    const [, createInit] = fetchMock.mock.calls[0]!;
    expect(new Headers(createInit?.headers).get("Idempotency-Key")).toBe(requestId);
    expect(JSON.parse(String(createInit?.body))).toEqual({
      requestId,
      firstName: "Анна",
      lastName: "Первая",
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/guests/guest%2F1");
    const [, renameInit] = fetchMock.mock.calls[1]!;
    expect(new Headers(renameInit?.headers).get("Idempotency-Key")).toBe(requestId);
    expect(JSON.parse(String(renameInit?.body))).toEqual({
      requestId,
      expectedVersion: 4,
      firstName: "Анна",
      lastName: "Вторая",
    });
  });

  it("reads an actor-bound mutation receipt and immutable guest history", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { outcome: "unknown" }))
      .mockResolvedValueOnce(jsonResponse(200, { guest: {}, items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await api.getGuestMutationOutcome("request/1");
    await api.getGuestHistory("guest/1", { cursor: "history/next" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/guests/requests/request%2F1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/guests/guest%2F1/history?cursor=history%2Fnext",
    );
  });

  it("passes only an explicit reusable guest id to tournament roster mutation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, { participant: {}, tournament: { id: "t-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.addTournamentParticipant(
      "t-1",
      { guestIdentityId: "22222222-2222-4222-8222-222222222222" },
      "33333333-3333-4333-8333-333333333333",
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      guestIdentityId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
