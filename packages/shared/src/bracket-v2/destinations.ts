import type {
  BracketGraphV2,
  BracketMatchNode,
  ParticipantSource,
  Side,
} from "./types.js";

export type DestinationRef = {
  bracketMatchId: string;
  position: Side;
};

/** Build winner/loser destination index from sources (canonical inverse). */
export function buildDestinationIndex(graph: BracketGraphV2): {
  winners: Map<string, DestinationRef>;
  losers: Map<string, DestinationRef>;
} {
  const winners = new Map<string, DestinationRef>();
  const losers = new Map<string, DestinationRef>();

  const add = (
    map: Map<string, DestinationRef>,
    fromId: string,
    dest: DestinationRef,
  ) => {
    if (map.has(fromId)) {
      throw new Error(`Duplicate destination from ${fromId}`);
    }
    map.set(fromId, dest);
  };

  for (const m of graph.matches) {
    wire(m.sourceA, "A", m, winners, losers, add);
    wire(m.sourceB, "B", m, winners, losers, add);
  }
  return { winners, losers };
}

function wire(
  src: ParticipantSource,
  position: Side,
  m: BracketMatchNode,
  winners: Map<string, DestinationRef>,
  losers: Map<string, DestinationRef>,
  add: (
    map: Map<string, DestinationRef>,
    fromId: string,
    dest: DestinationRef,
  ) => void,
) {
  if (src.type === "winner") {
    add(winners, src.bracketMatchId, { bracketMatchId: m.id, position });
  } else if (src.type === "loser") {
    add(losers, src.bracketMatchId, { bracketMatchId: m.id, position });
  }
}
