import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { eq } from "drizzle-orm";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import { authSessions, matchInvitations, matchParticipants, matches, notifications, teamMemberships, teams, users } from "./db/schema.js";

describe("GAP-008 voluntary match invitation lifecycle", () => {
  let db: Db;
  let services: AppServices;
  let close: () => Promise<void>;
  let closeApp: () => Promise<void>;
  let clock: FakeClock;
  const creator = "00000000-0000-4000-8000-000000008001";
  const teammate = "00000000-0000-4000-8000-000000008002";
  const outsider = "00000000-0000-4000-8000-000000008003";
  const judge = "00000000-0000-4000-8000-000000008004";
  const judgeAuthSession = "00000000-0000-4000-8000-000000008005";

  beforeEach(async () => {
    const context = await createMigratedPgliteDb();
    db = context.db;
    close = context.close;
    clock = new FakeClock(new Date("2026-09-13T12:00:00Z"));
    const built = await buildApp({ db, clock });
    services = built.services;
    closeApp = () => built.app.close();
    await db.insert(users).values([creator, teammate, outsider, judge].map((id, index) => ({
      id, email: `gap008-${index}@test.local`, passwordHash: "x",
      firstName: `P${index}`, lastName: "Consent", mustChangePassword: false,
    })));
    await db.insert(authSessions).values({
      id: judgeAuthSession,
      userId: judge,
      tokenHash: "gap008-judge-session",
      expiresAt: new Date("2026-09-13T13:00:00Z"),
    });
    const [team] = await db.insert(teams)
      .values({ name: "Consent team", slug: "consent-team", captainUserId: creator })
      .returning();
    await db.insert(teamMemberships).values([
      { teamId: team!.id, userId: creator },
      { teamId: team!.id, userId: teammate },
    ]);
  });

  afterEach(async () => {
    await closeApp();
    await close();
  });

  it("keeps selected players direct by default and explicitly invites teammates, opponents, and a judge", async () => {
    const direct = await services.matches.createMatch({
      createdByUserId: creator, title: "Direct roster", format: "1v1",
      participants: [{ side: "A", userId: teammate }, { side: "B", userId: outsider }],
    });
    expect(direct!.invitations).toEqual([]);

    const invited = await services.matches.createMatch({
      createdByUserId: creator, title: "Voluntary invitations", format: "2v2",
      sendPlayerInvitations: true, judgeUserId: judge,
      participants: [
        { side: "A", userId: creator }, { side: "A", userId: teammate },
        { side: "B", userId: outsider },
        { side: "B", guestFirstName: "Guest", guestLastName: "Player" },
      ],
    });
    expect(invited!.invitations.map((row) => [row.kind, row.invitedUserId])).toEqual(
      expect.arrayContaining([
        ["judge", judge], ["player", outsider], ["player", teammate],
      ]),
    );
  });

  it("starts without player acceptance and closes every pending voluntary invitation", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "No consent gate", format: "1v1",
      firstServerMethod: "random", sendPlayerInvitations: true, judgeUserId: judge,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const started = await services.matches.startMatch(match!.id, creator);
    expect(started).toMatchObject({ status: "in_progress" });
    expect(started!.invitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "player", status: "cancelled", expiryReason: "match_started" }),
      expect.objectContaining({ kind: "judge", status: "cancelled", expiryReason: "match_started" }),
    ]));
    expect(await services.notifications.unread(outsider)).toEqual([]);
    expect(await services.notifications.unread(judge)).toEqual([]);
  });

  it("persists expiry, allows an explicit reinvite, and keeps an accepted response immutable", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Invitation lifecycle", format: "1v1",
      sendPlayerInvitations: true,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const first = match!.invitations[0]!;
    clock.advanceMs(10 * 60_000 + 1);
    await expect(services.matches.respondInvitation(first.id, outsider, true))
      .rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(await db.query.matchInvitations.findFirst({ where: eq(matchInvitations.id, first.id) }))
      .toMatchObject({ status: "expired", expiryReason: "expired" });
    const reinvite = await services.matches.createInvitation(match!.id, creator, { userId: outsider, kind: "player" });
    expect(reinvite.id).not.toBe(first.id);
    await expect(services.matches.respondInvitation(reinvite.id, outsider, true))
      .resolves.toMatchObject({ status: "accepted" });
    await expect(services.matches.respondInvitation(reinvite.id, outsider, false))
      .resolves.toMatchObject({ status: "accepted" });
  });

  it("closes old-side pending history on swap and waits for an explicit new invitation", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Side swap", format: "1v1", sendPlayerInvitations: true,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const original = match!.invitations[0]!;
    await services.matches.acquireJudge({ matchId: match!.id, userId: judge, authSessionId: judgeAuthSession });
    const swapped = await services.matches.judgeSetup({
      matchId: match!.id, userId: judge, authSessionId: judgeAuthSession, swapSides: true,
    });
    expect(swapped!.invitations).toEqual([
      expect.objectContaining({ id: original.id, participantSide: "B", status: "cancelled", expiryReason: "side_changed" }),
    ]);
    const replacement = await services.matches.createInvitation(match!.id, creator, { userId: outsider, kind: "player" });
    expect(replacement).toMatchObject({ participantSide: "A", status: "pending" });
    expect(replacement.id).not.toBe(original.id);
    expect(await db.query.notifications.findMany({ where: eq(notifications.userId, outsider) })).toHaveLength(2);
  });

  it("retains accepted roster identity and closes only removed pending invitation history", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Roster history", format: "2v2", sendPlayerInvitations: true,
      participants: [
        { side: "A", userId: creator }, { side: "A", userId: teammate },
        { side: "B", userId: outsider }, { side: "B", userId: judge },
      ],
    });
    const outsiderParticipant = match!.participants.find((row) => row.userId === outsider)!;
    const accepted = match!.invitations.find((row) => row.invitedUserId === outsider)!;
    const removed = match!.invitations.find((row) => row.invitedUserId === judge)!;
    await services.matches.respondInvitation(accepted.id, outsider, true);
    const edited = await services.matches.updateWaitingMatch(match!.id, creator, {
      participants: match!.participants
        .filter((row) => row.userId !== judge)
        .map((row) => ({ id: row.id, side: row.side as "A" | "B", userId: row.userId ?? undefined }))
        .concat([{ side: "B" as const, guestFirstName: "New", guestLastName: "Player" }]),
    });
    expect(edited!.participants.find((row) => row.userId === outsider)?.id).toBe(outsiderParticipant.id);
    expect(edited!.invitations.find((row) => row.id === accepted.id)).toMatchObject({ status: "accepted" });
    expect(edited!.invitations.find((row) => row.id === removed.id)).toMatchObject({
      status: "cancelled", expiryReason: "roster_changed",
    });
  });

  it("rolls back side swap, invitation cancellation, and notification read on persistence failure", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Atomic side swap", format: "1v1", sendPlayerInvitations: true,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    await services.matches.acquireJudge({ matchId: match!.id, userId: judge, authSessionId: judgeAuthSession });
    await db.execute(`
      CREATE FUNCTION gap008_fail_invitation_read() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'match_invitation' THEN
          RAISE EXCEPTION 'injected invitation read failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap008_fail_invitation_read BEFORE UPDATE OF read_at ON notifications
      FOR EACH ROW EXECUTE FUNCTION gap008_fail_invitation_read();
    `);
    await expect(services.matches.judgeSetup({
      matchId: match!.id, userId: judge, authSessionId: judgeAuthSession, swapSides: true,
    })).rejects.toThrow(/update "notifications"/);
    const after = await services.matches.getMatch(match!.id);
    expect(after!.participants).toEqual(match!.participants);
    expect(after!.invitations).toEqual(match!.invitations);
    expect(await services.notifications.unread(outsider)).toHaveLength(1);
  });

  it("cancels pending invitation history when a waiting match is cancelled", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Cancelled invitation", format: "1v1", sendPlayerInvitations: true,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    await services.matches.cancelMatch({
      matchId: match!.id, actorUserId: creator, expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000008099",
    });
    expect(await db.query.matchInvitations.findFirst({ where: eq(matchInvitations.matchId, match!.id) }))
      .toMatchObject({ status: "cancelled", expiryReason: "match_cancelled" });
  });

  it("rolls back match, roster, invitation, and notification when explicit invitation persistence fails", async () => {
    await db.execute(`
      CREATE FUNCTION gap008_fail_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'match_invitation' THEN RAISE EXCEPTION 'injected notification failure'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap008_fail_notification BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION gap008_fail_notification();
    `);
    await expect(services.matches.createMatch({
      createdByUserId: creator, title: "Atomic create", format: "1v1", sendPlayerInvitations: true,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    })).rejects.toThrow(/insert into "notifications"/);
    expect(await db.query.matches.findMany({ where: eq(matches.title, "Atomic create") })).toEqual([]);
    expect(await db.query.matchParticipants.findMany()).toEqual([]);
    expect(await db.query.matchInvitations.findMany()).toEqual([]);
  });

  it("admin purge clears unread invitation state while retaining terminal notification history", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Purge pending", format: "1v1", sendPlayerInvitations: true,
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    await db.update(users).set({ role: "admin" }).where(eq(users.id, creator));
    await services.matches.adminDeleteMatch({ matchId: match!.id, actorAdminId: creator });
    expect(await services.notifications.unread(outsider)).toEqual([]);
    expect(await services.notifications.list(outsider)).toEqual([
      expect.objectContaining({ lifecycle: "expired", reasonCode: "source_unavailable", readAt: clock.now() }),
    ]);
  });
});
