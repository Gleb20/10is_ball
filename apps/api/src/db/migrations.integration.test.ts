import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./client.js";
import {
  applyPgliteMigrationFiles,
  assertMigrationsCompatible,
  assertMigrationsExactlyCurrent,
  runPgliteMigrations,
} from "./migrations.js";

const baselineSqlPath = fileURLToPath(
  new URL("../../drizzle/0000_data_003_baseline.sql", import.meta.url),
);

describe("versioned migration foundation on disposable PGlite", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function freshContext() {
    const context = await createPgliteDb();
    closeCallbacks.push(context.close);
    return context;
  }

  async function historicalContext() {
    const context = await freshContext();
    await context.client.exec(await readFile(baselineSqlPath, "utf8"));
    return context;
  }

  async function expectNoLedgerRows(
    context: Awaited<ReturnType<typeof createPgliteDb>>,
  ) {
    const exists = await context.client.query<{ exists: boolean }>(`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
    `);
    if (exists.rows[0]?.exists !== true) return;
    const ledger = await context.client.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    `);
    expect(ledger.rows[0]?.count).toBe(0);
  }

  it("creates the baseline plus the append-only void audit from a genuinely empty database in apply mode", async () => {
    const context = await freshContext();

    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });

    await expect(
      assertMigrationsExactlyCurrent(context.queryMigrations),
    ).resolves.toBeUndefined();
    const tables = await context.client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toHaveLength(18);
  });

  it.each([1, 2, 3])("upgrades a %i-migration released prefix without changing existing rows", async (prefixLength) => {
    const context = await freshContext();
    const baselineOnlyDirectory = await mkdtemp(
      join(tmpdir(), "tab10-baseline-only-"),
    );
    temporaryDirectories.push(baselineOnlyDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, prefixLength);
    for (const entry of journal.entries) {
      await writeFile(join(baselineOnlyDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    const metaDirectory = join(baselineOnlyDirectory, "meta");
    await mkdir(metaDirectory);
    await writeFile(join(metaDirectory, "_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, baselineOnlyDirectory);
    await context.client.exec(`
      INSERT INTO users (
        id, email, password_hash, first_name, last_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000091',
        'upgrade@tab10.test', 'synthetic-hash', 'Upgrade', 'Owner'
      )
    `);

    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });

    const preserved = await context.client.query<{ email: string }>(`
      SELECT email FROM users
      WHERE id = '00000000-0000-4000-8000-000000000091'
    `);
    expect(preserved.rows).toEqual([{ email: "upgrade@tab10.test" }]);
    const auditTable = await context.client.query<{ name: string }>(`
      SELECT to_regclass('public.match_void_audits')::text AS name
    `);
    expect(auditTable.rows).toEqual([{ name: "match_void_audits" }]);
    await expect(
      assertMigrationsExactlyCurrent(context.queryMigrations),
    ).resolves.toBeUndefined();
  });

  it("fails closed rather than withdrawing a participant already referenced by a bracket", async () => {
    const context = await historicalContext();
    await context.client.exec(`
      INSERT INTO users(id,email,password_hash,first_name,last_name) VALUES
        ('00000000-0000-4000-8000-000000000081','duplicate@tab10.test','synthetic','Test','Player');
      INSERT INTO tournaments(id,title,created_by_user_id,status,bracket_json) VALUES
        ('00000000-0000-4000-8000-000000000082','Existing bracket','00000000-0000-4000-8000-000000000081','bracket_generated','{"seedOrder":["00000000-0000-4000-8000-000000000083","00000000-0000-4000-8000-000000000084"]}');
      INSERT INTO tournament_participants(id,tournament_id,user_id) VALUES
        ('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081'),
        ('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081');
    `);
    await expect(runPgliteMigrations({ db: context.db, query: context.queryMigrations, mode: "adopt-unversioned" })).rejects.toThrow("DATA_004_DUPLICATE_BRACKET_PARTICIPANTS");
    const participants = await context.client.query<{status:string}>("SELECT status FROM tournament_participants ORDER BY id");
    expect(participants.rows).toEqual([{status:"active"},{status:"active"}]);
    await expectNoLedgerRows(context);
  });

  it("rejects drift in onboarding check semantics and invitation partial indexes", async () => {
    const context = await freshContext();
    await runPgliteMigrations({ db: context.db, query: context.queryMigrations, mode: "apply" });
    await context.client.exec(`ALTER TABLE users DROP CONSTRAINT users_onboarding_step_range;
      ALTER TABLE users ADD CONSTRAINT users_onboarding_step_range CHECK (onboarding_step BETWEEN 0 AND 7);`);
    await expect(assertMigrationsExactlyCurrent(context.queryMigrations)).rejects.toThrow("public constraints");
    await context.client.exec(`ALTER TABLE users DROP CONSTRAINT users_onboarding_step_range;
      ALTER TABLE users ADD CONSTRAINT users_onboarding_step_range CHECK (onboarding_step BETWEEN 0 AND 6);
      DROP INDEX team_invitations_pending_user_uid;
      CREATE UNIQUE INDEX team_invitations_pending_user_uid ON team_invitations(team_id, invited_user_id) WHERE status = 'accepted';`);
    await expect(assertMigrationsExactlyCurrent(context.queryMigrations)).rejects.toThrow("public explicit indexes");
  });

  it("preserves rows while adopting the exact unversioned historical baseline", async () => {
    const context = await historicalContext();
    await context.client.exec(`
      INSERT INTO users (
        id, email, password_hash, first_name, last_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        'historical@tab10.test',
        'synthetic-hash',
        'Historical',
        'Owner'
      )
    `);

    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "adopt-unversioned",
    });

    const users = await context.client.query<{ email: string }>(`
      SELECT email FROM users
      WHERE id = '00000000-0000-4000-8000-000000000001'
    `);
    expect(users.rows).toEqual([{ email: "historical@tab10.test" }]);
    await expect(
      assertMigrationsExactlyCurrent(context.queryMigrations),
    ).resolves.toBeUndefined();
  });

  it("applies only the three declared historical bracket backfills", async () => {
    const context = await historicalContext();
    await context.client.exec(`
      INSERT INTO users (
        id, email, password_hash, first_name, last_name
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        'backfill@tab10.test', 'synthetic-hash', 'Backfill', 'Owner'
      );
      INSERT INTO tournaments (
        id, title, created_by_user_id,
        bracket_json, bracket_construction_algorithm
      ) VALUES
        (
          '00000000-0000-4000-8000-000000000011', 'V2 power',
          '00000000-0000-4000-8000-000000000001',
          '{"schemaVersion":2,"format":"single_elimination"}'::jsonb, NULL
        ),
        (
          '00000000-0000-4000-8000-000000000012', 'V2 compact',
          '00000000-0000-4000-8000-000000000001',
          '{"schemaVersion":2,"format":"single_elimination","constructionAlgorithm":"compact"}'::jsonb, NULL
        ),
        (
          '00000000-0000-4000-8000-000000000013', 'V1 compact',
          '00000000-0000-4000-8000-000000000001',
          '{"schemaVersion":1,"format":"single_elimination","slots":[]}'::jsonb, NULL
        ),
        (
          '00000000-0000-4000-8000-000000000014', 'Protected',
          '00000000-0000-4000-8000-000000000001',
          '{"schemaVersion":2,"format":"double_elimination","constructionAlgorithm":"custom"}'::jsonb, NULL
        )
    `);

    const evidence = await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "adopt-unversioned",
    });

    expect(evidence.adoption?.candidateCounts).toEqual({
      "v2-power-of-two": 1,
      "v2-compact": 1,
      "v1-compact": 1,
    });
    expect(evidence.adoption?.actualAfterDigest).toBe(
      evidence.adoption?.expectedAfterDigest,
    );

    const rows = await context.client.query<{
      title: string;
      algorithm: string | null;
    }>(`
      SELECT title, bracket_construction_algorithm AS algorithm
      FROM tournaments ORDER BY id
    `);
    expect(rows.rows).toEqual([
      { title: "V2 power", algorithm: "power_of_two" },
      { title: "V2 compact", algorithm: "compact" },
      { title: "V1 compact", algorithm: "compact" },
      { title: "Protected", algorithm: null },
    ]);
  });

  it("makes repeated apply runs a verified no-op", async () => {
    const context = await freshContext();
    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });
    const before = await context.client.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    `);

    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });

    const after = await context.client.query<{ count: number }>(`
      SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    `);
    expect(before.rows[0]?.count).toBe(5);
    expect(after.rows[0]?.count).toBe(5);
  });

  it("does not let adoption stand in for ordinary fresh apply", async () => {
    const context = await freshContext();
    await expect(
      runPgliteMigrations({
        db: context.db,
        query: context.queryMigrations,
        mode: "adopt-unversioned",
      }),
    ).rejects.toThrow("schema drift in public tables");
    await expectNoLedgerRows(context);
  });

  it.each([
    {
      drift: "enum",
      mutate: `ALTER TYPE match_status ADD VALUE 'corrupt'`,
    },
    {
      drift: "nullability",
      mutate: `ALTER TABLE users ALTER COLUMN email DROP NOT NULL`,
    },
    {
      drift: "column",
      mutate: `ALTER TABLE users DROP COLUMN position_text`,
    },
    {
      drift: "default",
      mutate: `ALTER TABLE users ALTER COLUMN first_name SET DEFAULT 'corrupt'`,
    },
    {
      drift: "index",
      mutate: `
        DROP INDEX users_email_unique;
        CREATE UNIQUE INDEX users_email_unique ON users (first_name)
      `,
    },
    {
      drift: "constraint",
      mutate: `
        ALTER TABLE auth_sessions
        DROP CONSTRAINT auth_sessions_user_id_fkey
      `,
    },
  ])("rejects a corrupt historical $drift before creating ledger state", async ({
    mutate,
  }) => {
    const context = await historicalContext();
    await context.client.exec(mutate);

    await expect(
      runPgliteMigrations({
        db: context.db,
        query: context.queryMigrations,
        mode: "adopt-unversioned",
      }),
    ).rejects.toThrow("Database schema drift");
    await expectNoLedgerRows(context);
  });

  it("recovers canonically from a failed empty-database migration", async () => {
    const context = await freshContext();
    const failureDirectory = await mkdtemp(
      join(tmpdir(), "tab10-failing-migration-"),
    );
    temporaryDirectories.push(failureDirectory);
    await writeFile(
      join(failureDirectory, "0000_failure.sql"),
      [
        "CREATE TABLE rolled_back (id integer PRIMARY KEY);",
        "--> statement-breakpoint",
        "SELECT * FROM relation_that_does_not_exist;",
      ].join("\n"),
    );
    await writeFile(
      join(failureDirectory, "meta.json"),
      "unused",
    );
    await writeFile(
      join(failureDirectory, "_journal.json"),
      JSON.stringify({}),
    );
    const metaDirectory = join(failureDirectory, "meta");
    await mkdir(metaDirectory);
    await writeFile(
      join(metaDirectory, "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 0,
            version: "7",
            when: 1_700_000_000_000,
            tag: "0000_failure",
            breakpoints: true,
          },
        ],
      }),
    );

    await expect(
      applyPgliteMigrationFiles(context.db, failureDirectory),
    ).rejects.toThrow();
    await expectNoLedgerRows(context);
    const rolledBack = await context.client.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'rolled_back'
    `);
    expect(rolledBack.rows).toEqual([]);

    await expect(
      runPgliteMigrations({
        db: context.db,
        query: context.queryMigrations,
        mode: "apply",
      }),
    ).resolves.toEqual({ mode: "apply" });
  });

  it("accepts a strictly newer ledger suffix at startup but not as an exact postcondition", async () => {
    const context = await freshContext();
    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });
    await context.client.exec(`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT 'future-migration', max(created_at) + 1
      FROM drizzle.__drizzle_migrations
    `);

    await expect(
      assertMigrationsCompatible(context.queryMigrations),
    ).resolves.toBeUndefined();
    await expect(
      assertMigrationsExactlyCurrent(context.queryMigrations),
    ).rejects.toThrow("not an exact match");
  });

  it("rejects an edited known migration at startup", async () => {
    const context = await freshContext();
    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });
    await context.client.exec(`
      UPDATE drizzle.__drizzle_migrations SET hash = 'edited'
    `);

    await expect(
      assertMigrationsCompatible(context.queryMigrations),
    ).rejects.toThrow("edited or reordered migration prefix");
  });

  it("validates canonical ledger shape and prefix before apply mutation", async () => {
    const context = await freshContext();
    await runPgliteMigrations({
      db: context.db,
      query: context.queryMigrations,
      mode: "apply",
    });
    await context.client.exec(`
      ALTER TABLE drizzle.__drizzle_migrations
      ADD COLUMN unexpected text
    `);

    await expect(
      runPgliteMigrations({
        db: context.db,
        query: context.queryMigrations,
        mode: "apply",
      }),
    ).rejects.toThrow("migration ledger columns");
    const tables = await context.client.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(tables.rows[0]?.count).toBe(18);
  });
});
