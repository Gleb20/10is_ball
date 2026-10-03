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
    expect(tables.rows.map((row) => row.table_name)).toHaveLength(23);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("upgrades a %i-migration released prefix without changing existing rows", async (prefixLength) => {
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
    if (prefixLength === 12) {
      await context.client.exec(`INSERT INTO teams (id, name, slug, captain_user_id)
        VALUES ('00000000-0000-4000-8000-000000000097', 'Legacy team', 'legacy-team', '00000000-0000-4000-8000-000000000091')`);
    }
    if (prefixLength === 11) {
      await context.client.exec(`
        INSERT INTO tournaments (id, title, created_by_user_id, status)
        VALUES ('00000000-0000-4000-8000-000000000098', 'Legacy guest tournament', '00000000-0000-4000-8000-000000000091', 'collecting');
        INSERT INTO tournament_participants (
          id, tournament_id, guest_first_name, guest_last_name, guest_avatar_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000099',
          '00000000-0000-4000-8000-000000000098',
          'Legacy', 'Guest', 'avatar_1'
        );
      `);
    }
    if (prefixLength === 6) {
      await context.client.exec(`
        INSERT INTO tournaments (id, title, created_by_user_id, status)
        VALUES
          ('00000000-0000-4000-8000-000000000092', 'Historical waiting', '00000000-0000-4000-8000-000000000091', 'collecting'),
          ('00000000-0000-4000-8000-000000000093', 'Historical finished', '00000000-0000-4000-8000-000000000091', 'finished');
        INSERT INTO tournament_participants (id, tournament_id, user_id)
        VALUES ('00000000-0000-4000-8000-000000000094', '00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000091');
      `);
    }

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
    if (prefixLength === 12) {
      const team = await context.client.query(`SELECT name, slug, captain_user_id::text, avatar_key
        FROM teams WHERE id = '00000000-0000-4000-8000-000000000097'`);
      expect(team.rows).toEqual([{ name: 'Legacy team', slug: 'legacy-team',
        captain_user_id: '00000000-0000-4000-8000-000000000091', avatar_key: null }]);
    }

    if (prefixLength === 11) {
      const legacyGuest = await context.client.query<{ guest_identity_id: string | null }>(`
        SELECT guest_identity_id FROM tournament_participants
        WHERE id = '00000000-0000-4000-8000-000000000099'
      `);
      expect(legacyGuest.rows).toEqual([{ guest_identity_id: null }]);
    }
    const auditTable = await context.client.query<{ name: string }>(`
      SELECT to_regclass('public.match_void_audits')::text AS name
    `);
    expect(auditTable.rows).toEqual([{ name: "match_void_audits" }]);
    if (prefixLength === 6) {
      const tournaments = await context.client.query<{ title: string; consent: boolean }>(`
        SELECT title, require_participant_consent AS consent
        FROM tournaments
        WHERE id IN ('00000000-0000-4000-8000-000000000092', '00000000-0000-4000-8000-000000000093')
        ORDER BY id
      `);
      expect(tournaments.rows).toEqual([
        { title: "Historical waiting", consent: false },
        { title: "Historical finished", consent: false },
      ]);
      const participant = await context.client.query<{ source: string; actor: string | null }>(`
        SELECT addition_source AS source, added_by_user_id::text AS actor
        FROM tournament_participants
        WHERE id = '00000000-0000-4000-8000-000000000094'
      `);
      expect(participant.rows).toEqual([{ source: "legacy", actor: null }]);
    }
    await expect(
      assertMigrationsExactlyCurrent(context.queryMigrations),
    ).resolves.toBeUndefined();
  });

  it("rolls back team avatar DDL without changing an existing team", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-gap025-rollback-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 12);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000101', 'avatar-rollback@tab10.test', 'synthetic', 'Rollback', 'Owner');
      INSERT INTO teams (id, name, slug, captain_user_id)
      VALUES ('00000000-0000-4000-8000-000000000102', 'Rollback team', 'rollback-team', '00000000-0000-4000-8000-000000000101');
    `);
    const before = await context.client.query(`SELECT to_jsonb(teams) AS payload FROM teams`);
    const migrationSql = await readFile(join(artifactDirectory, "0012_gap_025_team_avatar.sql"), "utf8");
    await context.client.exec(`BEGIN;\n${migrationSql}\nROLLBACK;`);
    const after = await context.client.query(`SELECT to_jsonb(teams) AS payload FROM teams`);
    expect(after.rows).toEqual(before.rows);
    const column = await context.client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'avatar_key'`);
    expect(column.rows).toEqual([]);
  });

  it("rolls back the reusable-guest DDL and preserves pre-0011 guest snapshots", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-gap040-rollback-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 11);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000101', 'gap040-rollback@tab10.test', 'synthetic', 'Rollback', 'Owner');
      INSERT INTO tournaments (id, title, created_by_user_id, status)
      VALUES ('00000000-0000-4000-8000-000000000102', 'Rollback guest tournament', '00000000-0000-4000-8000-000000000101', 'collecting');
      INSERT INTO tournament_participants (id, tournament_id, guest_first_name, guest_last_name, guest_avatar_key)
      VALUES ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000102', 'Old', 'Guest', 'avatar_2');
    `);
    const migrationSql = (await readFile(join(artifactDirectory, "0011_gap_040_reusable_guest_identities.sql"), "utf8"))
      .replaceAll("--> statement-breakpoint", "\n");
    await context.client.exec(`BEGIN;\n${migrationSql}\nROLLBACK;`);
    const catalog = await context.client.query<{ identities: boolean; participant_column: boolean }>(`
      SELECT
        to_regclass('public.guest_identities') IS NOT NULL AS identities,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'tournament_participants'
            AND column_name = 'guest_identity_id'
        ) AS participant_column
    `);
    expect(catalog.rows).toEqual([{ identities: false, participant_column: false }]);
    const legacy = await context.client.query<{ first_name: string; last_name: string }>(`
      SELECT guest_first_name AS first_name, guest_last_name AS last_name
      FROM tournament_participants
      WHERE id = '00000000-0000-4000-8000-000000000103'
    `);
    expect(legacy.rows).toEqual([{ first_name: "Old", last_name: "Guest" }]);
  });

  it("rolls back the GAP-012 DDL and preserves pre-0006 rows in a disposable transaction", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-gap012-rollback-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 6);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000095', 'rollback@tab10.test', 'synthetic', 'Rollback', 'Owner');
      INSERT INTO tournaments (id, title, created_by_user_id, status)
      VALUES ('00000000-0000-4000-8000-000000000096', 'Rollback tournament', '00000000-0000-4000-8000-000000000095', 'collecting');
    `);
    const migrationSql = (await readFile(join(artifactDirectory, "0006_gap_012_game_setup.sql"), "utf8"))
      .replaceAll("--> statement-breakpoint", "\n");
    await context.client.exec(`BEGIN;\n${migrationSql}\nROLLBACK;`);
    const absent = await context.client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tournaments'
          AND column_name = 'require_participant_consent'
      ) AS exists
    `);
    expect(absent.rows).toEqual([{ exists: false }]);
    const row = await context.client.query<{ title: string; status: string }>(`
      SELECT title, status FROM tournaments
      WHERE id = '00000000-0000-4000-8000-000000000096'
    `);
    expect(row.rows).toEqual([{ title: "Rollback tournament", status: "collecting" }]);
  });

  it("rolls back the BUG-038 DDL and preserves pre-0007 users", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-bug038-rollback-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 7);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000097', 'bug038-rollback@tab10.test', 'synthetic', 'Rollback', 'BUG038');
    `);
    const migrationSql = (await readFile(
      join(artifactDirectory, "0007_bug_038_correlated_password_reset.sql"),
      "utf8",
    )).replaceAll("--> statement-breakpoint", "\n");
    await context.client.exec(`BEGIN;\n${migrationSql}\nROLLBACK;`);
    const catalog = await context.client.query<{
      receipt_table: boolean;
      pointer_column: boolean;
    }>(`
      SELECT
        to_regclass('public.admin_password_reset_requests') IS NOT NULL AS receipt_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
            AND column_name = 'last_admin_password_reset_request_id'
        ) AS pointer_column
    `);
    expect(catalog.rows).toEqual([
      { receipt_table: false, pointer_column: false },
    ]);
    const row = await context.client.query<{ email: string }>(`
      SELECT email FROM users
      WHERE id = '00000000-0000-4000-8000-000000000097'
    `);
    expect(row.rows).toEqual([{ email: "bug038-rollback@tab10.test" }]);
  });

  it("rolls back the GAP-013 receipt DDL and preserves pre-0008 users", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-gap013-rollback-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 8);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000098', 'gap013-rollback@tab10.test', 'synthetic', 'Rollback', 'GAP013');
    `);
    const migrationSql = (await readFile(
      join(artifactDirectory, "0008_gap_013_atomic_match_launch.sql"),
      "utf8",
    )).replaceAll("--> statement-breakpoint", "\n");
    await context.client.exec(`BEGIN;\n${migrationSql}\nROLLBACK;`);
    const catalog = await context.client.query<{ receipt_table: boolean }>(`
      SELECT to_regclass('public.match_launch_requests') IS NOT NULL AS receipt_table
    `);
    expect(catalog.rows).toEqual([{ receipt_table: false }]);
    const row = await context.client.query<{ email: string }>(`
      SELECT email FROM users
      WHERE id = '00000000-0000-4000-8000-000000000098'
    `);
    expect(row.rows).toEqual([{ email: "gap013-rollback@tab10.test" }]);
  });

  it("backfills only an exact unplayed launch receipt and leaves ambiguous legacy facts unavailable", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-gap032-prefix-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 9);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000099', 'gap032-prefix@tab10.test', 'synthetic', 'GAP032', 'Owner');
      INSERT INTO matches (id, title, created_by_user_id, status, current_server_participant_id, event_log)
      VALUES
        ('00000000-0000-4000-8000-000000032091', 'Exact', '00000000-0000-4000-8000-000000000099', 'in_progress', '00000000-0000-4000-8000-000000032081', '[]'::jsonb),
        ('00000000-0000-4000-8000-000000032092', 'Diverged', '00000000-0000-4000-8000-000000000099', 'in_progress', '00000000-0000-4000-8000-000000032082', '[]'::jsonb),
        ('00000000-0000-4000-8000-000000032093', 'Played', '00000000-0000-4000-8000-000000000099', 'in_progress', '00000000-0000-4000-8000-000000032083', '[{"type":"point_awarded"}]'::jsonb);
      INSERT INTO match_launch_requests (
        actor_user_id, request_id, originating_auth_session_id,
        request_fingerprint, match_id, initial_server_participant_id, slot_map
      ) VALUES
        ('00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000032071', '00000000-0000-4000-8000-000000032061', 'exact', '00000000-0000-4000-8000-000000032091', '00000000-0000-4000-8000-000000032081', '{}'::jsonb),
        ('00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000032072', '00000000-0000-4000-8000-000000032062', 'diverged', '00000000-0000-4000-8000-000000032092', '00000000-0000-4000-8000-000000032080', '{}'::jsonb),
        ('00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000032073', '00000000-0000-4000-8000-000000032063', 'played', '00000000-0000-4000-8000-000000032093', '00000000-0000-4000-8000-000000032083', '{}'::jsonb);
    `);

    await runPgliteMigrations({ db: context.db, query: context.queryMigrations, mode: "apply" });

    const rows = await context.client.query<{
      title: string;
      initial_server_participant_id: string | null;
      playing_elapsed_ms: number | null;
      judge_history_complete: boolean;
    }>(`
      SELECT title, initial_server_participant_id::text,
             playing_elapsed_ms::integer, judge_history_complete
      FROM matches
      WHERE id IN (
        '00000000-0000-4000-8000-000000032091',
        '00000000-0000-4000-8000-000000032092',
        '00000000-0000-4000-8000-000000032093'
      )
      ORDER BY id
    `);
    expect(rows.rows).toEqual([
      {
        title: "Exact",
        initial_server_participant_id: "00000000-0000-4000-8000-000000032081",
        playing_elapsed_ms: null,
        judge_history_complete: false,
      },
      {
        title: "Diverged",
        initial_server_participant_id: null,
        playing_elapsed_ms: null,
        judge_history_complete: false,
      },
      {
        title: "Played",
        initial_server_participant_id: null,
        playing_elapsed_ms: null,
        judge_history_complete: false,
      },
    ]);
  });

  it("rolls back the GAP-032 DDL and preserves pre-0009 rows", async () => {
    const context = await freshContext();
    const prefixDirectory = await mkdtemp(join(tmpdir(), "tab10-gap032-rollback-"));
    temporaryDirectories.push(prefixDirectory);
    const artifactDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const journal = JSON.parse(await readFile(join(artifactDirectory, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 9);
    for (const entry of journal.entries) {
      await writeFile(join(prefixDirectory, `${entry.tag}.sql`), await readFile(join(artifactDirectory, `${entry.tag}.sql`)));
    }
    await mkdir(join(prefixDirectory, "meta"));
    await writeFile(join(prefixDirectory, "meta/_journal.json"), JSON.stringify(journal));
    await applyPgliteMigrationFiles(context.db, prefixDirectory);
    await context.client.exec(`
      INSERT INTO users (id, email, password_hash, first_name, last_name)
      VALUES ('00000000-0000-4000-8000-000000000100', 'gap032-rollback@tab10.test', 'synthetic', 'Rollback', 'GAP032');
    `);
    const migrationSql = (await readFile(
      join(artifactDirectory, "0009_gap_032_match_facts.sql"),
      "utf8",
    )).replaceAll("--> statement-breakpoint", "\n");
    await context.client.exec(`BEGIN;\n${migrationSql}\nROLLBACK;`);
    const columns = await context.client.query<{ count: number }>(`
      SELECT count(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'matches' AND column_name IN (
            'initial_server_participant_id', 'playing_elapsed_ms',
            'playing_segment_started_at', 'judge_history_complete'
          ))
          OR (table_name = 'judge_sessions' AND column_name = 'activated_at')
        )
    `);
    expect(columns.rows).toEqual([{ count: 0 }]);
    const row = await context.client.query<{ email: string }>(`
      SELECT email FROM users
      WHERE id = '00000000-0000-4000-8000-000000000100'
    `);
    expect(row.rows).toEqual([{ email: "gap032-rollback@tab10.test" }]);
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
    expect(before.rows[0]?.count).toBe(13);
    expect(after.rows[0]?.count).toBe(13);
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
    expect(tables.rows[0]?.count).toBe(23);
  });
});
