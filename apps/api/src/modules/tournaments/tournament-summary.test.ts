import { describe, expect, it } from "vitest";
import { prepareBracketGraph, simulateBracket, generateSingleEliminationBracket, listMatchPairs, pairNeedsMatch, applyMatchResult, type BracketGraphV2 } from "@tab10/shared";
import { tournamentSummary } from "./tournament-summary.js";
const start = new Date("2026-09-13T10:00:00Z");
function fixture(format: BracketGraphV2["format"], n: number) {
  const graph = simulateBracket(prepareBracketGraph({ seedOrder: Array.from({ length: n }, (_, i) => `p${i + 1}`), format, constructionAlgorithm: "compact", thirdPlaceEnabled: format === "single_elimination" }));
  const matches = graph.matches.filter((m) => m.loserParticipantId).map((m) => ({ id: `actual-${m.id}`, tournamentSlotId: m.id, status: "finished", scoreA: 11, scoreB: 7 }));
  return { graph, matches };
}
describe("GAP-006 tournament outcome summary", () => {
  for (const format of ["single_elimination", "double_elimination"] as const) for (const n of [3, 5, 8]) {
    it(`AT-TRN-013 ${format}/${n}: places, actual points and played counts`, () => {
      const { graph, matches } = fixture(format, n);
      const result = tournamentSummary({ status: "finished", startedAt: start, finishedAt: new Date(+start + 90_000), bracketJson: graph }, graph.seedOrder, matches, new Date(+start + 120_000));
      expect(result.durationSeconds).toBe(90);
      expect(result.playedMatchCount).toBe(matches.length);
      expect(result.results.reduce((sum, row) => sum + row.points, 0)).toBe(matches.length * 18);
      expect(result.results.reduce((sum, row) => sum + row.playedMatches, 0)).toBe(matches.length * 2);
      expect(result.results.find((row) => row.participantId === graph.championParticipantId)?.place).toBe(1);
      expect(result.results.every((row) => row.place !== null)).toBe(true);
      expect(result.top3).toHaveLength(3);
    });
  }
  it("AT-TRN-012 stopped has points but no final places/top", () => {
    const { graph, matches } = fixture("double_elimination", 5);
    const result = tournamentSummary({ status: "stopped", startedAt: start, finishedAt: new Date(+start + 10_000), bracketJson: graph }, graph.seedOrder, matches, start);
    expect(result.top3).toEqual([]); expect(result.results.every((row) => row.place === null)).toBe(true);
    expect(result.playedMatchCount).toBe(matches.length);
  });
  it("D33 void keeps bracket placement but removes voided points and played count", () => {
    const { graph, matches } = fixture("single_elimination", 5);
    matches[0]!.status = "voided";
    const result = tournamentSummary({ status: "finished", startedAt: start, finishedAt: start, bracketJson: graph }, graph.seedOrder, matches, start);
    expect(result.top3).toHaveLength(3); expect(result.playedMatchCount).toBe(matches.length - 1);
    expect(result.results.reduce((sum, row) => sum + row.points, 0)).toBe((matches.length - 1) * 18);
  });
  it("collecting has no duration, and a running clock is injected", () => {
    expect(tournamentSummary({ status: "collecting", startedAt: null, finishedAt: null, bracketJson: null }, [], [], start).durationSeconds).toBeNull();
    expect(tournamentSummary({ status: "in_progress", startedAt: start, finishedAt: null, bracketJson: null }, [], [], new Date(+start + 10_000)).durationSeconds).toBe(10);
  });
});

it("GAP-006 exact V2 A/B point attribution is independent of winner and aggregate totals", () => {
  const graph = prepareBracketGraph({ seedOrder: ["a", "b", "c", "d"], format: "single_elimination", constructionAlgorithm: "power_of_two", thirdPlaceEnabled: true });
  const node = graph.matches.find((m) => m.sourceA.type === "seed" && m.sourceB.type === "seed")!;
  if (node.sourceA.type !== "seed" || node.sourceB.type !== "seed") throw new Error("fixture");
  const a = graph.seedOrder[node.sourceA.seed - 1]!;
  const b = graph.seedOrder[node.sourceB.seed - 1]!;
  const summary = tournamentSummary({ status: "in_progress", startedAt: start, finishedAt: null, bracketJson: graph }, graph.seedOrder, [{ id: "game", tournamentSlotId: node.id, status: "stopped", scoreA: 3, scoreB: 9 }], start);
  expect(summary.results.find((row) => row.participantId === a)).toMatchObject({ points: 3, playedMatches: 1 });
  expect(summary.results.find((row) => row.participantId === b)).toMatchObject({ points: 9, playedMatches: 1 });
  expect(summary.results.filter((row) => ![a, b].includes(row.participantId)).every((row) => row.points === 0 && row.playedMatches === 0)).toBe(true);
});
it("legacy V1 SE composite slots retain exact participant totals and podium", () => {
  let id = 0;
  let graph = generateSingleEliminationBracket(["a", "b", "c", "d"], () => `slot-${++id}`);
  const matches: Array<{ id: string; tournamentSlotId: string; status: string; scoreA: number; scoreB: number }> = [];
  const totals = new Map(["a", "b", "c", "d"].map((pid) => [pid, { points: 0, playedMatches: 0 }]));
  for (let step = 0; step < 10; step += 1) {
    const pair = listMatchPairs(graph).find(pairNeedsMatch);
    if (!pair) break;
    const a = pair.slotA.participantId!; const b = pair.slotB.participantId!;
    const actual = `actual-${step}`;
    totals.get(a)!.points += 11; totals.get(b)!.points += 4;
    totals.get(a)!.playedMatches += 1; totals.get(b)!.playedMatches += 1;
    matches.push({ id: actual, tournamentSlotId: `${pair.slotA.id},${pair.slotB.id}`, status: "finished", scoreA: 11, scoreB: 4 });
    graph = applyMatchResult(graph, [pair.slotA.id, pair.slotB.id], a, b, actual);
  }
  expect(graph.championParticipantId).toBeTruthy();
  const summary = tournamentSummary({ status: "finished", startedAt: start, finishedAt: start, bracketJson: graph }, [...totals.keys()], matches, start);
  for (const row of summary.results) expect(row).toMatchObject(totals.get(row.participantId)!);
  expect(summary.top3).toHaveLength(3); expect(summary.results.every((row) => row.place !== null)).toBe(true);
});
it("legacy-style SE without bronze preserves both tied third places without an invented tiebreak", () => {
  const graph = simulateBracket(prepareBracketGraph({ seedOrder: ["a", "b", "c", "d"], format: "single_elimination", constructionAlgorithm: "power_of_two", thirdPlaceEnabled: false }));
  const summary = tournamentSummary({ status: "finished", startedAt: start, finishedAt: start, bracketJson: graph }, graph.seedOrder, [], start);
  expect(summary.results.map((row) => row.place)).toEqual([1, 2, 3, 3]);
  expect(summary.top3).toHaveLength(4);
});
it("withdrawn historical roster rows do not shift the remaining finish places", () => {
  const { graph, matches } = fixture("single_elimination", 8);
  const tournament = { status: "finished", startedAt: start, finishedAt: start, bracketJson: graph };
  const normal = tournamentSummary(tournament, graph.seedOrder, matches, start);
  const withHistory = tournamentSummary(tournament, [...graph.seedOrder, "withdrawn"], matches, start);
  for (const row of normal.results) expect(withHistory.results.find((candidate) => candidate.participantId === row.participantId)?.place).toBe(row.place);
  expect(withHistory.results.find((row) => row.participantId === "withdrawn")?.place).toBeNull();
});
