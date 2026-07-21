import { describe, expect, it } from "vitest";
import {
  applyBracketResult,
  applyMatchResult,
  generateDoubleEliminationBracket,
  generateSingleEliminationBracket,
  generateSingleEliminationV2,
  getMatchSides,
  listMatchPairs,
  type Bracket,
} from "@tab10/shared";
import {
  buildBracketViewModel,
  buildBracketViewModelV2,
  challongeRoundLabel,
  liveMatchVersusLabel,
  resolvePlayerFate,
} from "./bracketViewModel";

describe("challongeRoundLabel", () => {
  it("labels SE rounds like Challonge", () => {
    expect(challongeRoundLabel(8, 0, "main")).toBe("1/4");
    expect(challongeRoundLabel(8, 1, "main")).toBe("1/2");
    expect(challongeRoundLabel(8, 2, "main")).toBe("Финал");
    expect(challongeRoundLabel(4, 0, "final")).toBe("Гранд-финал");
  });
});

describe("resolvePlayerFate", () => {
  it("marks SE early-round loser as eliminated", () => {
    const bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"],
      () => crypto.randomUUID(),
    );
    const byId = new Map(bracket.slots.map((s) => [s.id, s]));
    const r0 = listMatchPairs(bracket).find(
      (p) => p.side === "main" && p.round === 0 && !p.slotA.isBye,
    )!;
    expect(
      resolvePlayerFate(r0.slotA, false, true, byId),
    ).toBe("eliminated");
    expect(
      resolvePlayerFate(r0.slotA, true, true, byId),
    ).toBe("advance");
  });

  it("marks DE winners-bracket loser as drop", () => {
    const bracket = generateDoubleEliminationBracket(
      ["p1", "p2", "p3", "p4"],
      () => crypto.randomUUID(),
    );
    const byId = new Map(bracket.slots.map((s) => [s.id, s]));
    const r0 = listMatchPairs(bracket).find(
      (p) => p.side === "main" && p.round === 0,
    )!;
    expect(r0.slotA.loserToSlotId).toBeTruthy();
    expect(
      resolvePlayerFate(r0.slotA, false, true, byId),
    ).toBe("drop");
  });

  it("marks DE losers-bracket loser as eliminated", () => {
    const bracket = generateDoubleEliminationBracket(
      ["p1", "p2", "p3", "p4"],
      () => crypto.randomUUID(),
    );
    const byId = new Map(bracket.slots.map((s) => [s.id, s]));
    const lb = listMatchPairs(bracket).find((p) => p.side === "losers")!;
    expect(lb.slotA.loserToSlotId).toBeNull();
    expect(
      resolvePlayerFate(lb.slotA, false, true, byId),
    ).toBe("eliminated");
  });
});

describe("liveMatchVersusLabel", () => {
  it("resolves names from tournamentSlotId", () => {
    let n = 0;
    const bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3", "p4"],
      () => `s_${++n}`,
    );
    const withPlayers = bracket.slots.filter(
      (s) => s.round === 0 && s.side === "main" && s.participantId,
    );
    const a = withPlayers[0]!;
    const b = withPlayers.find(
      (s) => s.advancesToSlotId === a.advancesToSlotId && s.id !== a.id,
    )!;
    const names = new Map([
      ["p1", "Альфа"],
      ["p2", "Бета"],
      ["p3", "Гамма"],
      ["p4", "Дельта"],
    ]);
    const label = liveMatchVersusLabel(
      { tournamentSlotId: `${a.id},${b.id}` },
      bracket,
      names,
    );
    expect(label).toContain(" vs ");
    expect(label).not.toBe("Матч");
  });
});

describe("buildBracketViewModel", () => {
  it("builds named cards for 4-player SE with judge CTA and bands", () => {
    const ids = ["p1", "p2", "p3", "p4"];
    const bracket = generateSingleEliminationBracket(ids, () =>
      crypto.randomUUID(),
    ) as Bracket;
    const r0 = bracket.slots.filter(
      (s) => s.round === 0 && s.side === "main",
    );
    expect(r0.length).toBeGreaterThanOrEqual(2);
    const matchId = "m-r0-0";
    r0[0]!.matchId = matchId;
    r0[1]!.matchId = matchId;
    r0[0]!.participantId = "p1";
    r0[1]!.participantId = "p2";

    const names = new Map([
      ["p1", "Альфа А"],
      ["p2", "Бета Б"],
      ["p3", "Гамма Г"],
      ["p4", "Дельта Д"],
    ]);
    const vm = buildBracketViewModel(
      bracket,
      names,
      [{ id: matchId, status: "waiting", scoreA: 0, scoreB: 0 }],
      {
        avatars: { p1: "avatar_1", p2: "avatar_2" },
        seeds: { p1: 1, p2: 2 },
      },
    );

    expect(vm.bands.some((b) => b.id === "winners")).toBe(true);
    const named = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .find((c) => c.matchId === matchId);
    expect(named).toBeTruthy();
    expect(named!.slotA.displayName).toBe("Альфа А");
    expect(named!.slotA.avatarKey).toBe("avatar_1");
    expect(named!.slotA.seed).toBe(1);
    expect(named!.cta).toBe("judge");
    expect(named!.pairsInRound).toBeGreaterThanOrEqual(1);
  });

  it("BYE card shows auto-advance name", () => {
    const bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3"],
      () => crypto.randomUUID(),
    );
    const names = new Map([
      ["p1", "Иван"],
      ["p2", "Пётр"],
      ["p3", "Сидор"],
    ]);
    const vm = buildBracketViewModel(bracket, names, []);
    const byeCard = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .find((c) => c.cta === "bye");
    expect(byeCard).toBeTruthy();
    expect(byeCard!.autoAdvanceName).toBeTruthy();
    expect(byeCard!.decided).toBe(true);
  });

  it("finished SE match: winner advances, loser eliminated, feedsTo next card", () => {
    let n = 0;
    let bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3", "p4"],
      () => `s_${++n}`,
    );
    const pair = listMatchPairs(bracket).find(
      (p) =>
        p.side === "main" &&
        p.round === 0 &&
        p.slotA.participantId &&
        p.slotB.participantId,
    )!;
    const winner = pair.slotA.participantId!;
    const loser = pair.slotB.participantId!;
    bracket = applyMatchResult(
      bracket,
      [pair.slotA.id, pair.slotB.id],
      winner,
      loser,
      "m1",
    );
    const names = new Map([
      ["p1", "A"],
      ["p2", "B"],
      ["p3", "C"],
      ["p4", "D"],
    ]);
    const vm = buildBracketViewModel(bracket, names, [
      { id: "m1", status: "finished", scoreA: 5, scoreB: 2 },
    ]);
    const card = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .find((c) => c.matchId === "m1");
    expect(card).toBeTruthy();
    expect(card!.slotA.isWinner).toBe(true);
    expect(card!.slotA.fate).toBe("advance");
    // SE size 4: R0 losers go to third-place → drop, not eliminated
    expect(card!.slotB.fate).toBe("drop");
    expect(card!.feedsToCardKey).toBeTruthy();
  });
});

describe("buildBracketViewModelV2", () => {
  it("renders SE V2 seed names and winners band", () => {
    const graph = generateSingleEliminationV2({
      seedOrder: ["p1", "p2", "p3", "p4"],
      thirdPlaceEnabled: true,
    });
    const names = new Map([
      ["p1", "A"],
      ["p2", "B"],
      ["p3", "C"],
      ["p4", "D"],
    ]);
    const vm = buildBracketViewModelV2(graph, names, []);
    expect(vm.bands.some((b) => b.id === "winners")).toBe(true);
    const namesOnCards = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .flatMap((c) => [c.slotA.displayName, c.slotB.displayName]);
    expect(namesOnCards).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
  });

  it("wires feedsToCardKey after applyBracketResult", () => {
    let graph = generateSingleEliminationV2({
      seedOrder: ["p1", "p2", "p3", "p4"],
      thirdPlaceEnabled: false,
    });
    const sides = getMatchSides(
      graph,
      graph.matches.find((m) => m.id === "W0_0")!,
    );
    expect(sides.a.kind).toBe("resolved");
    expect(sides.b.kind).toBe("resolved");
    const a = (sides.a as { participantId: string }).participantId;
    const b = (sides.b as { participantId: string }).participantId;
    graph = applyBracketResult(graph, {
      bracketMatchId: "W0_0",
      winnerParticipantId: a,
      loserParticipantId: b,
      actualMatchId: "m1",
    });
    const names = new Map([
      ["p1", "A"],
      ["p2", "B"],
      ["p3", "C"],
      ["p4", "D"],
    ]);
    const vm = buildBracketViewModelV2(graph, names, [
      { id: "m1", status: "finished", scoreA: 5, scoreB: 2 },
    ]);
    const card = vm.bands
      .flatMap((b) => b.columns)
      .flatMap((c) => c.cards)
      .find((c) => c.key === "W0_0");
    expect(card?.slotA.isWinner).toBe(true);
    expect(card?.slotA.fate).toBe("advance");
    expect(card?.slotB.fate).toBe("eliminated");
    expect(card?.feedsToCardKey).toBe("W1_0");
  });

  it("liveMatchVersusLabel resolves V2 node id", () => {
    const graph = generateSingleEliminationV2({
      seedOrder: ["p1", "p2", "p3", "p4"],
      thirdPlaceEnabled: false,
    });
    const names = new Map([
      ["p1", "A"],
      ["p2", "B"],
      ["p3", "C"],
      ["p4", "D"],
    ]);
    const label = liveMatchVersusLabel(
      { tournamentSlotId: "W0_0" },
      graph,
      names,
    );
    expect(label).toMatch(/ vs /);
  });
});
