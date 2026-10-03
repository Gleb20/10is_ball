import { describe, expect, it } from "vitest";
import {
  applyBracketResult,
  buildDestinationIndex,
  deriveBracketMatchState,
  generateSingleEliminationBracket,
  getMatchSides,
  prepareBracketGraph,
  type BracketGraphV2,
  type BracketMatchNode,
} from "@tab10/shared";
import {
  buildBracketViewModel,
  buildBracketViewModelV2,
} from "./bracketViewModel";

const sizes = [3, 4, 5, 8, 9, 16, 32, 64] as const;
const formats = ["single_elimination", "double_elimination"] as const;
const algorithms = ["compact", "power_of_two"] as const;

function graphFor(
  format: (typeof formats)[number],
  constructionAlgorithm: (typeof algorithms)[number],
  size: number,
) {
  return prepareBracketGraph({
    seedOrder: Array.from({ length: size }, (_, index) => `p${index + 1}`),
    format,
    constructionAlgorithm,
    thirdPlaceEnabled: format === "single_elimination",
  });
}

function allCards(vm: ReturnType<typeof buildBracketViewModelV2>) {
  return vm.bands.flatMap((band) =>
    band.columns.flatMap((column) =>
      column.cards.map((card) => ({ card, bandId: band.id })),
    ),
  );
}

function play(
  graph: BracketGraphV2,
  node: BracketMatchNode,
  winnerSide: "a" | "b" = "a",
) {
  const sides = getMatchSides(graph, node);
  if (sides.a.kind !== "resolved" || sides.b.kind !== "resolved") {
    throw new Error(`Fixture node is not ready: ${node.id}`);
  }
  const winner = winnerSide === "a" ? sides.a.participantId : sides.b.participantId;
  const loser = winnerSide === "a" ? sides.b.participantId : sides.a.participantId;
  return applyBracketResult(graph, {
    bracketMatchId: node.id,
    winnerParticipantId: winner,
    loserParticipantId: loser,
    actualMatchId: `actual-${node.id}`,
  });
}

describe("Stage 8 W1 bracket graph view model", () => {
  it("keeps legacy SE potential winner and bronze paths mapped to exact slots", () => {
    let sequence = 0;
    const bracket = generateSingleEliminationBracket(
      ["p1", "p2", "p3", "p4"],
      () => `slot-${++sequence}`,
    );
    const vm = buildBracketViewModel(bracket, {}, []);
    const semifinal = allCards(vm).find(
      ({ card }) => card.side === "main" && card.round === 0,
    )!.card;
    const edges = vm.edges.filter(
      (edge) => edge.sourceCardKey === semifinal.key,
    );

    expect(edges.map((edge) => edge.outcome).sort()).toEqual([
      "loser",
      "winner",
    ]);
    for (const edge of edges) {
      const destination = allCards(vm).find(
        ({ card }) => card.key === edge.destinationCardKey,
      )!.card;
      const destinationSlot = edge.destinationSide === "a"
        ? destination.slotA.slotId
        : destination.slotB.slotId;
      const sourceSlot = bracket.slots.find(
        (slot) => slot.id === semifinal.slotA.slotId,
      )!;
      expect(destinationSlot).toBe(
        edge.outcome === "winner"
          ? sourceSlot.advancesToSlotId
          : sourceSlot.loserToSlotId,
      );
    }
  });

  it.each(
    formats.flatMap((format) =>
      algorithms.flatMap((algorithm) =>
        sizes.map((size) => [format, algorithm, size] as const),
      ),
    ),
  )(
    "maps every visible %s/%s/%i source to its canonical destination side",
    (format, algorithm, size) => {
      const graph = graphFor(format, algorithm, size);
      const vm = buildBracketViewModelV2(graph, {}, []);
      const cards = allCards(vm);
      const cardsByKey = new Map(cards.map(({ card }) => [card.key, card]));
      const destinations = buildDestinationIndex(graph);

      expect(new Set(vm.edges.map((edge) => edge.key)).size).toBe(vm.edges.length);
      for (const edge of vm.edges) {
        expect(cardsByKey.has(edge.sourceCardKey)).toBe(true);
        expect(cardsByKey.has(edge.destinationCardKey)).toBe(true);
        const destination = graph.matches.find(
          (node) => node.id === edge.destinationCardKey,
        );
        expect(destination).toBeTruthy();
        const source = edge.destinationSide === "a"
          ? destination!.sourceA
          : destination!.sourceB;
        expect(source).toEqual({
          type: edge.outcome,
          bracketMatchId: edge.sourceCardKey,
        });
      }

      for (const source of graph.matches) {
        if (!cardsByKey.has(source.id)) continue;
        const sides = getMatchSides(graph, source);
        const competitive =
          sides.a.kind !== "structurally_empty" &&
          sides.b.kind !== "structurally_empty";
        for (const [outcome, destination] of [
          ["winner", destinations.winners.get(source.id)],
          ["loser", destinations.losers.get(source.id)],
        ] as const) {
          if (!destination || !cardsByKey.has(destination.bracketMatchId)) continue;
          const expected = outcome === "winner" || competitive;
          expect(
            vm.edges.some(
              (edge) =>
                edge.sourceCardKey === source.id &&
                edge.outcome === outcome &&
                edge.destinationCardKey === destination.bracketMatchId &&
                edge.destinationSide === destination.position.toLowerCase(),
            ),
          ).toBe(expected);
        }
      }
    },
  );

  it("exposes winner and bronze-drop destinations before either semifinal is played", () => {
    const graph = graphFor("single_elimination", "compact", 4);
    const vm = buildBracketViewModelV2(graph, {}, []);
    const semifinal = graph.matches.find(
      (node) => node.stage === "winners" && node.roundIndex === 0,
    )!;

    expect(vm.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCardKey: semifinal.id,
          outcome: "winner",
          destinationSide: expect.stringMatching(/^[ab]$/),
          resolvedSourceSide: null,
        }),
        expect.objectContaining({
          sourceCardKey: semifinal.id,
          outcome: "loser",
          destinationSide: expect.stringMatching(/^[ab]$/),
          resolvedSourceSide: null,
        }),
      ]),
    );
  });

  it("resolves winner and loser edge origins to opposite player rows after a result", () => {
    let graph = graphFor("single_elimination", "compact", 4);
    const semifinal = graph.matches.find(
      (node) => node.stage === "winners" && node.roundIndex === 0,
    )!;
    graph = play(graph, semifinal, "b");
    const vm = buildBracketViewModelV2(graph, {}, [
      { id: `actual-${semifinal.id}`, status: "finished" },
    ]);

    expect(
      vm.edges.find(
        (edge) =>
          edge.sourceCardKey === semifinal.id && edge.outcome === "winner",
      )?.resolvedSourceSide,
    ).toBe("b");
    expect(
      vm.edges.find(
        (edge) =>
          edge.sourceCardKey === semifinal.id && edge.outcome === "loser",
      )?.resolvedSourceSide,
    ).toBe("a");
  });

  it("omits the inactive reset final and reveals it without a fake match action only after GF1 activates it", () => {
    let graph = graphFor("double_elimination", "compact", 4);
    let vm = buildBracketViewModelV2(graph, {}, []);
    expect(deriveBracketMatchState(graph, "GF2")).toBe("inactive");
    expect(allCards(vm).some(({ card }) => card.key === "GF2")).toBe(false);
    expect(vm.edges.some((edge) => edge.destinationCardKey === "GF2")).toBe(false);

    while (deriveBracketMatchState(graph, "GF1") !== "ready") {
      const next = graph.matches
        .filter((node) => deriveBracketMatchState(graph, node.id) === "ready")
        .sort((a, b) => a.displayNumber - b.displayNumber)[0]!;
      graph = play(graph, next);
    }
    graph = play(graph, graph.matches.find((node) => node.id === "GF1")!, "b");
    vm = buildBracketViewModelV2(graph, {}, []);

    expect(deriveBracketMatchState(graph, "GF2")).toBe("ready");
    const reset = allCards(vm).find(({ card }) => card.key === "GF2")!.card;
    expect(reset.matchId).toBeNull();
    expect(reset.cta).toBe("pending");
    expect(vm.readyMatchCardKeys).not.toContain("GF2");
    expect(vm.edges.filter((edge) => edge.destinationCardKey === "GF2")).toHaveLength(2);
  });

  it("selects a materialized ready match from the earliest unfinished dependency stage", () => {
    let graph = graphFor("single_elimination", "compact", 8);
    graph = play(graph, graph.matches.find((node) => node.id === "W0_0")!);
    graph = play(graph, graph.matches.find((node) => node.id === "W0_1")!);
    graph = {
      ...graph,
      matches: graph.matches.map((node) =>
        node.id === "W0_2" || node.id === "W1_0"
          ? { ...node, actualMatchId: `actual-${node.id}` }
          : node,
      ),
    };

    const vm = buildBracketViewModelV2(graph, {}, [
      { id: "actual-W0_2", status: "waiting" },
      { id: "actual-W1_0", status: "in_progress" },
    ]);

    expect(vm.readyMatchCardKeys).toEqual(["W0_2", "W1_0"]);
    expect(vm.workingMatchCardKey).toBe("W0_2");
  });

  it("does not select pre-start ready nodes that have no actual match", () => {
    const graph = graphFor("single_elimination", "power_of_two", 8);
    const vm = buildBracketViewModelV2(graph, {}, []);
    expect(vm.readyMatchCardKeys).toEqual([]);
    expect(vm.workingMatchCardKey).toBeNull();
  });
});
