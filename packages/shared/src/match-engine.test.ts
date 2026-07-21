import { describe, expect, it } from "vitest";
import {
  checkVictory,
  createInitialScoreState,
  isDeuce,
  reduceMatchEvent,
  type MatchRules,
  type ServeRotationConfig,
} from "./match-engine.js";

const rules11: MatchRules = {
  pointsToWin: 11,
  mercyEnabled: false,
  mercyPoints: null,
  format: "1v1",
};

const serve: ServeRotationConfig = {
  format: "1v1",
  participantOrder: ["pA", "pB"],
  firstServerId: "pA",
};

describe("REQ_MATCH__winner_rules", () => {
  it("AT-MATCH-001: 11:9 proposes finish; 11:10 does not", () => {
    expect(checkVictory(11, 9, rules11)).toBe("A");
    expect(checkVictory(11, 10, rules11)).toBeNull();
  });

  it("AT-MATCH-002: deuce continues until lead of 2", () => {
    expect(isDeuce(10, 10, 11)).toBe(true);
    expect(checkVictory(11, 10, rules11)).toBeNull();
    expect(checkVictory(12, 10, rules11)).toBe("A");
  });

  it("AT-MATCH-004: mercy only at exact 5:0 / 0:5", () => {
    const mercy: MatchRules = {
      ...rules11,
      mercyEnabled: true,
      mercyPoints: 5,
    };
    expect(checkVictory(5, 0, mercy)).toBe("A");
    expect(checkVictory(0, 5, mercy)).toBe("B");
    expect(checkVictory(5, 1, mercy)).toBeNull();
    expect(checkVictory(6, 1, mercy)).toBeNull();
    expect(checkVictory(5, 0, rules11)).toBeNull();
  });
});

describe("REQ_MATCH__undo_and_idempotency", () => {
  it("AT-MATCH-005: undo restores previous score", () => {
    let state = createInitialScoreState("pA");
    const history: Parameters<typeof reduceMatchEvent>[4] = [];
    const keys = new Set<string>();

    let r = reduceMatchEvent(
      state,
      { type: "point_awarded", side: "A", idempotencyKey: "k1" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok && r.state.scoreA).toBe(1);
    if (r.ok) state = r.state;

    r = reduceMatchEvent(
      state,
      { type: "point_undone", idempotencyKey: "u1" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok && r.state.scoreA).toBe(0);
    expect(r.ok && r.state.scoreB).toBe(0);
  });

  it("AT-MATCH-005b: undo after prior undo removes exactly one point", () => {
    let state = createInitialScoreState("pA");
    const history: Parameters<typeof reduceMatchEvent>[4] = [];
    const keys = new Set<string>();

    for (const key of ["a1", "a2"]) {
      const r = reduceMatchEvent(
        state,
        { type: "point_awarded", side: "A", idempotencyKey: key },
        rules11,
        serve,
        history,
        keys,
      );
      expect(r.ok).toBe(true);
      if (r.ok) state = r.state;
    }
    expect(state.scoreA).toBe(2);

    let r = reduceMatchEvent(
      state,
      { type: "point_undone", idempotencyKey: "u1" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok && r.state.scoreA).toBe(1);
    if (r.ok) state = r.state;

    r = reduceMatchEvent(
      state,
      { type: "point_awarded", side: "A", idempotencyKey: "a3" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok && r.state.scoreA).toBe(2);
    if (r.ok) state = r.state;

    r = reduceMatchEvent(
      state,
      { type: "point_undone", idempotencyKey: "u2" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok && r.state.scoreA).toBe(1);
    expect(r.ok && r.state.scoreB).toBe(0);
  });

  it("AT-MATCH-006: duplicate idempotency key does not double score", () => {
    let state = createInitialScoreState("pA");
    const history: Parameters<typeof reduceMatchEvent>[4] = [];
    const keys = new Set<string>();
    const ev = {
      type: "point_awarded" as const,
      side: "A" as const,
      idempotencyKey: "same",
    };
    let r = reduceMatchEvent(state, ev, rules11, serve, history, keys);
    if (r.ok) state = r.state;
    r = reduceMatchEvent(state, ev, rules11, serve, history, keys);
    expect(r.ok && r.applied).toBe(false);
    expect(r.ok && r.state.scoreA).toBe(1);
  });

  it("AT-MATCH-008: after confirm, mutations rejected", () => {
    let state = createInitialScoreState("pA");
    state = {
      ...state,
      scoreA: 11,
      scoreB: 5,
      status: "pending_confirmation",
      proposedWinner: "A",
    };
    const history: Parameters<typeof reduceMatchEvent>[4] = [];
    const keys = new Set<string>();
    let r = reduceMatchEvent(
      state,
      { type: "finish_confirmed" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok && r.state.status).toBe("finished");
    if (r.ok) state = r.state;
    r = reduceMatchEvent(
      state,
      { type: "point_awarded", side: "B", idempotencyKey: "x" },
      rules11,
      serve,
      history,
      keys,
    );
    expect(r.ok).toBe(false);
  });
});
