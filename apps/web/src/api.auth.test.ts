import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("AT-AUTH-009 runtime unauthorized API handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("broadcasts the first protected 401, blocks request loops, and unlocks after login", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(401, {
          code: "UNAUTHORIZED",
          message: "Session expired",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: "u1",
            email: "player@tab10.local",
            role: "user",
            mustChangePassword: false,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { matches: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    window.addEventListener("tab10:auth-unauthorized", onUnauthorized);

    await expect(api.listMatches()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    await expect(api.listMatches()).rejects.toMatchObject({ status: 401 });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      api.login("player@tab10.local", "ValidPass1!"),
    ).resolves.toMatchObject({ user: { id: "u1" } });
    await expect(api.listMatches()).resolves.toEqual({ matches: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    window.removeEventListener("tab10:auth-unauthorized", onUnauthorized);
  });

  it("ignores a protected 401 from the previous auth generation after login succeeds", async () => {
    const oldSessionResponse = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldSessionResponse.promise)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: "new-user",
            email: "new@tab10.local",
            role: "user",
            mustChangePassword: false,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { matches: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    window.addEventListener("tab10:auth-unauthorized", onUnauthorized);

    const oldRequest = api.listMatches();
    await expect(api.login("new@tab10.local", "ValidPass1!")).resolves.toMatchObject({
      user: { id: "new-user" },
    });

    oldSessionResponse.resolve(
      jsonResponse(401, {
        code: "UNAUTHORIZED",
        message: "Old session expired",
      }),
    );
    await expect(oldRequest).rejects.toMatchObject({ status: 401 });

    expect(onUnauthorized).not.toHaveBeenCalled();
    await expect(api.listMatches()).resolves.toEqual({ matches: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    window.removeEventListener("tab10:auth-unauthorized", onUnauthorized);
  });
});
