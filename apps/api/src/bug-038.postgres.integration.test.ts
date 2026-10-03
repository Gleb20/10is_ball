import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeClock } from "@tab10/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.js";
import { createPostgresDb, type Db } from "./db/client.js";
import { runPostgresMigrations } from "./db/migrations.js";
import { resolveTestDatabaseUrl } from "./db/test-database-url.js";
import { authSessions } from "./db/schema.js";
import * as schema from "./db/schema.js";

const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const postgresSuite = databaseUrl ? describe : describe.skip;
const clock = new FakeClock(new Date("2026-10-03T12:00:00.000Z"));

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

postgresSuite.sequential("BUG-038 PostgreSQL credential serialization", () => {
  const clients: postgres.Sql[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildApp>>["app"]> = [];
  let db: Db;
  let closeDb: () => Promise<void>;
  let adminId: string;
  let adminSessionId: string;

  function isolated(applicationName: string) {
    const client = postgres(databaseUrl!, {
      max: 1,
      connection: { application_name: applicationName },
    });
    clients.push(client);
    return buildApp({
      db: drizzle(client, { schema }) as unknown as Db,
      clock,
    }).then((built) => {
      apps.push(built.app);
      return built;
    });
  }

  async function holdUser(targetId: string) {
    const blocker = postgres(databaseUrl!, { max: 1 });
    const observer = postgres(databaseUrl!, { max: 1 });
    clients.push(blocker, observer);
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const heldReady = new Promise<void>((resolve) => { ready = resolve; });
    const held = blocker.begin(async (transaction) => {
      await transaction`select id from users where id = ${targetId} for update`;
      ready();
      await gate;
    });
    await heldReady;
    return { observer, release, held };
  }

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
    closeDb = context.close;
    const setup = await buildApp({ db, clock });
    apps.push(setup.app);
    const seeded = await setup.services.auth.seedAdmin(
      "admin@bug038.test",
      "AdminPass1!",
    );
    adminId = seeded.user.id;
    const login = await setup.services.auth.login({
      email: "admin@bug038.test",
      password: "AdminPass1!",
      ip: "127.0.0.1",
    });
    if (!login.ok) throw new Error("admin login failed");
    adminSessionId = login.sessionId;
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await closeDb?.();
  });

  it("does not let an old-password login create a session behind a committed reset", async () => {
    const setup = await isolated("bug038_login_setup");
    const created = await setup.services.auth.createUser({
      email: "login-race@bug038.test",
      firstName: "Login",
      lastName: "Race",
      role: "user",
      issuedByAdminId: adminId,
    });
    const targetId = created.user.id;
    const lock = await holdUser(targetId);

    const resetter = await isolated("bug038_reset_first");
    const logger = await isolated("bug038_login_second");
    const reset = resetter.services.auth.resetPassword({
      actorAdminId: adminId,
      actorSessionId: adminSessionId,
      targetUserId: targetId,
      requestId: "00000000-0000-4000-8000-000000003801",
      expectedLastAppliedRequestId: null,
      supersedesRequestId: null,
      confirmReplacement: false,
    });
    await waitUntilBlocked(lock.observer, "bug038_reset_first");
    const login = logger.services.auth.login({
      email: "login-race@bug038.test",
      password: created.temporaryPassword,
      ip: "127.0.0.2",
    });
    await waitUntilBlocked(lock.observer, "bug038_login_second");
    lock.release();
    await lock.held;

    await expect(reset).resolves.toMatchObject({
      outcome: "applied",
      secretAvailable: true,
    });
    await expect(login).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
    expect(
      await db.query.authSessions.findMany({
        where: and(
          eq(authSessions.userId, targetId),
          isNull(authSessions.revokedAt),
        ),
      }),
    ).toHaveLength(0);
  });

  it("does not let first-change overwrite a reset or reuse its revoked session", async () => {
    const setup = await isolated("bug038_first_change_setup");
    const created = await setup.services.auth.createUser({
      email: "first-change-race@bug038.test",
      firstName: "First",
      lastName: "Change",
      role: "user",
      issuedByAdminId: adminId,
    });
    const targetId = created.user.id;
    const targetLogin = await setup.services.auth.login({
      email: "first-change-race@bug038.test",
      password: created.temporaryPassword,
      ip: "127.0.0.3",
    });
    if (!targetLogin.ok) throw new Error("target login failed");
    const lock = await holdUser(targetId);
    const resetter = await isolated("bug038_first_change_reset");
    const changer = await isolated("bug038_first_change_second");
    const reset = resetter.services.auth.resetPassword({
      actorAdminId: adminId,
      actorSessionId: adminSessionId,
      targetUserId: targetId,
      requestId: "00000000-0000-4000-8000-000000003802",
      expectedLastAppliedRequestId: null,
      supersedesRequestId: null,
      confirmReplacement: false,
    });
    await waitUntilBlocked(lock.observer, "bug038_first_change_reset");
    const change = changer.services.auth.changePasswordFirst({
      userId: targetId,
      sessionId: targetLogin.sessionId,
      newPassword: "FirstChanged1!",
    });
    await waitUntilBlocked(lock.observer, "bug038_first_change_second");
    lock.release();
    await lock.held;
    await expect(reset).resolves.toMatchObject({ outcome: "applied" });
    await expect(change).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(
      await db.query.authSessions.findFirst({
        where: eq(authSessions.id, targetLogin.sessionId),
      }),
    ).toMatchObject({ revokeReason: "password_reset" });
  });

  it("does not let ordinary change-password overwrite a reset", async () => {
    const setup = await isolated("bug038_change_setup");
    const created = await setup.services.auth.createUser({
      email: "change-race@bug038.test",
      firstName: "Ordinary",
      lastName: "Change",
      role: "user",
      issuedByAdminId: adminId,
    });
    const targetId = created.user.id;
    const targetLogin = await setup.services.auth.login({
      email: "change-race@bug038.test",
      password: created.temporaryPassword,
      ip: "127.0.0.4",
    });
    if (!targetLogin.ok) throw new Error("target login failed");
    expect(
      await setup.services.auth.changePasswordFirst({
        userId: targetId,
        sessionId: targetLogin.sessionId,
        newPassword: "CurrentPass1!",
      }),
    ).toEqual({ ok: true });
    const lock = await holdUser(targetId);
    const resetter = await isolated("bug038_change_reset");
    const changer = await isolated("bug038_change_second");
    const reset = resetter.services.auth.resetPassword({
      actorAdminId: adminId,
      actorSessionId: adminSessionId,
      targetUserId: targetId,
      requestId: "00000000-0000-4000-8000-000000003803",
      expectedLastAppliedRequestId: null,
      supersedesRequestId: null,
      confirmReplacement: false,
    });
    await waitUntilBlocked(lock.observer, "bug038_change_reset");
    const change = changer.services.auth.changePassword({
      userId: targetId,
      sessionId: targetLogin.sessionId,
      currentPassword: "CurrentPass1!",
      newPassword: "ChangedAgain1!",
    });
    await waitUntilBlocked(lock.observer, "bug038_change_second");
    lock.release();
    await lock.held;
    await expect(reset).resolves.toMatchObject({ outcome: "applied" });
    await expect(change).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
    expect(
      await db.query.authSessions.findFirst({
        where: eq(authSessions.id, targetLogin.sessionId),
      }),
    ).toMatchObject({ revokeReason: "password_reset" });
  });

  it("applies A then confirmed B once and reports one consistent authoritative pointer", async () => {
    const setup = await isolated("bug038_a_then_b");
    const created = await setup.services.auth.createUser({
      email: "a-then-b@bug038.test",
      firstName: "AThen",
      lastName: "B",
      role: "user",
      issuedByAdminId: adminId,
    });
    const requestA = "00000000-0000-4000-8000-000000003804";
    const requestB = "00000000-0000-4000-8000-000000003805";
    await expect(
      setup.services.auth.resetPassword({
        actorAdminId: adminId,
        actorSessionId: adminSessionId,
        targetUserId: created.user.id,
        requestId: requestA,
        expectedLastAppliedRequestId: null,
        supersedesRequestId: null,
        confirmReplacement: false,
      }),
    ).resolves.toMatchObject({ outcome: "applied", secretAvailable: true });
    await expect(
      setup.services.auth.resetPassword({
        actorAdminId: adminId,
        actorSessionId: adminSessionId,
        targetUserId: created.user.id,
        requestId: requestB,
        expectedLastAppliedRequestId: null,
        supersedesRequestId: requestA,
        confirmReplacement: true,
      }),
    ).resolves.toMatchObject({ outcome: "applied", secretAvailable: true });
    await expect(
      setup.services.auth.getAdminPasswordResetReceipt({
        actorAdminId: adminId,
        actorSessionId: adminSessionId,
        targetUserId: created.user.id,
        requestId: requestA,
      }),
    ).resolves.toMatchObject({ outcome: "applied", current: false });
    await expect(
      setup.services.auth.getAdminPasswordResetReceipt({
        actorAdminId: adminId,
        actorSessionId: adminSessionId,
        targetUserId: created.user.id,
        requestId: requestB,
      }),
    ).resolves.toMatchObject({ outcome: "applied", current: true });
  });

  it("rolls back receipt, pointer, credentials, revocation, issue, audit and notification on a PostgreSQL fault", async () => {
    const setup = await isolated("bug038_fault_atomicity");
    const created = await setup.services.auth.createUser({
      email: "fault@bug038.test",
      firstName: "Fault",
      lastName: "Atomicity",
      role: "user",
      issuedByAdminId: adminId,
    });
    const targetLogin = await setup.services.auth.login({
      email: "fault@bug038.test",
      password: created.temporaryPassword,
      ip: "127.0.0.5",
    });
    if (!targetLogin.ok) throw new Error("target login failed");
    const before = await db.query.users.findFirst({
      where: eq(schema.users.id, created.user.id),
    });
    const issuesBefore = await db.query.temporaryPasswordIssues.findMany({
      where: eq(schema.temporaryPasswordIssues.userId, created.user.id),
    });
    const injector = postgres(databaseUrl!, { max: 1 });
    clients.push(injector);
    await injector.unsafe(`
      CREATE OR REPLACE FUNCTION fail_bug038_notification() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'account_access_changed' AND NEW.payload->>'change' = 'password_reset' THEN
          RAISE EXCEPTION 'injected BUG-038 notification failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await injector.unsafe(`
      CREATE TRIGGER fail_bug038_notification
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION fail_bug038_notification()
    `);
    try {
      await expect(
        setup.services.auth.resetPassword({
          actorAdminId: adminId,
          actorSessionId: adminSessionId,
          targetUserId: created.user.id,
          requestId: "00000000-0000-4000-8000-000000003806",
          expectedLastAppliedRequestId: null,
          supersedesRequestId: null,
          confirmReplacement: false,
        }),
      ).rejects.toBeDefined();
      expect(
        await db.query.users.findFirst({
          where: eq(schema.users.id, created.user.id),
        }),
      ).toMatchObject({
        passwordHash: before!.passwordHash,
        lastAdminPasswordResetRequestId: null,
      });
      expect(
        await db.query.adminPasswordResetRequests.findMany({
          where: eq(
            schema.adminPasswordResetRequests.targetUserId,
            created.user.id,
          ),
        }),
      ).toHaveLength(0);
      expect(
        await db.query.authSessions.findFirst({
          where: eq(authSessions.id, targetLogin.sessionId),
        }),
      ).toMatchObject({ revokedAt: null, revokeReason: null });
      expect(
        await db.query.temporaryPasswordIssues.findMany({
          where: eq(schema.temporaryPasswordIssues.userId, created.user.id),
        }),
      ).toHaveLength(issuesBefore.length);
      expect(
        await db.query.auditLogs.findMany({
          where: and(
            eq(schema.auditLogs.entityId, created.user.id),
            eq(schema.auditLogs.action, "user.password_reset"),
          ),
        }),
      ).toHaveLength(0);
      expect(
        await db.query.notifications.findMany({
          where: eq(schema.notifications.userId, created.user.id),
        }),
      ).toHaveLength(0);
    } finally {
      await injector.unsafe(
        "DROP TRIGGER IF EXISTS fail_bug038_notification ON notifications",
      );
      await injector.unsafe(
        "DROP FUNCTION IF EXISTS fail_bug038_notification()",
      );
    }
  });

  it("commits queued B before A, leaves B authoritative, and returns consistent receipts", async () => {
    const setup = await isolated("bug038_order_setup");
    const created = await setup.services.auth.createUser({
      email: "order-race@bug038.test",
      firstName: "Order",
      lastName: "Race",
      role: "user",
      issuedByAdminId: adminId,
    });
    const targetId = created.user.id;
    const lock = await holdUser(targetId);

    const bApp = await isolated("bug038_b_first");
    const aApp = await isolated("bug038_a_second");
    const requestA = "00000000-0000-4000-8000-000000003811";
    const requestB = "00000000-0000-4000-8000-000000003812";
    const b = bApp.services.auth.resetPassword({
      actorAdminId: adminId,
      actorSessionId: adminSessionId,
      targetUserId: targetId,
      requestId: requestB,
      expectedLastAppliedRequestId: null,
      supersedesRequestId: requestA,
      confirmReplacement: true,
    });
    await waitUntilBlocked(lock.observer, "bug038_b_first");
    const a = aApp.services.auth.resetPassword({
      actorAdminId: adminId,
      actorSessionId: adminSessionId,
      targetUserId: targetId,
      requestId: requestA,
      expectedLastAppliedRequestId: null,
      supersedesRequestId: null,
      confirmReplacement: false,
    });
    await waitUntilBlocked(lock.observer, "bug038_a_second");
    lock.release();
    await lock.held;

    await expect(b).resolves.toMatchObject({ outcome: "applied" });
    await expect(a).resolves.toEqual({
      requestId: requestA,
      outcome: "rejected_state_changed",
      secretAvailable: false,
      currentLastAppliedRequestId: requestB,
    });
    await expect(
      setup.services.auth.getAdminPasswordResetReceipt({
        actorAdminId: adminId,
        actorSessionId: adminSessionId,
        targetUserId: targetId,
        requestId: requestB,
      }),
    ).resolves.toMatchObject({ outcome: "applied", current: true });
    await expect(
      setup.services.auth.getAdminPasswordResetReceipt({
        actorAdminId: adminId,
        actorSessionId: adminSessionId,
        targetUserId: targetId,
        requestId: requestA,
      }),
    ).resolves.toMatchObject({
      outcome: "rejected_state_changed",
      current: false,
    });
  });
});
