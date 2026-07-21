import { applyBracketResult } from "./apply.js";
import { deriveBracketMatchState, listReadyMatchIds } from "./derive-state.js";
import { getMatchSides } from "./derive-state.js";
import { propagateByesFixpoint } from "./resolve.js";
import {
  countCompetitiveMatchesPlayed,
  hasPermanentlyBlockedNodes,
  isBracketGraphComplete,
  validateBracketGraph,
} from "./validate.js";
import type { BracketGraphV2 } from "./types.js";

export type WinnerStrategy =
  | "alwaysA"
  | "alwaysB"
  | "lowerSeed"
  | "higherSeed"
  | { type: "rng"; next: () => number };

function pickWinner(
  graph: BracketGraphV2,
  matchId: string,
  strategy: WinnerStrategy,
): { winner: string; loser: string } {
  const match = graph.matches.find((m) => m.id === matchId)!;
  const sides = getMatchSides(graph, match);
  if (sides.a.kind !== "resolved" || sides.b.kind !== "resolved") {
    throw new Error(`Not ready ${matchId}`);
  }
  const a = sides.a.participantId;
  const b = sides.b.participantId;
  const seedA = graph.seedOrder.indexOf(a);
  const seedB = graph.seedOrder.indexOf(b);

  let winner = a;
  if (strategy === "alwaysB") winner = b;
  else if (strategy === "alwaysA") winner = a;
  else if (strategy === "lowerSeed") {
    winner = seedA <= seedB ? a : b;
  } else if (strategy === "higherSeed") {
    winner = seedA >= seedB ? a : b;
  } else if (typeof strategy === "object" && strategy.type === "rng") {
    winner = strategy.next() < 0.5 ? a : b;
  }
  const loser = winner === a ? b : a;
  return { winner, loser };
}

/** Simulate until complete or stuck. Returns final graph. */
export function simulateBracket(
  graph: BracketGraphV2,
  strategy: WinnerStrategy = "lowerSeed",
): BracketGraphV2 {
  validateBracketGraph(graph);
  let current = propagateByesFixpoint(graph);
  let guard = 0;
  while (!isBracketGraphComplete(current) && guard < 500) {
    guard += 1;
    current = propagateByesFixpoint(current);
    const ready = listReadyMatchIds(current);
    if (ready.length === 0) {
      if (hasPermanentlyBlockedNodes(current)) {
        throw new Error("SIM_STUCK_PERMANENT");
      }
      // Maybe only inactive GF2 and champion already set
      if (isBracketGraphComplete(current)) break;
      throw new Error("SIM_STUCK_NO_READY");
    }
    // Play first ready by displayNumber
    const ordered = [...ready].sort((a, b) => {
      const ma = current.matches.find((m) => m.id === a)!;
      const mb = current.matches.find((m) => m.id === b)!;
      return ma.displayNumber - mb.displayNumber;
    });
    const id = ordered[0]!;
    const { winner, loser } = pickWinner(current, id, strategy);
    current = applyBracketResult(current, {
      bracketMatchId: id,
      winnerParticipantId: winner,
      loserParticipantId: loser,
    });
  }
  if (!isBracketGraphComplete(current)) {
    throw new Error("SIM_INCOMPLETE");
  }
  return current;
}

export function assertSeInvariants(
  final: BracketGraphV2,
  n: number,
): void {
  if (!final.championParticipantId) throw new Error("no champ");
  const competitive = countCompetitiveMatchesPlayed(final);
  if (!final.thirdPlaceEnabled && competitive !== n - 1) {
    throw new Error(`SE competitive ${competitive} != ${n - 1}`);
  }
  if (final.thirdPlaceEnabled && competitive < n - 1) {
    throw new Error(`SE competitive too low ${competitive}`);
  }
}

export function assertDeInvariants(
  final: BracketGraphV2,
  n: number,
  _strategy: WinnerStrategy,
): void {
  if (!final.championParticipantId) throw new Error("no champ");
  const competitive = countCompetitiveMatchesPlayed(final);
  const gf2 = final.matches.find((m) => m.id === "GF2");
  const gf2Played = Boolean(gf2?.winnerParticipantId && gf2.loserParticipantId);
  const expected = gf2Played ? 2 * n - 1 : 2 * n - 2;
  if (competitive !== expected) {
    throw new Error(`DE competitive ${competitive} != ${expected}`);
  }
  const gf2State = gf2 ? deriveBracketMatchState(final, gf2.id) : "inactive";
  if (!gf2Played && gf2State !== "inactive") {
    throw new Error("GF2 should be inactive when not played");
  }
}
