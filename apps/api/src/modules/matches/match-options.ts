import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { matchParticipants, matches, teamMemberships, teams } from "../../db/schema.js";
import type { AuthService } from "../auth/auth-service.js";

type DirectoryUser = Awaited<ReturnType<AuthService["listDirectory"]>>[number];

/** MATCH-004: only the actor's active memberships and actual opposing sides. */
export async function matchCreateOptions(db: Db, actorUserId: string, users: DirectoryUser[]) {
  const selectable = new Set(users.map((user) => user.id));
  const ownTeams = await db.select({ id: teams.id, name: teams.name })
    .from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(eq(teamMemberships.userId, actorUserId), isNull(teamMemberships.leftAt), isNull(teams.archivedAt)));
  const memberships = ownTeams.length ? await db.query.teamMemberships.findMany({
    where: and(inArray(teamMemberships.teamId, ownTeams.map((team) => team.id)), isNull(teamMemberships.leftAt)),
  }) : [];
  const played = await db.select({ id: matches.id, side: matchParticipants.side, finishedAt: matches.finishedAt })
    .from(matchParticipants).innerJoin(matches, eq(matches.id, matchParticipants.matchId))
    .where(and(eq(matchParticipants.userId, actorUserId), inArray(matches.status, ["finished", "stopped"]), ne(matches.kind, "tutorial")));
  const participants = played.length ? await db.query.matchParticipants.findMany({
    where: inArray(matchParticipants.matchId, played.map((match) => match.id)),
  }) : [];
  const byMatch = new Map(played.map((match) => [match.id, match]));
  const opponents = new Map<string, { count: number; lastPlayedAt: number }>();
  for (const participant of participants) {
    const match = byMatch.get(participant.matchId);
    if (!match || !participant.userId || participant.side === match.side || !selectable.has(participant.userId)) continue;
    const previous = opponents.get(participant.userId) ?? { count: 0, lastPlayedAt: 0 };
    opponents.set(participant.userId, { count: previous.count + 1, lastPlayedAt: Math.max(previous.lastPlayedAt, match.finishedAt?.getTime() ?? 0) });
  }
  const recent = [...opponents].sort((a, b) => b[1].lastPlayedAt - a[1].lastPlayedAt || a[0].localeCompare(b[0]));
  const frequent = [...opponents].sort((a, b) => b[1].count - a[1].count || b[1].lastPlayedAt - a[1].lastPlayedAt || a[0].localeCompare(b[0]));
  return {
    users,
    teams: ownTeams.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((team) => ({
      ...team,
      userIds: memberships.filter((member) => member.teamId === team.id && selectable.has(member.userId)).map((member) => member.userId).sort(),
    })),
    recentOpponentIds: recent.map(([id]) => id),
    frequentOpponentIds: frequent.map(([id]) => id),
  };
}
