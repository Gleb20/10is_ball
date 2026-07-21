import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { JudgePage } from "./JudgePage";

const getMatch = vi.fn();
const startMatch = vi.fn();
const acquireJudge = vi.fn();
const heartbeatJudge = vi.fn();
const releaseJudge = vi.fn();
const judgeSetup = vi.fn();
const awardPoint = vi.fn();
const undoPoint = vi.fn();
const confirmFinish = vi.fn();
const revertFinish = vi.fn();

vi.mock("../api", () => ({
  api: {
    getMatch: (...a: unknown[]) => getMatch(...a),
    startMatch: (...a: unknown[]) => startMatch(...a),
    acquireJudge: (...a: unknown[]) => acquireJudge(...a),
    heartbeatJudge: (...a: unknown[]) => heartbeatJudge(...a),
    releaseJudge: (...a: unknown[]) => releaseJudge(...a),
    judgeSetup: (...a: unknown[]) => judgeSetup(...a),
    awardPoint: (...a: unknown[]) => awardPoint(...a),
    undoPoint: (...a: unknown[]) => undoPoint(...a),
    confirmFinish: (...a: unknown[]) => confirmFinish(...a),
    revertFinish: (...a: unknown[]) => revertFinish(...a),
  },
}));

const matchBody = {
  id: "m1",
  status: "in_progress",
  scoreA: 3,
  scoreB: 2,
  version: 5,
  deuceMode: false,
  startedAt: "2026-07-21T10:00:00.000Z",
  currentServerParticipantId: "p-a",
  participants: [
    {
      id: "p-a",
      side: "A",
      guestFirstName: "Анна",
      guestLastName: "А",
    },
    {
      id: "p-b",
      side: "B",
      guestFirstName: "Борис",
      guestLastName: "Б",
    },
  ],
};

function renderJudge(path = "/matches/m1/judge") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/matches/:id/judge" element={<JudgePage />} />
        <Route path="/matches/:id" element={<div>match-detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("REQ_ui__judge_immersive", () => {
  beforeEach(() => {
    cleanup();
    getMatch.mockResolvedValue({ match: matchBody });
    startMatch.mockResolvedValue({ match: matchBody });
    acquireJudge.mockResolvedValue({ ok: true });
    heartbeatJudge.mockResolvedValue({ ok: true });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 844,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 390,
    });
  });

  it("shows scores, side names, serve badge with racket, timer and +1", async () => {
    renderJudge();
    expect(await screen.findByTestId("judge-screen")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Анна А")).toBeInTheDocument();
    expect(screen.getByText("Борис Б")).toBeInTheDocument();
    expect(screen.getByText("Подача")).toBeInTheDocument();
    expect(screen.getByTestId("serve-racket")).toBeInTheDocument();
    expect(screen.getByText(/0:00|:\d{2}/)).toBeInTheDocument();
    const sideA = screen.getByTestId("judge-side-A");
    expect(sideA).toContainElement(
      screen.getByRole("button", { name: /\+1 очко: анна а/i }),
    );
  });

  it("shows landscape hint in portrait", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    renderJudge();
    expect(
      await screen.findByText(/поверните устройство горизонтально/i),
    ).toBeInTheDocument();
  });

  it("shows blocked screen when acquire fails", async () => {
    acquireJudge.mockRejectedValue(
      Object.assign(new Error("Судейская сессия занята"), {
        code: "JUDGE_TAKEN",
        details: { currentJudge: { userId: "u2", displayName: "L F" } },
      }),
    );
    renderJudge();
    expect(await screen.findByTestId("judge-blocked")).toBeInTheDocument();
    expect(screen.getByText(/уже судит/i)).toBeInTheDocument();
  });

  it("awards point only via +1 button", async () => {
    const user = userEvent.setup();
    awardPoint.mockResolvedValue({
      match: { ...matchBody, scoreA: 4, version: 6 },
    });
    renderJudge();
    const btn = await screen.findByRole("button", {
      name: /\+1 очко: анна а/i,
    });
    await user.click(btn);
    expect(awardPoint).toHaveBeenCalledWith("m1", "A", 5, expect.any(String));
  });

  it("shows setup as board with swap and start match", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        version: 0,
        status: "waiting",
        startedAt: null,
      },
    });
    judgeSetup.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        status: "in_progress",
        startedAt: "2026-07-21T10:00:00.000Z",
      },
    });
    startMatch.mockResolvedValue({
      match: {
        ...matchBody,
        scoreA: 0,
        scoreB: 0,
        status: "in_progress",
        startedAt: null,
      },
    });
    renderJudge();
    expect(await screen.findByTestId("judge-setup")).toBeInTheDocument();
    expect(screen.getByTestId("judge-side-A")).toBeInTheDocument();
    expect(screen.getByTestId("judge-side-B")).toBeInTheDocument();
    const board = screen.getByRole("group", { name: /расположение и подача/i });
    expect(
      within(board).getByRole("button", { name: /поменять стороны/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("serve-racket")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\+1 очко/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("judge-side-B"));
    await user.click(screen.getByRole("button", { name: /начать матч/i }));
    expect(judgeSetup).toHaveBeenCalled();
  });

  it("exits to match detail after confirm finish", async () => {
    const user = userEvent.setup();
    getMatch.mockResolvedValue({
      match: { ...matchBody, status: "pending_confirmation" },
    });
    confirmFinish.mockResolvedValue({
      match: { ...matchBody, status: "finished" },
    });
    renderJudge();
    await screen.findByTestId("judge-screen");
    await user.click(
      screen.getByRole("button", { name: /подтвердить результат/i }),
    );
    expect(await screen.findByText("match-detail")).toBeInTheDocument();
  });
});
