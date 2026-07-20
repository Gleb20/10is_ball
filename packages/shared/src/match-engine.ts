import type { Side } from "./index.js";

export type MatchRules = {
  pointsToWin: number;
  mercyEnabled: boolean;
  mercyPoints: number | null;
  format: "1v1" | "2v2";
};

export type MatchScoreState = {
  scoreA: number;
  scoreB: number;
  deuceMode: boolean;
  /** Participant id currently serving (opaque string). */
  currentServerId: string | null;
  /** Index into serve rotation sequence. */
  serveSequenceIndex: number;
  status: "in_progress" | "pending_confirmation" | "finished";
  proposedWinner: Side | null;
  version: number;
};

export type PointAwarded = {
  type: "point_awarded";
  side: Side;
  idempotencyKey: string;
};

export type PointUndone = {
  type: "point_undone";
  idempotencyKey: string;
};

export type FinishProposed = {
  type: "finish_proposed";
  winner: Side;
};

export type FinishReverted = {
  type: "finish_reverted";
};

export type FinishConfirmed = {
  type: "finish_confirmed";
};

export type MatchEvent =
  | PointAwarded
  | PointUndone
  | FinishProposed
  | FinishReverted
  | FinishConfirmed;

export type ServeRotationConfig = {
  format: "1v1" | "2v2";
  /** Ordered participant ids: for 1v1 [A, B]; for 2v2 [A1, B1, A2, B2] simplified. */
  participantOrder: string[];
  firstServerId: string;
};

export function isDeuce(
  scoreA: number,
  scoreB: number,
  pointsToWin: number,
): boolean {
  return scoreA >= pointsToWin - 1 && scoreB >= pointsToWin - 1;
}

export function checkVictory(
  scoreA: number,
  scoreB: number,
  rules: MatchRules,
): Side | null {
  const { pointsToWin, mercyEnabled, mercyPoints } = rules;
  const deuce = isDeuce(scoreA, scoreB, pointsToWin);

  if (mercyEnabled && mercyPoints != null && !deuce) {
    if (scoreA >= mercyPoints && scoreA - scoreB >= mercyPoints) return "A";
    if (scoreB >= mercyPoints && scoreB - scoreA >= mercyPoints) return "B";
  }

  if (!deuce) {
    if (scoreA >= pointsToWin && scoreA - scoreB >= 2) return "A";
    if (scoreB >= pointsToWin && scoreB - scoreA >= 2) return "B";
    // AT-MATCH-001: 11:9 proposes finish; at threshold with lead of 2
    if (scoreA >= pointsToWin && scoreA - scoreB >= 1 && scoreB < pointsToWin - 1)
      return "A";
    if (scoreB >= pointsToWin && scoreB - scoreA >= 1 && scoreA < pointsToWin - 1)
      return "B";
    return null;
  }

  // Deuce: need lead of 2
  if (scoreA >= pointsToWin && scoreA - scoreB >= 2) return "A";
  if (scoreB >= pointsToWin && scoreB - scoreA >= 2) return "B";
  return null;
}

/**
 * Serve changes every 2 points before deuce, every 1 after deuce.
 * 2v2: simplified rotation through participantOrder.
 */
export function nextServerAfterPoint(
  state: MatchScoreState,
  config: ServeRotationConfig,
  rules: MatchRules,
): { serverId: string; serveSequenceIndex: number } {
  const totalPoints = state.scoreA + state.scoreB;
  const deuce = isDeuce(state.scoreA, state.scoreB, rules.pointsToWin);
  const interval = deuce ? 1 : 2;
  const order = config.participantOrder;
  const firstIdx = order.indexOf(config.firstServerId);
  const base = firstIdx >= 0 ? firstIdx : 0;
  const steps = Math.floor(totalPoints / interval);
  const idx = (base + steps) % order.length;
  return { serverId: order[idx]!, serveSequenceIndex: steps };
}

export type ReduceResult =
  | { ok: true; state: MatchScoreState; applied: boolean }
  | { ok: false; code: string; message: string };

export function createInitialScoreState(
  firstServerId: string | null,
): MatchScoreState {
  return {
    scoreA: 0,
    scoreB: 0,
    deuceMode: false,
    currentServerId: firstServerId,
    serveSequenceIndex: 0,
    status: "in_progress",
    proposedWinner: null,
    version: 0,
  };
}

/**
 * Pure event reducer. Tracks last point for Undo via history stack passed in.
 */
export function reduceMatchEvent(
  state: MatchScoreState,
  event: MatchEvent,
  rules: MatchRules,
  serveConfig: ServeRotationConfig,
  history: MatchEvent[],
  seenIdempotencyKeys: Set<string>,
): ReduceResult {
  if (state.status === "finished") {
    return { ok: false, code: "MATCH_IMMUTABLE", message: "Match is finished" };
  }

  if (event.type === "point_awarded") {
    if (state.status === "pending_confirmation") {
      return {
        ok: false,
        code: "FINISH_PENDING",
        message: "Confirm or revert finish first",
      };
    }
    if (seenIdempotencyKeys.has(event.idempotencyKey)) {
      return { ok: true, state, applied: false };
    }
    const next: MatchScoreState = {
      ...state,
      scoreA: state.scoreA + (event.side === "A" ? 1 : 0),
      scoreB: state.scoreB + (event.side === "B" ? 1 : 0),
      version: state.version + 1,
    };
    next.deuceMode = isDeuce(next.scoreA, next.scoreB, rules.pointsToWin);
    const serve = nextServerAfterPoint(next, serveConfig, rules);
    next.currentServerId = serve.serverId;
    next.serveSequenceIndex = serve.serveSequenceIndex;

    const winner = checkVictory(next.scoreA, next.scoreB, rules);
    if (winner) {
      next.status = "pending_confirmation";
      next.proposedWinner = winner;
    }
    seenIdempotencyKeys.add(event.idempotencyKey);
    history.push(event);
    return { ok: true, state: next, applied: true };
  }

  if (event.type === "point_undone") {
    if (state.status === "pending_confirmation") {
      // Undo also clears pending finish if last point caused it
    }
    if (seenIdempotencyKeys.has(event.idempotencyKey)) {
      return { ok: true, state, applied: false };
    }
    // Find last point_awarded and rebuild
    let lastIdx = -1;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]!.type === "point_awarded") {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx < 0) {
      return { ok: false, code: "NOTHING_TO_UNDO", message: "No points to undo" };
    }
    const priorEvents = history.slice(0, lastIdx);
    let rebuilt = createInitialScoreState(serveConfig.firstServerId);
    const keys = new Set<string>();
    const tempHistory: MatchEvent[] = [];
    for (const e of priorEvents) {
      const r = reduceMatchEvent(rebuilt, e, rules, serveConfig, tempHistory, keys);
      if (r.ok) rebuilt = r.state;
    }
    seenIdempotencyKeys.add(event.idempotencyKey);
    history.length = 0;
    history.push(...tempHistory, event);
    rebuilt.version = state.version + 1;
    return { ok: true, state: rebuilt, applied: true };
  }

  if (event.type === "finish_proposed") {
    if (state.status !== "in_progress" && state.status !== "pending_confirmation") {
      return { ok: false, code: "INVALID_STATUS", message: "Cannot propose finish" };
    }
    return {
      ok: true,
      state: {
        ...state,
        status: "pending_confirmation",
        proposedWinner: event.winner,
        version: state.version + 1,
      },
      applied: true,
    };
  }

  if (event.type === "finish_reverted") {
    if (state.status !== "pending_confirmation") {
      return { ok: false, code: "INVALID_STATUS", message: "No finish to revert" };
    }
    return {
      ok: true,
      state: {
        ...state,
        status: "in_progress",
        proposedWinner: null,
        version: state.version + 1,
      },
      applied: true,
    };
  }

  if (event.type === "finish_confirmed") {
    if (state.status !== "pending_confirmation" || !state.proposedWinner) {
      return { ok: false, code: "INVALID_STATUS", message: "Nothing to confirm" };
    }
    return {
      ok: true,
      state: {
        ...state,
        status: "finished",
        version: state.version + 1,
      },
      applied: true,
    };
  }

  return { ok: false, code: "UNKNOWN_EVENT", message: "Unknown event" };
}
