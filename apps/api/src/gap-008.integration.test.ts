import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import { buildApp, type AppServices } from "./app.js";
import { createMigratedPgliteDb, type Db } from "./db/client.js";
import {
  authSessions,
  matchInvitations,
  matchParticipants,
  matches,
  notifications,
  teamMemberships,
  teams,
  users,
} from "./db/schema.js";

describe("GAP-008 match consent", () => {
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
    const built = await buildApp({
      db,
      clock,
    });
    services = built.services;
    closeApp = () => built.app.close();
    await db.insert(users).values(
      [creator, teammate, outsider, judge].map((id, index) => ({
        id,
        email: `gap008-${index}@test.local`,
        passwordHash: "x",
        firstName: `P${index}`,
        lastName: "Consent",
        mustChangePassword: false,
      })),
    );
    await db.insert(authSessions).values({
      id: judgeAuthSession,
      userId: judge,
      tokenHash: "gap008-judge-session",
      expiresAt: new Date("2026-09-13T13:00:00Z"),
    });
    const [team] = await db
      .insert(teams)
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

  it("creates consent only for an outside registered player and never gates on a judge invite", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Consent matrix",
      format: "2v2",
      firstServerMethod: "random",
      judgeUserId: judge,
      participants: [
        { side: "A", userId: creator },
        { side: "A", userId: teammate },
        { side: "B", userId: outsider },
        { side: "B", guestFirstName: "Guest", guestLastName: "Player" },
      ],
    });
    const invitations = await db.query.matchInvitations.findMany({
      where: eq(matchInvitations.matchId, match!.id),
    });
    expect(invitations.map((invitation) => invitation.kind).sort()).toEqual([
      "judge",
      "player",
    ]);
    expect(invitations.find((invitation) => invitation.kind === "player")).toMatchObject({
      invitedUserId: outsider,
      participantSide: "B",
      status: "pending",
    });
  });

  it("blocks start until required player consent is accepted and cancels a pending judge invite", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Start gate",
      format: "1v1",
      firstServerMethod: "random",
      judgeUserId: judge,
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    });
    const playerInvite = match!.invitations.find((row) => row.kind === "player")!;
    await expect(services.matches.startMatch(match!.id, creator)).rejects.toMatchObject({
      code: "PLAYER_CONSENT_REQUIRED",
    });
    await services.matches.respondInvitation(playerInvite.id, outsider, true);
    const started = await services.matches.startMatch(match!.id, creator);
    expect(started).toMatchObject({ status: "in_progress" });
    expect(started!.invitations.find((row) => row.kind === "judge")).toMatchObject({
      status: "cancelled",
      expiryReason: "match_started",
    });
  });

  it("persists expiration before throwing, allows a reinvite, and keeps accepted consent immutable", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Invitation lifecycle",
      format: "1v1",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    });
    const first = match!.invitations[0]!;
    clock.advanceMs(10 * 60_000 + 1);
    await expect(
      services.matches.respondInvitation(first.id, outsider, true),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    expect(await db.query.matchInvitations.findFirst({
      where: eq(matchInvitations.id, first.id),
    })).toMatchObject({ status: "expired", expiryReason: "expired" });

    const reinvite = await services.matches.createInvitation(match!.id, creator, {
      userId: outsider,
      kind: "player",
    });
    expect(reinvite.id).not.toBe(first.id);
    const accepted = await services.matches.respondInvitation(reinvite.id, outsider, true);
    expect(accepted).toMatchObject({ status: "accepted" });
    expect(await services.matches.respondInvitation(reinvite.id, outsider, false)).toMatchObject({
      id: reinvite.id,
      status: "accepted",
    });
    expect((await db.query.matchInvitations.findMany({
      where: eq(matchInvitations.matchId, match!.id),
    })).map((row) => row.status).sort()).toEqual(["accepted", "expired"]);
  });

  it("retains accepted consent by participant id and cancels obsolete pending roster history", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Roster edit",
      format: "2v2",
      participants: [
        { side: "A", userId: creator },
        { side: "A", userId: teammate },
        { side: "B", userId: outsider },
        { side: "B", guestFirstName: "Old", guestLastName: "Guest" },
      ],
    });
    const outsideParticipant = match!.participants.find((row) => row.userId === outsider)!;
    const oldGuest = match!.participants.find((row) => !row.userId)!;
    const invitation = match!.invitations.find((row) => row.kind === "player")!;
    await services.matches.respondInvitation(invitation.id, outsider, true);

    const edited = await services.matches.updateWaitingMatch(match!.id, creator, {
      participants: [
        ...match!.participants
          .filter((row) => row.id !== oldGuest.id)
          .map((row) => ({
            id: row.id,
            side: row.side as "A" | "B",
            userId: row.userId ?? undefined,
          })),
        { side: "B", guestFirstName: "New", guestLastName: "Guest" },
      ],
    });
    expect(edited!.participants.find((row) => row.userId === outsider)?.id).toBe(
      outsideParticipant.id,
    );
    expect(edited!.invitations.find((row) => row.id === invitation.id)).toMatchObject({
      status: "accepted",
    });

    const withReplacement = await services.matches.updateWaitingMatch(match!.id, creator, {
      participants: [
        ...edited!.participants
          .filter((row) => row.userId !== outsider)
          .map((row) => ({
            id: row.id,
            side: row.side as "A" | "B",
            userId: row.userId ?? undefined,
            guestFirstName: row.guestFirstName ?? undefined,
            guestLastName: row.guestLastName ?? undefined,
            guestAvatarKey: row.guestAvatarKey ?? undefined,
          })),
        { side: "B", userId: judge },
      ],
    });
    const histories = await db.query.matchInvitations.findMany({
      where: eq(matchInvitations.matchId, match!.id),
    });
    expect(histories.find((row) => row.id === invitation.id)).toMatchObject({
      status: "accepted",
      matchParticipantId: outsideParticipant.id,
    });
    expect(histories.find((row) => row.invitedUserId === judge)).toMatchObject({
      status: "pending",
      kind: "player",
    });
    await services.matches.updateWaitingMatch(match!.id, creator, {
      participants: [
        ...withReplacement!.participants
          .filter((row) => row.userId !== judge)
          .map((row) => ({
            id: row.id,
            side: row.side as "A" | "B",
            userId: row.userId ?? undefined,
            guestFirstName: row.guestFirstName ?? undefined,
            guestLastName: row.guestLastName ?? undefined,
            guestAvatarKey: row.guestAvatarKey ?? undefined,
          })),
        { side: "B", guestFirstName: "Final", guestLastName: "Guest" },
      ],
    });
    expect(await db.query.matchInvitations.findFirst({
      where: and(
        eq(matchInvitations.matchId, match!.id),
        eq(matchInvitations.invitedUserId, judge),
      ),
    })).toMatchObject({ status: "cancelled", expiryReason: "roster_changed" });
    expect(await services.notifications.unread(judge)).toEqual([]);
  });

  it("cancels pending consent and creates consent for the new side when judge setup swaps a waiting match", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Pending consent side swap",
      format: "1v1",
      firstServerMethod: "random",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    });
    const participant = match!.participants.find((row) => row.userId === outsider)!;
    const original = match!.invitations.find((row) => row.kind === "player")!;
    const originalNotice = (await db.query.notifications.findMany({
      where: eq(notifications.userId, outsider),
    })).find((row) =>
      (row.payload as { invitationId?: string } | null)?.invitationId === original.id,
    )!;
    await services.matches.acquireJudge({
      matchId: match!.id,
      userId: judge,
      authSessionId: judgeAuthSession,
    });

    const swapped = await services.matches.judgeSetup({
      matchId: match!.id,
      userId: judge,
      authSessionId: judgeAuthSession,
      swapSides: true,
    });

    expect(swapped!.participants.find((row) => row.id === participant.id)).toMatchObject({ side: "A" });
    expect(swapped!.invitations.find((row) => row.id === original.id)).toMatchObject({
      participantSide: "B",
      status: "cancelled",
      expiryReason: "side_changed",
    });
    const replacement = swapped!.invitations.find((row) => row.id !== original.id && row.kind === "player")!;
    expect(replacement).toMatchObject({
      matchParticipantId: participant.id,
      invitedUserId: outsider,
      participantSide: "A",
      status: "pending",
    });
    expect(await db.query.notifications.findFirst({
      where: eq(notifications.id, originalNotice.id),
    })).toMatchObject({ readAt: expect.any(Date) });
    await expect(services.matches.respondInvitation(original.id, outsider, true))
      .resolves.toMatchObject({ status: "cancelled", participantSide: "B" });
    await expect(services.matches.createInvitation(match!.id, creator, {
      userId: outsider, kind: "player",
    })).resolves.toMatchObject({ id: replacement.id, status: "pending", participantSide: "A" });
    await expect(services.matches.startMatch(match!.id, creator)).rejects.toMatchObject({
      code: "PLAYER_CONSENT_REQUIRED",
    });
  });

  it.each([false, true])("requires new side consent after joining the creator team (original accepted: %s)", async (accepted) => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Accepted consent side swap",
      format: "1v1",
      firstServerMethod: "random",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    });
    const participant = match!.participants.find((row) => row.userId === outsider)!;
    const original = match!.invitations.find((row) => row.kind === "player")!;
    if (accepted) await services.matches.respondInvitation(original.id, outsider, true);
    const team = await db.query.teams.findFirst({
      where: eq(teams.slug, "consent-team"),
    });
    await db.insert(teamMemberships).values({ teamId: team!.id, userId: outsider });
    await services.matches.acquireJudge({
      matchId: match!.id,
      userId: judge,
      authSessionId: judgeAuthSession,
    });

    const swapped = await services.matches.judgeSetup({
      matchId: match!.id,
      userId: judge,
      authSessionId: judgeAuthSession,
      swapSides: true,
    });

    expect(swapped!.invitations.find((row) => row.id === original.id)).toMatchObject({
      participantSide: "B",
      status: accepted ? "accepted" : "cancelled",
    });
    const replacement = swapped!.invitations.find((row) => row.id !== original.id && row.kind === "player")!;
    expect(replacement).toMatchObject({
      matchParticipantId: participant.id,
      participantSide: "A",
      status: "pending",
    });
    await expect(services.matches.createInvitation(match!.id, creator, {
      userId: outsider,
      kind: "player",
    })).resolves.toMatchObject({ id: replacement.id, status: "pending" });
    await expect(services.matches.startMatch(match!.id, creator)).rejects.toMatchObject({
      code: "PLAYER_CONSENT_REQUIRED",
    });
    await services.matches.respondInvitation(replacement.id, outsider, true);
    await expect(services.matches.startMatch(match!.id, creator)).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("reuses accepted consent only after returning to its original side", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Swap back", format: "1v1", firstServerMethod: "random",
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const original = match!.invitations[0]!;
    await services.matches.respondInvitation(original.id, outsider, true);
    const judgeInput = { matchId: match!.id, userId: judge, authSessionId: judgeAuthSession };
    await services.matches.acquireJudge(judgeInput);
    const swapped = await services.matches.judgeSetup({ ...judgeInput, swapSides: true });
    const pending = swapped!.invitations.find((row) => row.status === "pending")!;
    await expect(services.matches.createInvitation(match!.id, creator, {
      userId: outsider, kind: "player",
    })).resolves.toMatchObject({ id: pending.id, participantSide: "A" });

    const returned = await services.matches.judgeSetup({ ...judgeInput, swapSides: true });
    expect(returned!.invitations).toHaveLength(2);
    expect(returned!.invitations.find((row) => row.id === pending.id)).toMatchObject({
      status: "cancelled", expiryReason: "side_changed",
    });
    await expect(services.matches.createInvitation(match!.id, creator, {
      userId: outsider, kind: "player",
    })).resolves.toMatchObject({ id: original.id, status: "accepted", participantSide: "B" });
    await expect(services.matches.startMatch(match!.id, creator))
      .resolves.toMatchObject({ status: "in_progress" });
  });

  it.each([false, true])("rejects old-side history left by a legacy swap (accepted: %s)", async (accepted) => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Stale side history", format: "1v1", firstServerMethod: "random",
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const invitation = match!.invitations[0]!;
    if (accepted) await services.matches.respondInvitation(invitation.id, outsider, true);
    // Model rows persisted by the former judge swap implementation, which retained old-side consent.
    for (const participant of match!.participants) {
      await db.update(matchParticipants).set({ side: participant.side === "A" ? "B" : "A" })
        .where(eq(matchParticipants.id, participant.id));
    }
    if (!accepted) {
      await expect(services.matches.respondInvitation(invitation.id, outsider, true))
        .rejects.toMatchObject({ code: "MATCH_IMMUTABLE" });
      expect(await db.query.matchInvitations.findFirst({ where: eq(matchInvitations.id, invitation.id) }))
        .toMatchObject({ status: "cancelled", participantSide: "B", respondedAt: clock.now() });
    }
    await expect(services.matches.startMatch(match!.id, creator))
      .rejects.toMatchObject({ code: "PLAYER_CONSENT_REQUIRED" });
    const replacement = await services.matches.createInvitation(match!.id, creator, {
      userId: outsider, kind: "player",
    });
    expect(replacement).toMatchObject({ status: "pending", participantSide: "A" });
    expect(replacement.id).not.toBe(invitation.id);
    await services.matches.respondInvitation(replacement.id, outsider, true);
    await expect(services.matches.startMatch(match!.id, creator))
      .resolves.toMatchObject({ status: "in_progress" });
  });

  it("reinvites the current side when legacy history still has a pending invitation on the old side", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Legacy pending reinvite", format: "1v1", firstServerMethod: "random",
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const original = match!.invitations[0]!;
    for (const participant of match!.participants) {
      await db.update(matchParticipants).set({ side: participant.side === "A" ? "B" : "A" })
        .where(eq(matchParticipants.id, participant.id));
    }
    const replacement = await services.matches.createInvitation(match!.id, creator, {
      userId: outsider, kind: "player",
    });
    expect(replacement).toMatchObject({ status: "pending", participantSide: "A" });
    expect(replacement.id).not.toBe(original.id);
    expect(await db.query.matchInvitations.findFirst({ where: eq(matchInvitations.id, original.id) }))
      .toMatchObject({ status: "cancelled", expiryReason: "side_changed", respondedAt: clock.now() });
    const notices = await db.query.notifications.findMany({ where: eq(notifications.userId, outsider) });
    expect(notices).toHaveLength(2);
    expect(notices.find((row) => (row.payload as { invitationId?: string })?.invitationId === original.id))
      .toMatchObject({ readAt: clock.now() });
    await expect(services.matches.startMatch(match!.id, creator))
      .rejects.toMatchObject({ code: "PLAYER_CONSENT_REQUIRED" });
    await services.matches.respondInvitation(replacement.id, outsider, true);
    await expect(services.matches.startMatch(match!.id, creator))
      .resolves.toMatchObject({ status: "in_progress" });
  });

  it("rolls back side swap, consent cancellation and read state if replacement notification fails", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator, title: "Atomic swap", format: "1v1",
      participants: [{ side: "A", userId: creator }, { side: "B", userId: outsider }],
    });
    const judgeInput = { matchId: match!.id, userId: judge, authSessionId: judgeAuthSession };
    await services.matches.acquireJudge(judgeInput);
    const noticesBefore = await db.query.notifications.findMany();
    await db.execute(`
      CREATE FUNCTION gap008_fail_swap_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'match_invitation' THEN
          RAISE EXCEPTION 'injected GAP-008 swap notification failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap008_fail_swap_notification BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION gap008_fail_swap_notification();
    `);
    await expect(services.matches.judgeSetup({ ...judgeInput, swapSides: true }))
      .rejects.toThrow(/insert into "notifications"/);
    const after = await services.matches.getMatch(match!.id);
    expect(after!.participants).toEqual(match!.participants);
    expect(after!.invitations).toEqual(match!.invitations);
    expect(await db.query.notifications.findMany()).toEqual(noticesBefore);
  });

  it.each([false, true])("keeps legacy no-history matches start-compatible (swap: %s)", async (swapSides) => {
    const [match] = await db.insert(matches).values({
      title: "Legacy waiting",
      kind: "standalone",
      format: "1v1",
      firstServerMethod: "random",
      createdByUserId: creator,
    }).returning();
    await db.insert(matchParticipants).values([
      { matchId: match!.id, side: "A", userId: creator },
      { matchId: match!.id, side: "B", userId: outsider },
    ]);
    if (swapSides) {
      await services.matches.acquireJudge({
        matchId: match!.id, userId: judge, authSessionId: judgeAuthSession,
      });
      const swapped = await services.matches.judgeSetup({
        matchId: match!.id, userId: judge, authSessionId: judgeAuthSession, swapSides,
      });
      expect(swapped!.participants.find((row) => row.userId === outsider)).toMatchObject({ side: "A" });
    }
    expect(await db.query.matchInvitations.findMany({
      where: eq(matchInvitations.matchId, match!.id),
    })).toEqual([]);
    await expect(services.matches.startMatch(match!.id, creator)).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it.each([
    ["in_progress", "match_started"],
    ["pending_confirmation", "match_started"],
    ["cancelled", "match_cancelled"],
    ["stopped", "match_finished"],
    ["finished", "match_finished"],
    ["voided", "match_finished"],
  ] as const)("records %s source state when a pending response reaches a terminal match", async (status, reason) => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: `Terminal response ${status}`,
      format: "1v1",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    });
    const invitation = match!.invitations[0]!;
    await db.update(matches).set({ status }).where(eq(matches.id, match!.id));

    await expect(
      services.matches.respondInvitation(invitation.id, outsider, true),
    ).rejects.toMatchObject({ code: "MATCH_IMMUTABLE" });
    expect(await db.query.matchInvitations.findFirst({
      where: eq(matchInvitations.id, invitation.id),
    })).toMatchObject({
      status: "cancelled",
      expiryReason: reason,
      respondedAt: clock.now(),
    });
    expect(await db.query.notifications.findMany({
      where: eq(notifications.userId, outsider),
    })).toEqual([expect.objectContaining({ readAt: clock.now() })]);
  });

  it("cancels pending consent history when its waiting match is cancelled", async () => {
    const match = await services.matches.createMatch({
      createdByUserId: creator,
      title: "Cancelled consent",
      format: "1v1",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    });
    await services.matches.cancelMatch({
      matchId: match!.id,
      actorUserId: creator,
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000008099",
    });
    expect(await db.query.matchInvitations.findFirst({
      where: eq(matchInvitations.matchId, match!.id),
    })).toMatchObject({ status: "cancelled", expiryReason: "match_cancelled" });
  });

  it("rolls back the match and roster when consent notification persistence fails", async () => {
    await db.execute(`
      CREATE FUNCTION gap008_fail_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'match_invitation' THEN
          RAISE EXCEPTION 'injected GAP-008 notification failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap008_fail_notification
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION gap008_fail_notification();
    `);
    await expect(services.matches.createMatch({
      createdByUserId: creator,
      title: "Atomic create",
      format: "1v1",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: outsider },
      ],
    })).rejects.toThrow(/insert into "notifications"/);
    expect(await db.query.matches.findMany({
      where: eq(matches.title, "Atomic create"),
    })).toEqual([]);
    expect(await db.query.matchParticipants.findMany()).toEqual([]);
    expect(await db.query.matchInvitations.findMany()).toEqual([]);
  });
  it("admin purge clears invitation unread state while retaining notification history", async () => {
    const match = await services.matches.createMatch({createdByUserId:creator,title:"Purge pending",format:"1v1",participants:[{side:"A",userId:creator},{side:"B",userId:outsider}]});
    await db.update(users).set({role:"admin"}).where(eq(users.id,creator));
    await services.matches.adminDeleteMatch({matchId:match!.id,actorAdminId:creator});
    expect(await services.notifications.unread(outsider)).toEqual([]);
    expect(await services.notifications.list(outsider)).toEqual([expect.objectContaining({lifecycle:"expired",reasonCode:"source_unavailable",readAt:clock.now()})]);
  });

});
