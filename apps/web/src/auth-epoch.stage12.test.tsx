import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";
import { AUTH_UNAUTHORIZED_EVENT } from "./authEvents";
import type { User } from "./api";

const actorA: User = {
  id: "00000000-0000-4000-8000-000000001201",
  email: "actor-a@example.test",
  role: "admin",
  mustChangePassword: false,
};

const actorB: User = {
  ...actorA,
  id: "00000000-0000-4000-8000-000000001202",
  email: "actor-b@example.test",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
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

function Harness() {
  const { user, refresh, setUser } = useAuth();
  return (
    <>
      <output aria-label="current actor">{user?.id ?? "anonymous"}</output>
      <button onClick={() => void refresh()}>refresh</button>
      <button onClick={() => setUser(null)}>logout</button>
      <button onClick={() => setUser(actorB)}>actor B</button>
    </>
  );
}

describe("Stage 12 auth lifecycle epoch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["automatic 401", async (user: ReturnType<typeof userEvent.setup>) => {
      window.dispatchEvent(
        new CustomEvent(AUTH_UNAUTHORIZED_EVENT, {
          detail: { error: { status: 401, code: "UNAUTHORIZED" } },
        }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText("current actor")).toHaveTextContent("anonymous"),
      );
    }],
    ["explicit logout", async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "logout" }));
    }],
    ["new actor", async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: "actor B" }));
    }],
  ])("ignores a delayed refresh success after %s", async (_label, invalidate) => {
    const held = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ user: actorA }))
        .mockImplementationOnce(() => held.promise),
    );
    const user = userEvent.setup();
    render(<AuthProvider><Harness /></AuthProvider>);
    expect(await screen.findByLabelText("current actor")).toHaveTextContent(actorA.id);

    await user.click(screen.getByRole("button", { name: "refresh" }));
    await invalidate(user);
    await act(async () => {
      held.resolve(jsonResponse({ user: actorA }));
      await held.promise;
      await Promise.resolve();
    });

    const expectedActor = _label === "new actor" ? actorB.id : "anonymous";
    await waitFor(() =>
      expect(screen.getByLabelText("current actor")).toHaveTextContent(expectedActor),
    );
  });
});
