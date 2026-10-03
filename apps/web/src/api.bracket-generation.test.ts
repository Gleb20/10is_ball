import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BUG-022 versioned bracket generation API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the context and versioned generation endpoints without a legacy fallback", async () => {
    const context = {
      id: "t1",
      title: "Cup",
      status: "collecting",
      bracketStateVersion: 7,
    };
    const generated = {
      ...context,
      status: "bracket_generated",
      bracketStateVersion: 8,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ tournament: context }))
      .mockResolvedValueOnce(jsonResponse({ tournament: generated }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getBracketGenerationContext("t1")).resolves.toEqual({
      tournament: context,
    });
    await expect(api.generateBracket("t1", {
      expectedVersion: 7,
      constructionAlgorithm: "compact",
    })).resolves.toEqual({ tournament: generated });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/tournaments/t1/bracket-generation-context",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/tournaments/t1/bracket-generations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedVersion: 7,
          constructionAlgorithm: "compact",
        }),
        credentials: "include",
      }),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      "/api/v1/tournaments/t1/bracket",
    );
  });
});
