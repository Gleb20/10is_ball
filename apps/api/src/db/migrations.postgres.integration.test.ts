import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  assertMigrationsExactlyCurrent,
  runPostgresMigrations,
  type MigrationQuery,
} from "./migrations.js";
import { resolveTestDatabaseUrl } from "./test-database-url.js";

const baselineSqlPath = fileURLToPath(
  new URL("../../drizzle/0000_data_003_baseline.sql", import.meta.url),
);
const databaseUrl = resolveTestDatabaseUrl(process.env, {
  required: process.env.REQUIRE_TEST_DATABASE_URL === "1",
});
const describePostgres = databaseUrl ? describe : describe.skip;
const runtimeRole = "tab10_runtime_migration_test";

async function withClient<T>(
  run: (client: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
  const client = postgres(databaseUrl!, { max: 1 });
  try {
    return await run(client);
  } finally {
    await client.end({ timeout: 5 });
  }
}

const queryMigrations = (
  client: ReturnType<typeof postgres>,
): MigrationQuery =>
  async (query) =>
    (await client.unsafe(query)) as Array<Record<string, unknown>>;

async function resetDatabase(): Promise<void> {
  await withClient(async (client) => {
    await client.unsafe(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public
    `);
  });
}

async function createHistoricalBaseline(): Promise<void> {
  const sql = await readFile(baselineSqlPath, "utf8");
  await withClient(async (client) => {
    await client.unsafe(sql);
  });
}

async function expectLedgerCount(expected: number): Promise<void> {
  await withClient(async (client) => {
    const exists = await client<{ exists: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
    `;
    if (exists[0]?.exists !== true) {
      expect(expected).toBe(0);
      return;
    }
    const rows = await client<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
    `;
    expect(rows[0]?.count).toBe(expected);
  });
}

async function removeRuntimeRole(): Promise<void> {
  await withClient(async (client) => {
    const roles = await client<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${runtimeRole}
      ) AS exists
    `;
    if (roles[0]?.exists !== true) return;
    await client.unsafe(`DROP OWNED BY ${runtimeRole}`);
    await client.unsafe(`DROP ROLE ${runtimeRole}`);
  });
}

async function createRuntimeRole(options: { privileged?: boolean } = {}) {
  await removeRuntimeRole();
  await withClient(async (client) => {
    await client.unsafe(
      `CREATE ROLE ${runtimeRole} LOGIN ${options.privileged ? "CREATEDB" : "NOCREATEDB"} NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
  });
}

async function provisionRuntimeDefaults(): Promise<void> {
  await withClient(async (client) => {
    await client.unsafe("CREATE SCHEMA drizzle");
    await client.unsafe(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
    await client.unsafe(`GRANT USAGE ON SCHEMA drizzle TO ${runtimeRole}`);
    await client.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole}`,
    );
    await client.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${runtimeRole}`,
    );
    await client.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO ${runtimeRole}`,
    );
  });
}

const hostedEnvironment = {
  TAB10_ENVIRONMENT: "staging",
  TAB10_RUNTIME_DATABASE_ROLE: runtimeRole,
} as const;

async function normalizedPublicCatalogProfile() {
  return withClient(async (client) => {
    const columns = await client<
      {
        table_name: string;
        column_name: string;
        data_type: string;
        not_null: boolean;
        default_expression: string;
      }[]
    >`
      SELECT relation.relname AS table_name,
             attribute.attname AS column_name,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
             attribute.attnotnull AS not_null,
             COALESCE(
               pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid, true),
               ''
             ) AS default_expression
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef AS default_record
        ON default_record.adrelid = attribute.attrelid
       AND default_record.adnum = attribute.attnum
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum
    `;
    const constraints = await client<
      {
        table_name: string;
        constraint_name: string;
        constraint_type: string;
        is_validated: boolean;
        is_deferrable: boolean;
        is_initially_deferred: boolean;
        match_type: string;
        definition: string;
      }[]
    >`
      SELECT relation.relname AS table_name,
             constraint_record.conname AS constraint_name,
             constraint_record.contype AS constraint_type,
             constraint_record.convalidated AS is_validated,
             constraint_record.condeferrable AS is_deferrable,
             constraint_record.condeferred AS is_initially_deferred,
             constraint_record.confmatchtype AS match_type,
             pg_catalog.pg_get_constraintdef(constraint_record.oid, true) AS definition
      FROM pg_catalog.pg_constraint AS constraint_record
      JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY relation.relname, constraint_record.conname
    `;
    const indexes = await client<
      {
        table_name: string;
        index_name: string;
        definition: string;
        is_valid: boolean;
        is_ready: boolean;
        is_live: boolean;
      }[]
    >`
      SELECT table_relation.relname AS table_name,
             index_relation.relname AS index_name,
             pg_catalog.pg_get_indexdef(index_record.indexrelid, 0, true) AS definition,
             index_record.indisvalid AS is_valid,
             index_record.indisready AS is_ready,
             index_record.indislive AS is_live
      FROM pg_catalog.pg_index AS index_record
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_record.indexrelid
      JOIN pg_catalog.pg_class AS table_relation
        ON table_relation.oid = index_record.indrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_relation.relnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY table_relation.relname, index_relation.relname
    `;
    const enums = await client<
      { enum_name: string; position: number; enum_value: string }[]
    >`
      SELECT type_record.typname AS enum_name,
             enum_value.enumsortorder AS position,
             enum_value.enumlabel AS enum_value
      FROM pg_catalog.pg_type AS type_record
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = type_record.typnamespace
      JOIN pg_catalog.pg_enum AS enum_value
        ON enum_value.enumtypid = type_record.oid
      WHERE namespace.nspname = 'public'
      ORDER BY type_record.typname, enum_value.enumsortorder
    `;
    return { columns, constraints, indexes, enums };
  });
}

async function insertFaqWithoutId(): Promise<string> {
  return withClient(async (client) => {
    const rows = await client<{ id: string }[]>`
      INSERT INTO faq_articles (category, title, body, sort_order)
      VALUES ('delivery', 'UUID default', 'synthetic', 0)
      RETURNING id::text AS id
    `;
    return rows[0]!.id;
  });
}

describePostgres.sequential(
  "migration foundation on a guarded disposable PostgreSQL database",
  () => {
    it("creates a fresh 18-table database and repeats as a no-op", async () => {
      await resetDatabase();

      await runPostgresMigrations(databaseUrl!, "apply");
      await runPostgresMigrations(databaseUrl!, "apply");

      await withClient(async (client) => {
        await expect(
          assertMigrationsExactlyCurrent(queryMigrations(client)),
        ).resolves.toBeUndefined();
        const tables = await client<{ table_name: string }[]>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `;
        expect(tables).toHaveLength(18);
      });
      await expectLedgerCount(5);
    });

    it("produces the same exact catalog and database-generated UUIDs for fresh and adopted baselines", async () => {
      await resetDatabase();
      await runPostgresMigrations(databaseUrl!, "apply");
      const freshProfile = await normalizedPublicCatalogProfile();
      const freshId = await insertFaqWithoutId();

      await resetDatabase();
      await createHistoricalBaseline();
      await runPostgresMigrations(databaseUrl!, "adopt-unversioned");
      const adoptedProfile = await normalizedPublicCatalogProfile();
      const adoptedId = await insertFaqWithoutId();

      expect(adoptedProfile).toEqual(freshProfile);
      const uuidDefaults = freshProfile.columns.filter(
        (column) => column.column_name === "id" && column.data_type === "uuid",
      );
      expect(uuidDefaults).toHaveLength(17);
      expect(
        uuidDefaults.every(
          (column) => column.default_expression === "gen_random_uuid()",
        ),
      ).toBe(true);
      expect(freshId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(adoptedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("adopts the exact historical schema and preserves/backfills rows", async () => {
      await resetDatabase();
      await createHistoricalBaseline();
      await withClient(async (client) => {
        await client.unsafe(`
          INSERT INTO users (
            id, email, password_hash, first_name, last_name
          ) VALUES (
            '00000000-0000-4000-8000-000000000001',
            'historical@tab10.test',
            'synthetic-hash',
            'Historical',
            'Owner'
          );
          INSERT INTO tournaments (
            id, title, created_by_user_id,
            bracket_json, bracket_construction_algorithm
          ) VALUES
            (
              '00000000-0000-4000-8000-000000000011',
              'V2 power',
              '00000000-0000-4000-8000-000000000001',
              '{"schemaVersion":2,"format":"single_elimination"}'::jsonb,
              NULL
            ),
            (
              '00000000-0000-4000-8000-000000000012',
              'V2 compact',
              '00000000-0000-4000-8000-000000000001',
              '{"schemaVersion":2,"format":"single_elimination","constructionAlgorithm":"compact"}'::jsonb,
              NULL
            ),
            (
              '00000000-0000-4000-8000-000000000013',
              'V1 compact',
              '00000000-0000-4000-8000-000000000001',
              '{"schemaVersion":1,"format":"single_elimination","slots":[]}'::jsonb,
              NULL
            ),
            (
              '00000000-0000-4000-8000-000000000014',
              'Protected',
              '00000000-0000-4000-8000-000000000001',
              '{"schemaVersion":2,"format":"double_elimination","constructionAlgorithm":"custom"}'::jsonb,
              NULL
            )
        `);
      });

      await runPostgresMigrations(databaseUrl!, "adopt-unversioned");

      await withClient(async (client) => {
        const rows = await client<
          { title: string; algorithm: string | null }[]
        >`
          SELECT title, bracket_construction_algorithm AS algorithm
          FROM tournaments
          ORDER BY id
        `;
        expect(rows).toEqual([
          { title: "V2 power", algorithm: "power_of_two" },
          { title: "V2 compact", algorithm: "compact" },
          { title: "V1 compact", algorithm: "compact" },
          { title: "Protected", algorithm: null },
        ]);
        const user = await client<{ email: string }[]>`
          SELECT email FROM users
          WHERE id = '00000000-0000-4000-8000-000000000001'
        `;
        expect(user).toEqual([{ email: "historical@tab10.test" }]);
      });
      await expectLedgerCount(5);
    });

    it("rejects duplicate active participants in a bracket without mutating rows or recording migrations", async () => {
      await resetDatabase();
      await createHistoricalBaseline();
      await withClient(async (client) => {
        await client.unsafe(`
          INSERT INTO users (
            id, email, password_hash, first_name, last_name
          ) VALUES (
            '00000000-0000-4000-8000-000000000021',
            'duplicate-bracket@tab10.test',
            'synthetic-hash',
            'Duplicate',
            'Participant'
          );
          INSERT INTO tournaments (
            id, title, created_by_user_id, status,
            bracket_json, bracket_construction_algorithm
          ) VALUES (
            '00000000-0000-4000-8000-000000000022',
            'Duplicate bracket participants',
            '00000000-0000-4000-8000-000000000021',
            'bracket_generated',
            '{"schemaVersion":2,"format":"single_elimination"}'::jsonb,
            NULL
          );
          INSERT INTO tournament_participants (
            id, tournament_id, user_id, status
          ) VALUES
            (
              '00000000-0000-4000-8000-000000000023',
              '00000000-0000-4000-8000-000000000022',
              '00000000-0000-4000-8000-000000000021',
              'active'
            ),
            (
              '00000000-0000-4000-8000-000000000024',
              '00000000-0000-4000-8000-000000000022',
              '00000000-0000-4000-8000-000000000021',
              'active'
            );
        `);
      });

      await expect(
        runPostgresMigrations(databaseUrl!, "adopt-unversioned"),
      ).rejects.toThrow("DATA_004_DUPLICATE_BRACKET_PARTICIPANTS");

      await withClient(async (client) => {
        const participants = await client<
          { id: string; status: string }[]
        >`
          SELECT id::text, status
          FROM tournament_participants
          WHERE tournament_id = '00000000-0000-4000-8000-000000000022'
          ORDER BY id
        `;
        expect(participants).toEqual([
          {
            id: "00000000-0000-4000-8000-000000000023",
            status: "active",
          },
          {
            id: "00000000-0000-4000-8000-000000000024",
            status: "active",
          },
        ]);
      });
      await expectLedgerCount(0);
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
        drift: "column collation",
        mutate: `
          ALTER TABLE users
            ALTER COLUMN first_name TYPE text COLLATE "C"
        `,
      },
      {
        drift: "index",
        mutate: `
          DROP INDEX users_email_unique;
          CREATE UNIQUE INDEX users_email_unique ON users (first_name)
        `,
      },
      {
        drift: "index INCLUDE columns",
        mutate: `
          DROP INDEX users_email_unique;
          CREATE UNIQUE INDEX users_email_unique
            ON users (email) INCLUDE (first_name)
        `,
      },
      {
        drift: "index sort, operator class and collation",
        mutate: `
          DROP INDEX users_email_unique;
          CREATE UNIQUE INDEX users_email_unique ON users (
            email COLLATE "C" text_pattern_ops DESC NULLS FIRST
          )
        `,
      },
      {
        drift: "constraint",
        mutate: `
          ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_user_id_fkey
        `,
      },
      {
        drift: "constraint name",
        mutate: `
          ALTER TABLE auth_sessions
          RENAME CONSTRAINT auth_sessions_user_id_fkey TO unexpected_user_fk
        `,
      },
      {
        drift: "unvalidated constraint",
        mutate: `
          ALTER TABLE auth_sessions
            DROP CONSTRAINT auth_sessions_user_id_fkey;
          ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID
        `,
      },
      {
        drift: "deferrable constraint",
        mutate: `
          ALTER TABLE auth_sessions
            DROP CONSTRAINT auth_sessions_user_id_fkey;
          ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id)
            DEFERRABLE INITIALLY IMMEDIATE
        `,
      },
      {
        drift: "initially deferred constraint",
        mutate: `
          ALTER TABLE auth_sessions
            DROP CONSTRAINT auth_sessions_user_id_fkey;
          ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id)
            DEFERRABLE INITIALLY DEFERRED
        `,
      },
      {
        drift: "foreign key match type",
        mutate: `
          ALTER TABLE auth_sessions
            DROP CONSTRAINT auth_sessions_user_id_fkey;
          ALTER TABLE auth_sessions
            ADD CONSTRAINT auth_sessions_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) MATCH FULL
        `,
      },
      {
        drift: "constraint-backed unique index semantics",
        mutate: `
          ALTER TABLE teams DROP CONSTRAINT teams_slug_key;
          ALTER TABLE teams
            ADD CONSTRAINT teams_slug_key UNIQUE NULLS NOT DISTINCT (slug)
        `,
      },
    ])("rejects corrupt $drift before mutation", async ({ mutate }) => {
      await resetDatabase();
      await createHistoricalBaseline();
      await withClient(async (client) => {
        await client.unsafe(mutate);
      });

      await expect(
        runPostgresMigrations(databaseUrl!, "adopt-unversioned"),
      ).rejects.toThrow("Database schema drift");
      await expectLedgerCount(0);
    });

    it("rolls back a failed migration and retries from a canonical empty ledger", async () => {
      await resetDatabase();
      await createHistoricalBaseline();
      await withClient(async (client) => {
        await client.unsafe(`
          INSERT INTO users (
            id, email, password_hash, first_name, last_name
          ) VALUES (
            '00000000-0000-4000-8000-000000000001',
            'rollback@tab10.test', 'synthetic-hash', 'Rollback', 'Owner'
          );
          INSERT INTO tournaments (
            id, title, created_by_user_id,
            bracket_json, bracket_construction_algorithm
          ) VALUES (
            '00000000-0000-4000-8000-000000000011', 'Rollback bracket',
            '00000000-0000-4000-8000-000000000001',
            '{"schemaVersion":2,"format":"single_elimination"}'::jsonb,
            NULL
          )
        `);
      });
      const blocker = postgres(databaseUrl!, { max: 1 });
      try {
        await blocker.unsafe("BEGIN");
        await blocker.unsafe("LOCK TABLE matches IN ACCESS EXCLUSIVE MODE");

        await expect(
          runPostgresMigrations(databaseUrl!, "adopt-unversioned", {
            lockTimeoutMs: 100,
            statementTimeoutMs: 2_000,
          }),
        ).rejects.toThrow();
        await expectLedgerCount(0);
        await withClient(async (client) => {
          const rows = await client<
            { bracket_construction_algorithm: string | null }[]
          >`
            SELECT bracket_construction_algorithm
            FROM tournaments
            WHERE id = '00000000-0000-4000-8000-000000000011'
          `;
          expect(rows).toEqual([{ bracket_construction_algorithm: null }]);
        });
      } finally {
        await blocker.unsafe("ROLLBACK").catch(() => undefined);
        await blocker.end({ timeout: 5 });
      }

      const retryEvidence = await runPostgresMigrations(
        databaseUrl!,
        "adopt-unversioned",
      );
      expect(retryEvidence.adoption?.candidateCounts).toMatchObject({
        "v2-power-of-two": 1,
      });
      expect(retryEvidence.adoption?.actualAfterDigest).toBe(
        retryEvidence.adoption?.expectedAfterDigest,
      );
      await expectLedgerCount(5);
    });

    it("serializes concurrent migrators into one baseline and repeatable no-ops", async () => {
      await resetDatabase();

      const results = await Promise.allSettled([
        runPostgresMigrations(databaseUrl!, "apply"),
        runPostgresMigrations(databaseUrl!, "apply"),
        runPostgresMigrations(databaseUrl!, "apply"),
      ]);

      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      await expectLedgerCount(5);
      await withClient(async (client) => {
        await expect(
          assertMigrationsExactlyCurrent(queryMigrations(client)),
        ).resolves.toBeUndefined();
      });
    });

    it("supports the disposable hosted owner-only fresh and repeated apply", async () => {
      await resetDatabase();

      const environment = { TAB10_ENVIRONMENT: "staging" } as const;
      await runPostgresMigrations(databaseUrl!, "apply", { environment });
      await runPostgresMigrations(databaseUrl!, "apply", { environment });

      await expectLedgerCount(5);
      await withClient(async (client) => {
        await expect(
          assertMigrationsExactlyCurrent(queryMigrations(client)),
        ).resolves.toBeUndefined();
      });
    });

    it("requires hosted runtime privileges to be preprovisioned before mutation", async () => {
      await resetDatabase();
      await createRuntimeRole();
      try {
        await withClient(async (client) => {
          await client.unsafe("CREATE SCHEMA drizzle");
          await client.unsafe(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
          await client.unsafe(`GRANT USAGE ON SCHEMA drizzle TO ${runtimeRole}`);
        });

        await expect(
          runPostgresMigrations(databaseUrl!, "apply", {
            environment: hostedEnvironment,
          }),
        ).rejects.toThrow("default privileges must be provisioned");
        await expectLedgerCount(0);
        await withClient(async (client) => {
          const tables = await client<{ count: number }[]>`
            SELECT count(*)::integer AS count
            FROM information_schema.tables
            WHERE table_schema = 'public'
          `;
          expect(tables[0]?.count).toBe(0);
        });
      } finally {
        await removeRuntimeRole();
      }
    });

    it("rejects an elevated runtime role before mutation", async () => {
      await resetDatabase();
      await createRuntimeRole({ privileged: true });
      try {
        await expect(
          runPostgresMigrations(databaseUrl!, "apply", {
            environment: hostedEnvironment,
          }),
        ).rejects.toThrow("distinct least-privileged login role");
        await expectLedgerCount(0);
      } finally {
        await removeRuntimeRole();
      }
    });

    it("verifies preprovisioned runtime grants on fresh and repeated apply", async () => {
      await resetDatabase();
      await createRuntimeRole();
      try {
        await provisionRuntimeDefaults();
        await runPostgresMigrations(databaseUrl!, "apply", {
          environment: hostedEnvironment,
        });
        await runPostgresMigrations(databaseUrl!, "apply", {
          environment: hostedEnvironment,
        });

        await withClient(async (client) => {
          const privileges = await client<
            {
              public_dml: boolean;
              ledger_select: boolean;
              ledger_insert: boolean;
            }[]
          >`
            SELECT
              bool_and(
                pg_catalog.has_table_privilege(
                  ${runtimeRole},
                  quote_ident(table_schema) || '.' || quote_ident(table_name),
                  'SELECT, INSERT, UPDATE, DELETE'
                )
              ) AS public_dml,
              pg_catalog.has_table_privilege(
                ${runtimeRole},
                'drizzle.__drizzle_migrations',
                'SELECT'
              ) AS ledger_select,
              pg_catalog.has_table_privilege(
                ${runtimeRole},
                'drizzle.__drizzle_migrations',
                'INSERT'
              ) AS ledger_insert
            FROM information_schema.tables
            WHERE table_schema = 'public'
          `;
          expect(privileges).toEqual([
            {
              public_dml: true,
              ledger_select: true,
              ledger_insert: false,
            },
          ]);
        });
      } finally {
        await resetDatabase();
        await removeRuntimeRole();
      }
    });
  },
);
