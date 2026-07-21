/**
 * Team captain invariants — TEAM-* / AT-TEAM-*.
 */

export type TeamMember = {
  userId: string;
  joinedAt: number;
  status: "active" | "blocked";
};

/**
 * On captain block/leave: earliest active (non-blocked) member by joinedAt.
 */
export function selectNewCaptain(
  members: TeamMember[],
  currentCaptainId: string,
): string | null {
  const candidates = members
    .filter((m) => m.userId !== currentCaptainId && m.status === "active")
    .sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
  return candidates[0]?.userId ?? null;
}

export const TEAM_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Tournament invite TTL (AT / PRD): 10 minutes. */
export const TOURNAMENT_INVITATION_TTL_MS = 10 * 60 * 1000;

export function isInvitationExpired(
  createdAt: number,
  now: number,
  ttlMs = TEAM_INVITATION_TTL_MS,
): boolean {
  return now >= createdAt + ttlMs;
}
