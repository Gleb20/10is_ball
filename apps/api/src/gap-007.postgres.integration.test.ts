import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp, type AppServices } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { teamInvitations, teamMemberships, teams, users } from "./db/schema.js";
import * as schema from "./db/schema.js";
import { AuthService } from "./modules/auth/auth-service.js";
import { TeamService } from "./modules/teams/team-service.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const describePostgres = databaseUrl ? describe : describe.skip;
const ADMIN = "00000000-0000-4000-8000-000000000711";
const CAPTAIN_A = "00000000-0000-4000-8000-000000000712";
const CAPTAIN_B = "00000000-0000-4000-8000-000000000713";
const INVITEE_A = "00000000-0000-4000-8000-000000000714";
const INVITEE_B = "00000000-0000-4000-8000-000000000715";
const TRANSFER_TARGET = "00000000-0000-4000-8000-000000000716";
const ADMIN_TWO = "00000000-0000-4000-8000-000000000717";
const CAPTAIN_C = "00000000-0000-4000-8000-000000000718";
const INVITEE_C = "00000000-0000-4000-8000-000000000719";
const CAPTAIN_D = "00000000-0000-4000-8000-000000000720";
const INVITEE_D = "00000000-0000-4000-8000-000000000721";

async function waitUntilBlocked(observer: postgres.Sql, applicationName: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  throw new Error(`${applicationName} did not reach a database lock`);
}

describePostgres.sequential("GAP-007 PostgreSQL team serialization", () => {
  let db: Db;
  let services: AppServices;
  let close: () => Promise<void>;
  let appClose: () => Promise<void>;
  const extraClients: postgres.Sql[] = [];

  beforeAll(async () => {
    const reset = postgres(databaseUrl!, { max: 1 });
    try {
      await reset.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    } finally {
      await reset.end({ timeout: 5 });
    }
    await runPostgresMigrations(databaseUrl!, "apply");
    const context = await createPostgresDb(databaseUrl!);
    db = context.db;
    close = context.close;
    const built = await buildApp({ db, clock: new FakeClock(new Date("2026-09-13T08:00:00.000Z")) });
    services = built.services;
    appClose = () => built.app.close();
    await db.insert(users).values([
      { id: ADMIN, email: "admin@gap007.pg", passwordHash: "x", firstName: "Admin", lastName: "Pg", role: "admin", mustChangePassword: false },
      { id: CAPTAIN_A, email: "captaina@gap007.pg", passwordHash: "x", firstName: "Captain", lastName: "A", mustChangePassword: false },
      { id: CAPTAIN_B, email: "captainb@gap007.pg", passwordHash: "x", firstName: "Captain", lastName: "B", mustChangePassword: false },
      { id: INVITEE_A, email: "inviteea@gap007.pg", passwordHash: "x", firstName: "Invitee", lastName: "A", mustChangePassword: false },
      { id: INVITEE_B, email: "inviteeb@gap007.pg", passwordHash: "x", firstName: "Invitee", lastName: "B", mustChangePassword: false },
      { id: TRANSFER_TARGET, email: "transfer@gap007.pg", passwordHash: "x", firstName: "Transfer", lastName: "Target", mustChangePassword: false },
      { id: ADMIN_TWO, email: "admin-two@gap007.pg", passwordHash: "x", firstName: "Admin", lastName: "Two", role: "admin", mustChangePassword: false },
      { id: CAPTAIN_C, email: "captainc@gap007.pg", passwordHash: "x", firstName: "Captain", lastName: "C", mustChangePassword: false },
      { id: INVITEE_C, email: "inviteec@gap007.pg", passwordHash: "x", firstName: "Invitee", lastName: "C", mustChangePassword: false },
      { id: CAPTAIN_D, email: "captaind@gap007.pg", passwordHash: "x", firstName: "Captain", lastName: "D", mustChangePassword: false },
      { id: INVITEE_D, email: "inviteed@gap007.pg", passwordHash: "x", firstName: "Invitee", lastName: "D", mustChangePassword: false },
    ]);
  });

  afterAll(async () => {
    await Promise.all(extraClients.map((client) => client.end({ timeout: 5 })));
    await appClose?.();
    await close?.();
  });

  async function holdTeam(teamId: string) {
    const blocker = postgres(databaseUrl!, { max: 1 });
    extraClients.push(blocker);
    let release!: () => void;
    let markReady!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from teams where id = ${teamId} for update`;
      markReady();
      await gate;
    });
    await ready;
    return { release, held };
  }

  async function holdUser(userId: string) {
    const blocker = postgres(databaseUrl!, { max: 1 });
    extraClients.push(blocker);
    let release!: () => void;
    let markReady!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from users where id = ${userId} for update`;
      markReady();
      await gate;
    });
    await ready;
    return { release, held };
  }

  async function waitUntilBlockedOrSettled(
    observer: postgres.Sql,
    applicationName: string,
    settled: () => boolean,
  ) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (settled()) return;
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
    throw new Error(`${applicationName} neither settled nor reached a database lock`);
  }

  function isolatedServices(applicationName: string) {
    const client = postgres(databaseUrl!, { max: 1, connection: { application_name: applicationName } });
    extraClients.push(client);
    const isolatedDb = drizzle(client, { schema }) as unknown as Db;
    const teamService = new TeamService(isolatedDb, new FakeClock(new Date("2026-09-13T08:00:00.000Z")));
    const authService = new AuthService(isolatedDb, new FakeClock(new Date("2026-09-13T08:00:00.000Z")));
    authService.setUserBlockedHook((userId, transactionDb) => teamService.transferCaptainOnBlock(userId, transactionDb));
    return { auth: authService, teams: teamService };
  }

  it("serializes accept before captain block and transfers to the accepted member", async () => {
    const team = await services.teams.create({ name: "Accept first", captainUserId: CAPTAIN_A });
    const invitation = await services.teams.invite({ teamId: team!.id, invitedUserId: INVITEE_A, invitedByUserId: CAPTAIN_A });
    const held = await holdTeam(team!.id);
    const observer = postgres(databaseUrl!, { max: 1 });
    extraClients.push(observer);
    const acceptServices = isolatedServices("gap007_accept_first");
    const blockServices = isolatedServices("gap007_block_after_accept");
    const acceptPromise = acceptServices.teams.respondInvitation({ invitationId: invitation!.id, userId: INVITEE_A, accept: true });
    await waitUntilBlocked(observer, "gap007_accept_first");
    const blockPromise = blockServices.auth.blockUser(ADMIN, CAPTAIN_A);
    held.release();
    await held.held;
    await acceptPromise;
    await blockPromise;
    expect(await db.query.teams.findFirst({ where: eq(teams.id, team!.id) })).toMatchObject({ status: "active", captainUserId: INVITEE_A });
  });

  it("serializes captain block before accept and prevents an archived-team membership", async () => {
    const team = await services.teams.create({ name: "Block first", captainUserId: CAPTAIN_B });
    const invitation = await services.teams.invite({ teamId: team!.id, invitedUserId: INVITEE_B, invitedByUserId: CAPTAIN_B });
    const held = await holdTeam(team!.id);
    const observer = postgres(databaseUrl!, { max: 1 });
    extraClients.push(observer);
    const blockServices = isolatedServices("gap007_block_first");
    const acceptServices = isolatedServices("gap007_accept_after_block");
    const blockPromise = blockServices.auth.blockUser(ADMIN, CAPTAIN_B);
    await waitUntilBlocked(observer, "gap007_block_first");
    const acceptPromise = acceptServices.teams.respondInvitation({ invitationId: invitation!.id, userId: INVITEE_B, accept: true });
    held.release();
    await held.held;
    await blockPromise;
    await expect(acceptPromise).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await db.query.teams.findFirst({ where: eq(teams.id, team!.id) })).toMatchObject({ status: "archived" });
    expect(await db.query.teamMemberships.findMany({ where: and(eq(teamMemberships.teamId, team!.id), eq(teamMemberships.userId, INVITEE_B), isNull(teamMemberships.leftAt)) })).toHaveLength(0);
  });

  it("serializes captain transfer against removal without leaving an invalid captain", async () => {
    const team = await services.teams.create({ name: "Transfer race", captainUserId: ADMIN });
    await db.insert(teamMemberships).values({ teamId: team!.id, userId: TRANSFER_TARGET });
    const outcomes = await Promise.allSettled([
      services.teams.transferCaptain(team!.id, ADMIN, TRANSFER_TARGET),
      services.teams.removeMember(team!.id, ADMIN, TRANSFER_TARGET),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const persisted = await db.query.teams.findFirst({ where: eq(teams.id, team!.id) });
    const captainMembership = await db.query.teamMemberships.findFirst({
      where: and(eq(teamMemberships.teamId, team!.id), eq(teamMemberships.userId, persisted!.captainUserId), isNull(teamMemberships.leftAt)),
    });
    expect(captainMembership).toBeTruthy();
  });

  it("serializes a queued invitee block before a new invitation", async () => {
    const team = await services.teams.create({ name: "Blocked invitee", captainUserId: CAPTAIN_C });
    const held = await holdUser(INVITEE_C);
    const observer = postgres(databaseUrl!, { max: 1 });
    extraClients.push(observer);
    const blockServices = isolatedServices("gap007_block_invitee_before_invite");
    const inviteServices = isolatedServices("gap007_invite_after_block");
    const blockPromise = blockServices.auth.blockUser(ADMIN, INVITEE_C);
    await waitUntilBlocked(observer, "gap007_block_invitee_before_invite");
    let inviteSettled = false;
    const inviteOutcome = inviteServices.teams
      .invite({ teamId: team!.id, invitedUserId: INVITEE_C, invitedByUserId: CAPTAIN_C })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      )
      .finally(() => { inviteSettled = true; });
    await waitUntilBlockedOrSettled(observer, "gap007_invite_after_block", () => inviteSettled);
    held.release();
    await held.held;
    await blockPromise;
    expect(await inviteOutcome).toMatchObject({ status: "rejected", reason: { code: "USER_NOT_FOUND" } });
    expect(await db.query.teamInvitations.findMany({ where: eq(teamInvitations.teamId, team!.id) })).toHaveLength(0);
  });

  it("serializes a queued invitee block before invitation acceptance", async () => {
    const team = await services.teams.create({ name: "Blocked acceptance", captainUserId: CAPTAIN_D });
    const invitation = await services.teams.invite({ teamId: team!.id, invitedUserId: INVITEE_D, invitedByUserId: CAPTAIN_D });
    const held = await holdUser(INVITEE_D);
    const observer = postgres(databaseUrl!, { max: 1 });
    extraClients.push(observer);
    const blockServices = isolatedServices("gap007_block_invitee_before_accept");
    const acceptServices = isolatedServices("gap007_accept_after_invitee_block");
    const blockPromise = blockServices.auth.blockUser(ADMIN, INVITEE_D);
    await waitUntilBlocked(observer, "gap007_block_invitee_before_accept");
    let acceptSettled = false;
    const acceptOutcome = acceptServices.teams
      .respondInvitation({ invitationId: invitation!.id, userId: INVITEE_D, accept: true })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      )
      .finally(() => { acceptSettled = true; });
    await waitUntilBlockedOrSettled(observer, "gap007_accept_after_invitee_block", () => acceptSettled);
    held.release();
    await held.held;
    await blockPromise;
    expect(await acceptOutcome).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
    expect(await db.query.teamMemberships.findMany({
      where: and(eq(teamMemberships.teamId, team!.id), eq(teamMemberships.userId, INVITEE_D), isNull(teamMemberships.leftAt)),
    })).toHaveLength(0);
  });

  it("serializes block against demotion and retains an active administrator", async () => {
    const held = await holdUser(ADMIN_TWO);
    const observer = postgres(databaseUrl!, { max: 1 });
    extraClients.push(observer);
    const blockServices = isolatedServices("gap007_block_admin_before_demote");
    const roleServices = isolatedServices("gap007_demote_after_admin_block");
    try {
      const blockPromise = blockServices.auth.blockUser(ADMIN, ADMIN_TWO);
      await waitUntilBlocked(observer, "gap007_block_admin_before_demote");
      let roleSettled = false;
      const roleOutcome = roleServices.auth.updateUserRole(ADMIN_TWO, ADMIN, "user").then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ).finally(() => { roleSettled = true; });
      await waitUntilBlockedOrSettled(observer, "gap007_demote_after_admin_block", () => roleSettled);
      held.release();
      await held.held;
      await blockPromise;
      expect(await roleOutcome).toMatchObject({ status: "rejected" });
      expect(await db.query.users.findMany({ where: and(eq(users.role, "admin"), eq(users.status, "active")) })).toHaveLength(1);
    } finally {
      await db.update(users).set({ role: "admin", status: "active", blockedAt: null }).where(eq(users.id, ADMIN));
      await db.update(users).set({ role: "admin", status: "active", blockedAt: null }).where(eq(users.id, ADMIN_TWO));
    }
  });

  it("serializes reciprocal admin blocks and retains one active authorized administrator", async () => {
    const first = isolatedServices("gap007_admin_one");
    const second = isolatedServices("gap007_admin_two");
    const outcomes = await Promise.allSettled([
      first.auth.blockUser(ADMIN, ADMIN_TWO),
      second.auth.blockUser(ADMIN_TWO, ADMIN),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const activeAdmins = await db.query.users.findMany({
      where: and(eq(users.role, "admin"), eq(users.status, "active")),
    });
    expect(activeAdmins).toHaveLength(1);
  });
});
