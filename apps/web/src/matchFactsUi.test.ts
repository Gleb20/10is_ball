import { describe, expect, it } from "vitest";
import type { MatchFacts } from "@tab10/shared";
import {
  acceptMatchFacts,
  eventProvenance,
  firstServerLabel,
  freezeMatchFacts,
  playingClockView,
} from "./matchFactsUi";

const facts = (overrides: Partial<MatchFacts> = {}): MatchFacts => ({
  initialServer: { state: "known", participantId: "11111111-1111-4111-8111-111111111111" },
  playingClock: {
    state: "available",
    elapsedMs: 12_000,
    running: true,
    asOf: "2026-10-03T09:00:00.000Z",
  },
  judgeHistory: {
    state: "complete",
    sessions: [{
      id: "22222222-2222-4222-8222-222222222222",
      userId: "33333333-3333-4333-8333-333333333333",
      displayName: "Судья Тест",
      startedAt: "2026-10-03T08:55:00.000Z",
      endedAt: null,
    }],
  },
  ...overrides,
});

describe("GAP-032 match facts UI model", () => {
  it("projects a running clock from monotonic receipt time and never regresses on a same-version refresh", () => {
    const first = acceptMatchFacts(null, facts(), 7, "in_progress", 1_000);
    expect(playingClockView(first, 4_500)).toMatchObject({
      state: "available",
      elapsedMs: 15_500,
      running: true,
      certainty: "fresh",
    });

    const refreshed = acceptMatchFacts(first, facts({
      playingClock: {
        state: "available",
        elapsedMs: 13_000,
        running: true,
        asOf: "2026-10-03T09:00:01.000Z",
      },
    }), 7, "in_progress", 4_500);

    const refreshedClock = playingClockView(refreshed, 4_500);
    expect(refreshedClock.state).toBe("available");
    if (refreshedClock.state === "available") {
      expect(refreshedClock.elapsedMs).toBe(15_500);
    }
  });

  it("freezes while a mutation outcome is being checked and resumes only from a fresh detail", () => {
    const running = acceptMatchFacts(null, facts(), 7, "in_progress", 1_000);
    const checking = freezeMatchFacts(running, 3_500);

    expect(playingClockView(checking, 20_000)).toMatchObject({
      elapsedMs: 14_500,
      running: false,
      certainty: "checking",
    });

    const stopped = acceptMatchFacts(checking, facts({
      playingClock: {
        state: "available",
        elapsedMs: 14_125,
        running: false,
        asOf: "2026-10-03T09:00:04.000Z",
      },
    }), 8, "stopped", 20_000);
    expect(playingClockView(stopped, 30_000)).toMatchObject({
      elapsedMs: 14_125,
      running: false,
      certainty: "fresh",
    });
  });

  it("renders explicit initial-server states without guessing from current serve", () => {
    const participants = [
      { id: "11111111-1111-4111-8111-111111111111", displayName: "Анна" },
    ];
    expect(firstServerLabel(facts().initialServer, participants)).toBe("Анна");
    expect(firstServerLabel({ state: "not_selected" }, participants)).toBe("Ещё не выбран");
    expect(firstServerLabel({ state: "unavailable" }, participants)).toBe("Недоступно");
    expect(firstServerLabel({ state: "known", participantId: "missing" }, participants)).toBe("Участник недоступен");
  });

  it("attributes an event only when both exact session and actor account match", () => {
    const snapshot = acceptMatchFacts(null, facts(), 7, "in_progress", 0);
    const exact = eventProvenance({
      occurredAt: "2026-10-03T09:01:02.000Z",
      actorUserId: "33333333-3333-4333-8333-333333333333",
      judgeSessionId: "22222222-2222-4222-8222-222222222222",
    }, snapshot);
    expect(exact).toMatchObject({ state: "known", displayName: "Судья Тест" });

    expect(eventProvenance({
      occurredAt: "2026-10-03T09:01:02.000Z",
      actorUserId: "different-user",
      judgeSessionId: "22222222-2222-4222-8222-222222222222",
    }, snapshot)).toEqual({ state: "unavailable" });
    expect(eventProvenance({}, snapshot)).toEqual({ state: "unavailable" });
  });

  it("keeps an unavailable clock unavailable instead of reconstructing legacy wall time", () => {
    const snapshot = acceptMatchFacts(null, facts({
      playingClock: { state: "unavailable" },
    }), 2, "finished", 100);
    expect(playingClockView(snapshot, 10_000)).toEqual({
      state: "unavailable",
      certainty: "fresh",
    });
  });
});
