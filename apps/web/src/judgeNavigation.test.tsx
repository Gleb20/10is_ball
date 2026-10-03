import { useCallback, useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RouterProvider,
  createMemoryRouter,
  useLocation,
} from "react-router-dom";
import {
  JudgeNavigationBridge,
  type JudgeBlockedPop,
  useJudgeNavigationController,
  useNativeJudgeExitNotice,
} from "./judgeNavigation";

const NativeRequest = globalThis.Request;

beforeAll(() => {
  // jsdom supplies a different AbortSignal brand than Node's Request accepts.
  // These routes have no loaders, so the navigation test can omit that signal.
  globalThis.Request = class RouterTestRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init ? { ...init, signal: undefined } : init);
    }
  };
});

afterAll(() => {
  globalThis.Request = NativeRequest;
});

function Harness({ onBlocked }: { onBlocked: (blocked: JudgeBlockedPop) => void }) {
  const location = useLocation();
  const notice = useNativeJudgeExitNotice(location.key);
  useJudgeNavigationController({
    shouldBlock: useCallback(
      ({ action, currentPath, nextPath }) =>
        action === "POP" && currentPath.endsWith("/judge") && currentPath !== nextPath,
      [],
    ),
    onBlocked,
  });
  return (
    <div>
      <span data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</span>
      {notice ? <span role="status">{notice.message}</span> : null}
    </div>
  );
}

function createHarness(onBlocked: (blocked: JudgeBlockedPop) => void) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <JudgeNavigationBridge>
            <Harness onBlocked={onBlocked} />
          </JudgeNavigationBridge>
        ),
      },
    ],
    {
      initialEntries: [
        "/history?role=judge#match-m1",
        "/matches/m1/judge",
      ],
      initialIndex: 1,
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("judge native navigation bridge", () => {
  it("holds the original POP and resumes its exact history entry with one notice", async () => {
    let blocked: JudgeBlockedPop | undefined;
    const onBlocked = vi.fn((value: JudgeBlockedPop) => {
      blocked = value;
    });
    const router = createHarness(onBlocked);

    await act(async () => {
      void router.navigate(-1);
    });

    await waitFor(() => expect(onBlocked).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("location")).toHaveTextContent("/matches/m1/judge");

    await act(async () => {
      blocked?.proceed({ kind: "success", message: "Слот освобождён" });
    });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/history?role=judge#match-m1",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Слот освобождён");

    await act(async () => {
      await router.navigate(1);
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/matches/m1/judge");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("discards a stale controller cleanup without unregistering its replacement", async () => {
    const calls: string[] = [];

    function ReplacingHarness() {
      const location = useLocation();
      const [generation, setGeneration] = useState(1);
      useJudgeNavigationController({
        shouldBlock: () => true,
        onBlocked: (blocked) => {
          calls.push(String(generation));
          blocked.reset();
        },
      });
      return (
        <button type="button" onClick={() => setGeneration(2)}>
          {location.pathname}:{generation}
        </button>
      );
    }

    const router = createMemoryRouter(
      [{ path: "*", element: <JudgeNavigationBridge><ReplacingHarness /></JudgeNavigationBridge> }],
      { initialEntries: ["/source", "/judge"], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);
    screen.getByRole("button").click();

    await act(async () => {
      void router.navigate(-1);
    });
    await waitFor(() => expect(calls).toEqual(["2"]));
    expect(router.state.location.pathname).toBe("/judge");
  });
});
