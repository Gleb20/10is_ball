/**
 * Challonge-inspired match-centric tournament bracket (schemaVersion 2).
 * Exact Challonge edge parity is not claimed without export/API verification.
 * Product diff: double elimination has no placement/third-place matches.
 */

export type BracketStage =
  | "winners"
  | "losers"
  | "grand_final"
  | "grand_final_reset"
  | "third_place";

export type ParticipantSource =
  | { type: "seed"; seed: number }
  | { type: "winner"; bracketMatchId: string }
  | { type: "loser"; bracketMatchId: string }
  | { type: "empty" };

export type SourceResolution =
  | { kind: "resolved"; participantId: string }
  | { kind: "pending" }
  | { kind: "structurally_empty" };

/** Derived match lifecycle (never persisted as authoritative). */
export type DerivedMatchState =
  | "inactive"
  | "blocked"
  | "ready"
  | "auto_advance_eligible"
  | "completed"
  | "cancelled"
  | "structurally_empty";

export type ActivationCondition =
  | {
      type: "gf1_won_by_source_b";
      grandFinalMatchId: string;
    }
  | null;

export type BracketMatchNode = {
  id: string;
  stage: BracketStage;
  roundIndex: number;
  orderInRound: number;
  displayNumber: number;
  sourceA: ParticipantSource;
  sourceB: ParticipantSource;
  /** Persisted only when match finished / auto-advanced. */
  winnerParticipantId: string | null;
  loserParticipantId: string | null;
  actualMatchId: string | null;
  cancelled: boolean;
  /** Conditional nodes (GF2). */
  activationCondition: ActivationCondition;
};

export type BracketGraphV2 = {
  schemaVersion: 2;
  format: "single_elimination" | "double_elimination";
  participantCount: number;
  bracketSize: number;
  seedOrder: string[];
  thirdPlaceEnabled: boolean;
  matches: BracketMatchNode[];
  championParticipantId: string | null;
  runnerUpParticipantId: string | null;
  thirdPlaceParticipantId: string | null;
};

export type Side = "A" | "B";
