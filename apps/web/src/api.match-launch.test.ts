import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchLaunchRequest } from "@tab10/shared";
import { api } from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GAP-013 atomic match launch client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses one request id in the launch header and body, then reads its receipt", async () => {
    const payload: MatchLaunchRequest = {
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "Вечерний матч",
      format: "1v1",
      pointsToWin: 11,
      mercyEnabled: true,
      mercyPoints: 5,
      firstServerMethod: "manual",
      firstServerSlot: "A1",
      roster: {
        A1: { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        B1: { guestFirstName: "Борис", guestLastName: "Второй" },
      },
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { requestId: payload.requestId, matchId: "22222222-2222-4222-8222-222222222222" }))
      .mockResolvedValueOnce(jsonResponse(200, { outcome: "committed", matchId: "22222222-2222-4222-8222-222222222222" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.launchMatch(payload)).resolves.toMatchObject({ requestId: payload.requestId });
    await expect(api.getMatchLaunchOutcome(payload.requestId)).resolves.toEqual({
      outcome: "committed",
      matchId: "22222222-2222-4222-8222-222222222222",
    });

    const [launchUrl, launchInit] = fetchMock.mock.calls[0]!;
    expect(launchUrl).toBe("/api/v1/matches/launches");
    expect(launchInit?.method).toBe("POST");
    expect(new Headers(launchInit?.headers).get("Idempotency-Key")).toBe(payload.requestId);
    expect(JSON.parse(String(launchInit?.body))).toEqual(payload);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/matches/launches/${payload.requestId}`);
    expect(fetchMock.mock.calls[1]?.[1]?.method ?? "GET").toBe("GET");
  });
});
