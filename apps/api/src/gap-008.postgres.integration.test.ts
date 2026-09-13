import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { matchInvitations, matchParticipants, notifications, users } from "./db/schema.js";
import * as schema from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const describePostgres = databaseUrl ? describe : describe.skip;

async function waitUntilBlocked(observer: postgres.Sql, applicationName: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await observer<{ blocked: boolean }[]>`
      select exists (
        select 1 from pg_stat_activity
        where application_name = ${applicationName}
          and wait_event_type = 'Lock'
      ) as blocked
    `;
    if (row?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${applicationName} did not block on a database lock`);
}

describePostgres.sequential("GAP-008 PostgreSQL consent serialization", () => {
  let db: Db;
  let close: () => Promise<void>;
  const clients: postgres.Sql[] = [];
  const creator = "00000000-0000-4000-8000-000000008101";
  const player = "00000000-0000-4000-8000-000000008102";
  const admin = "00000000-0000-4000-8000-000000008199";

  beforeAll(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    try {
      await reset.unsafe(
        "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
      );
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    close = context.close;
    await db.insert(users).values([
      { id: creator, email: "creator@gap008.pg", passwordHash: "x", firstName: "Creator", lastName: "Consent", mustChangePassword: false },
      { id: player, email: "player@gap008.pg", passwordHash: "x", firstName: "Player", lastName: "Consent", mustChangePassword: false },
      { id: admin, email: "admin@gap008.pg", passwordHash: "x", firstName: "Admin", lastName: "Consent", role: "admin", mustChangePassword: false },
    ]);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await close?.();
  });

  function isolated(applicationName: string) {
    const client = postgres(databaseUrl!, {
      max: 1,
      connection: { application_name: applicationName },
    });
    clients.push(client);
    const isolatedDb = drizzle(client, { schema }) as unknown as Db;
    return buildApp({
      db: isolatedDb,
      clock: new FakeClock(new Date("2026-09-13T12:00:00Z")),
    });
  }

  it("serializes acceptance before start on the same match lock", async () => {
    const setup = await isolated("gap008_setup");
    const match = await setup.services.matches.createMatch({
      createdByUserId: creator,
      title: "Concurrent consent",
      format: "1v1",
      firstServerMethod: "random",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: player },
      ],
    });
    const invitation = match!.invitations[0]!;
    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from matches where id = ${match!.id} for update`;
      ready();
      await gate;
    });
    await heldReady;

    const accepter = await isolated("gap008_accept_first");
    const starter = await isolated("gap008_start_second");
    const acceptPromise = accepter.services.matches.respondInvitation(
      invitation.id,
      player,
      true,
    );
    await waitUntilBlocked(observer, "gap008_accept_first");
    const startPromise = starter.services.matches.startMatch(match!.id, creator);
    await waitUntilBlocked(observer, "gap008_start_second");
    release();
    await held;

    await expect(acceptPromise).resolves.toMatchObject({ status: "accepted" });
    await expect(startPromise).resolves.toMatchObject({ status: "in_progress" });
    await setup.app.close();
    await accepter.app.close();
    await starter.app.close();
  });

  it.each([false, true])("serializes concurrent reinvites into one pending row and notification (legacy side: %s)", async (legacySide) => {
    const setup = await isolated("gap008_reinvite_setup");
    const match = await setup.services.matches.createMatch({
      createdByUserId: creator,
      title: "Concurrent reinvite",
      format: "1v1",
      participants: [
        { side: "A", userId: creator },
        { side: "B", userId: player },
      ],
    });
    const original = match!.invitations[0]!;
    if (legacySide) {
      for (const participant of match!.participants) {
        await db.update(matchParticipants).set({ side: participant.side === "A" ? "B" : "A" })
          .where(eq(matchParticipants.id, participant.id));
      }
    } else {
      await setup.services.matches.respondInvitation(original.id, player, false);
    }
    const notificationsBefore = await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, player),
        eq(notifications.type, "match_invitation"),
      ),
    });

    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from matches where id = ${match!.id} for update`;
      ready();
      await gate;
    });
    await heldReady;

    const first = await isolated("gap008_reinvite_first");
    const second = await isolated("gap008_reinvite_second");
    const firstPromise = first.services.matches.createInvitation(
      match!.id,
      creator,
      { userId: player, kind: "player" },
    );
    await waitUntilBlocked(observer, "gap008_reinvite_first");
    const secondPromise = second.services.matches.createInvitation(
      match!.id,
      creator,
      { userId: player, kind: "player" },
    );
    await waitUntilBlocked(observer, "gap008_reinvite_second");
    release();
    await held;

    const [firstResult, secondResult] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);
    expect(firstResult).toMatchObject({ status: "pending", participantSide: legacySide ? "A" : "B" });
    expect(secondResult).toMatchObject({ id: firstResult.id, status: "pending" });
    const history = await db.query.matchInvitations.findMany({
      where: eq(matchInvitations.matchId, match!.id),
    });
    expect(
      history
        .map((row) => ({ status: row.status, id: row.id }))
        .sort((a, b) => a.status.localeCompare(b.status)),
    ).toEqual([
      { status: legacySide ? "cancelled" : "declined", id: original.id },
      { status: "pending", id: firstResult.id },
    ]);
    const notificationsAfter = await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, player),
        eq(notifications.type, "match_invitation"),
      ),
    });
    expect(notificationsAfter).toHaveLength(notificationsBefore.length + 1);
    const pendingNotification = notificationsAfter.find((row) => {
      const payload = (row.payload ?? {}) as { invitationId?: string };
      return payload.invitationId === firstResult.id;
    });
    expect(pendingNotification).toBeDefined();
    expect(pendingNotification).toMatchObject({ readAt: null });
    if (legacySide) {
      expect(history.find((row) => row.id === original.id)).toMatchObject({ expiryReason: "side_changed" });
      expect(notificationsAfter.find((row) =>
        (row.payload as { invitationId?: string } | null)?.invitationId === original.id,
      )).toMatchObject({ readAt: new Date("2026-09-13T12:00:00Z") });
    }

    await setup.app.close();
    await first.app.close();
    await second.app.close();
  });

  it.each(["reinvite", "createMatch", "tournamentStart"] as const)("GAP-008 / DATA-002 / GAP-006 orders creator and outsider locks across matches (%s)", async (operation) => {
    const caseIndex = ["reinvite", "createMatch", "tournamentStart"].indexOf(operation);
    const creator = `00000000-0000-4000-8000-${String(8200 + caseIndex * 2).padStart(12, "0")}`;
    const player = `00000000-0000-4000-8000-${String(8201 + caseIndex * 2).padStart(12, "0")}`;
    await db.insert(users).values([creator, player].map((id, index) => ({
      id, email: `lock-order-${operation}-${index}@gap008.pg`, passwordHash: "x",
      firstName: "Lock", lastName: "Order", mustChangePassword: false,
    })));
    const setup = await isolated(`gap008_order_setup_${operation}`);
    const matchInput = {
      createdByUserId: creator, title: "Cross-match consent locks", format: "1v1" as const,
      participants: [{ side: "A" as const, userId: creator }, { side: "B" as const, userId: player }],
    };
    const swapMatch = operation === "tournamentStart" ? null : await setup.services.matches.createMatch(matchInput);
    const peerInput = operation === "tournamentStart" ? {
      ...matchInput, judgeUserId: player,
      participants: [{ side: "A" as const, userId: creator }, { side: "B" as const, guestFirstName: "Peer", guestLastName: "Guest" }],
    } : matchInput;
    const peerMatch = operation === "createMatch" ? null : await setup.services.matches.createMatch(peerInput);
    const tournament = operation === "tournamentStart" ? await setup.services.tournaments.create({
      createdByUserId: creator, title: "Nonplaying organizer", format: "single_elimination", organizerParticipates: false,
    }) : null;
    if (tournament) {
      await setup.services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: creator, userId: player });
      for (const name of ["One", "Two"]) {
        await setup.services.tournaments.addParticipant({ tournamentId: tournament.id, actorUserId: creator, guestFirstName: name, guestLastName: "Guest" });
      }
      await setup.services.tournaments.generateBracket(tournament.id, creator, { constructionAlgorithm: "compact", rng: () => 0.5 });
    }
    if (peerMatch) await setup.services.matches.respondInvitation(peerMatch.invitations[0]!.id, player, false);
    const [auth] = await db.insert(schema.authSessions).values({
      userId: admin, tokenHash: `gap008-swap-order-${operation}`,
      expiresAt: new Date("2026-09-13T13:00:00Z"),
    }).returning();
    const judgeInput = swapMatch ? { matchId: swapMatch.id, userId: admin, authSessionId: auth!.id } : null;
    if (judgeInput) await setup.services.matches.acquireJudge(judgeInput);

    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    // Pause after explicit user locks, before invitation/match FK KEY SHARE locks.
    const insertTable = tournament ? "matches" : "match_invitations";
    await db.execute(`
      CREATE FUNCTION gap008_pause_swap_insert() RETURNS trigger AS $$
      BEGIN
        IF current_setting('application_name') = 'gap008_swap_lock_order' THEN
          PERFORM pg_advisory_xact_lock(8008);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(`
      CREATE TRIGGER gap008_pause_swap_insert BEFORE INSERT ON ${insertTable}
      FOR EACH ROW EXECUTE FUNCTION gap008_pause_swap_insert();
    `);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(8008)`;
      ready();
      await gate;
    });
    await heldReady;
    const swapper = await isolated("gap008_swap_lock_order");
    const peer = await isolated(`gap008_peer_${operation}`);
    let peerOutcome: Promise<PromiseSettledResult<unknown>[]> | undefined;
    const swapOutcome = Promise.allSettled([
      tournament
        ? swapper.services.tournaments.start(tournament.id, creator)
        : swapper.services.matches.judgeSetup({ ...judgeInput!, swapSides: true }),
    ]);
    try {
      await waitUntilBlocked(observer, "gap008_swap_lock_order");
      const [paused] = await observer<{ advisory: boolean }[]>`
        select exists (
          select 1 from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.application_name = 'gap008_swap_lock_order'
            and l.locktype = 'advisory' and not l.granted
        ) as advisory
      `;
      expect(paused?.advisory).toBe(true);
      peerOutcome = Promise.allSettled([
        peerMatch
          ? peer.services.matches.createInvitation(peerMatch.id, creator, { userId: player, kind: tournament ? "judge" : "player" })
          : peer.services.matches.createMatch(matchInput),
      ]);
      await waitUntilBlocked(observer, `gap008_peer_${operation}`);
      const [waiter] = await observer<{ waitsOnSwap: boolean }[]>`
        select exists (
          select 1 from pg_stat_activity peer
          join pg_stat_activity swap on swap.application_name = 'gap008_swap_lock_order'
          join pg_locks l on l.pid = peer.pid
          where peer.application_name = ${`gap008_peer_${operation}`}
            and l.locktype = 'transactionid' and not l.granted
            and swap.pid = any(pg_blocking_pids(peer.pid))
        ) as "waitsOnSwap"
      `;
      expect(waiter?.waitsOnSwap).toBe(true);
      release();
      await held;
      // Old swap/start holds only outsider: peer owns creator, so the FK closes a deadlock cycle.
      // Correct code owns creator + outsider in sorted order, so peer waits and both commit.
      const results = [...await swapOutcome, ...await peerOutcome];
      expect(results.map((result) => result.status === "fulfilled"
        ? { status: result.status }
        : { status: result.status, code: result.reason?.cause?.code ?? result.reason?.code },
      )).toEqual([{ status: "fulfilled" }, { status: "fulfilled" }]);
      if (swapMatch) {
        const swapped = await setup.services.matches.getMatch(swapMatch!.id);
        expect(swapped!.participants.find((row) => row.userId === player)).toMatchObject({ side: "A" });
        expect(swapped!.invitations).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: swapMatch!.invitations[0]!.id, status: "cancelled", expiryReason: "side_changed" }),
          expect.objectContaining({ invitedUserId: player, status: "pending", participantSide: "A" }),
        ]));
        expect(swapped!.invitations).toHaveLength(2);
      } else {
        expect(await setup.services.tournaments.get(tournament!.id)).toMatchObject({ status: "in_progress" });
        expect(await db.query.matches.findMany({ where: eq(schema.matches.tournamentId, tournament!.id) }))
          .not.toHaveLength(0);
      }
      const peerResult = results[1]!;
      if (peerResult.status !== "fulfilled") throw new Error("peer did not commit");
      const peerId = peerMatch?.id ?? (peerResult.value as { id: string }).id;
      const peerHistory = await db.query.matchInvitations.findMany({ where: eq(matchInvitations.matchId, peerId) });
      expect(peerHistory.filter((row) => row.status === "pending"))
        .toEqual([expect.objectContaining({ invitedUserId: player, kind: tournament ? "judge" : "player", participantSide: tournament ? null : "B" })]);
    } finally {
      release();
      await held;
      await swapOutcome;
      await peerOutcome;
      await db.execute(`DROP TRIGGER gap008_pause_swap_insert ON ${insertTable}`);
      await db.execute("DROP FUNCTION gap008_pause_swap_insert()");
      if (swapMatch) await setup.services.matches.releaseJudge(swapMatch.id, admin, auth!.id);
      await setup.app.close();
      await swapper.app.close();
      await peer.app.close();
    }
  });

  it.each(["respond", "create"] as const)("rejects stale %s actor when blocking wins the user-row lock", async (action) => {
    const setup = await isolated(`gap008_block_setup_${action}`);
    const match = await setup.services.matches.createMatch({
      createdByUserId: creator,
      title: `Block before invitation ${action}`,
      format: "1v1",
      participants: [{ side: "A", userId: creator }, { side: "B", userId: player }],
    });
    const invitation = match!.invitations[0]!;
    if (action === "create") {
      await setup.services.matches.respondInvitation(invitation.id, player, false);
    }
    const historyBefore = await db.query.matchInvitations.findMany({
      where: eq(matchInvitations.matchId, match!.id),
    });
    const noticesBefore = await db.query.notifications.findMany({
      where: and(eq(notifications.userId, player), eq(notifications.type, "match_invitation")),
      orderBy: [notifications.id],
    });
    const actor = action === "respond" ? player : creator;
    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from users where id = ${actor} for update`;
      ready();
      await gate;
    });
    await heldReady;

    const blockActor = await isolated(`gap008_block_${action}`);
    const staleActor = await isolated(`gap008_stale_${action}`);
    const blockPromise = blockActor.services.auth.blockUser(admin, actor);
    let outcome: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await waitUntilBlocked(observer, `gap008_block_${action}`);
      // This service call represents a request admitted before the pending block commits.
      const mutation = action === "respond"
        ? staleActor.services.matches.respondInvitation(invitation.id, actor, true)
        : staleActor.services.matches.createInvitation(match!.id, actor, { userId: player, kind: "player" });
      outcome = Promise.allSettled([mutation]);
      try {
        await waitUntilBlocked(observer, `gap008_stale_${action}`);
      } finally {
        release();
        await held;
      }
      await blockPromise;
      expect((await outcome)[0]).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
      expect(await db.query.users.findFirst({ where: eq(users.id, actor) }))
        .toMatchObject({ status: "blocked" });
      expect(await db.query.matchInvitations.findMany({
        where: eq(matchInvitations.matchId, match!.id),
      })).toEqual(historyBefore);
      expect(await db.query.notifications.findMany({
        where: and(eq(notifications.userId, player), eq(notifications.type, "match_invitation")),
        orderBy: [notifications.id],
      })).toEqual(noticesBefore);
    } finally {
      release();
      await held;
      await blockPromise;
      await outcome;
      await setup.services.auth.unblockUser(admin, actor);
      await setup.app.close();
      await blockActor.app.close();
      await staleActor.app.close();
    }
  });
});
