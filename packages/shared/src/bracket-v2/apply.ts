import { deriveBracketMatchState, getMatchSides } from "./derive-state.js";
import { propagateByesFixpoint } from "./resolve.js";
import { isBracketGraphComplete } from "./validate.js";
import type { BracketGraphV2 } from "./types.js";

export function applyBracketResult(
  graph: BracketGraphV2,
  input: {
    bracketMatchId: string;
    winnerParticipantId: string;
    loserParticipantId: string;
    actualMatchId?: string | null;
  },
): BracketGraphV2 {
  const match = graph.matches.find((m) => m.id === input.bracketMatchId);
  if (!match) throw new Error(`MATCH_NOT_FOUND:${input.bracketMatchId}`);

  const state = deriveBracketMatchState(graph, match.id);
  if (state === "inactive") throw new Error("MATCH_INACTIVE");
  if (state === "cancelled") throw new Error("MATCH_CANCELLED");

  // Idempotent same result
  if (
    match.winnerParticipantId === input.winnerParticipantId &&
    match.loserParticipantId === input.loserParticipantId
  ) {
    return graph;
  }

  if (match.winnerParticipantId && match.winnerParticipantId !== input.winnerParticipantId) {
    throw new Error("RESULT_CONFLICT");
  }

  const sides = getMatchSides(graph, match);
  if (sides.a.kind !== "resolved" || sides.b.kind !== "resolved") {
    throw new Error("SIDES_NOT_READY");
  }
  const ids = new Set([sides.a.participantId, sides.b.participantId]);
  if (!ids.has(input.winnerParticipantId) || !ids.has(input.loserParticipantId)) {
    throw new Error("PARTICIPANT_MISMATCH");
  }
  if (input.winnerParticipantId === input.loserParticipantId) {
    throw new Error("WINNER_LOSER_SAME");
  }

  const matches = graph.matches.map((m) =>
    m.id === input.bracketMatchId
      ? {
          ...m,
          winnerParticipantId: input.winnerParticipantId,
          loserParticipantId: input.loserParticipantId,
          actualMatchId: input.actualMatchId ?? m.actualMatchId,
        }
      : { ...m },
  );

  let next: BracketGraphV2 = { ...graph, matches };
  next = propagateByesFixpoint(next);
  next = updatePlacements(next);
  return next;
}

function updatePlacements(graph: BracketGraphV2): BracketGraphV2 {
  let championParticipantId = graph.championParticipantId;
  let runnerUpParticipantId = graph.runnerUpParticipantId;
  let thirdPlaceParticipantId = graph.thirdPlaceParticipantId;

  if (graph.format === "single_elimination") {
    const finals = graph.matches.filter(
      (m) => m.stage === "winners",
    );
    const maxRound = Math.max(...finals.map((m) => m.roundIndex));
    const final = finals.find((m) => m.roundIndex === maxRound);
    if (final?.winnerParticipantId && final.loserParticipantId) {
      championParticipantId = final.winnerParticipantId;
      runnerUpParticipantId = final.loserParticipantId;
    }
    const tp = graph.matches.find((m) => m.stage === "third_place");
    if (tp?.winnerParticipantId) {
      thirdPlaceParticipantId = tp.winnerParticipantId;
    }
  } else {
    const gf1 = graph.matches.find((m) => m.id === "GF1");
    const gf2 = graph.matches.find((m) => m.id === "GF2");
    const gf2State = gf2 ? deriveBracketMatchState(graph, gf2.id) : "inactive";

    if (gf2State === "completed" && gf2?.winnerParticipantId) {
      championParticipantId = gf2.winnerParticipantId;
      runnerUpParticipantId = gf2.loserParticipantId;
    } else if (
      gf1?.winnerParticipantId &&
      gf2State === "inactive"
    ) {
      championParticipantId = gf1.winnerParticipantId;
      runnerUpParticipantId = gf1.loserParticipantId;
    }
  }

  return {
    ...graph,
    championParticipantId,
    runnerUpParticipantId,
    thirdPlaceParticipantId,
  };
}

export { isBracketGraphComplete };
