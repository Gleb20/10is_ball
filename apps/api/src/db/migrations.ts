import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import postgres from "postgres";
import {
  requireMigrationDatabaseUrl,
  requireRuntimeDatabaseRole,
  type MigrationMode,
} from "./migration-database-url.js";

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

const BASELINE_SNAPSHOT_PATH = fileURLToPath(
  new URL("../../drizzle/meta/0000_snapshot.json", import.meta.url),
);

const MIGRATION_ADVISORY_LOCK = "7247010010001";
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 300_000;
const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 60_000;

export type MigrationQuery = (
  query: string,
) => Promise<ReadonlyArray<Record<string, unknown>>>;

type SnapshotColumn = {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  default?: string | number | boolean;
};

type SnapshotIndex = {
  name: string;
  columns: Array<{
    expression: string;
    asc?: boolean;
    nulls?: "first" | "last";
  }>;
  isUnique: boolean;
  method: string;
  where?: string;
};

type SnapshotForeignKey = {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
};

type SnapshotTable = {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  uniqueConstraints: Record<
    string,
    { name: string; columns: string[]; nullsNotDistinct?: boolean }
  >;
  compositePrimaryKeys: Record<string, { name: string; columns: string[] }>;
  checkConstraints: Record<string, { name: string; value: string }>;
};

type BaselineSnapshot = {
  tables: Record<string, SnapshotTable>;
  enums: Record<string, { name: string; values: string[] }>;
};

type AppliedMigration = {
  id: number;
  hash: string;
  createdAt: number;
};

type LedgerInspection =
  | { state: "absent"; rows: [] }
  | { state: "empty"; rows: [] }
  | { state: "nonempty"; rows: AppliedMigration[] };

type AdoptionBackfillRow = {
  id: string;
  bracketJson: string | null;
  protectedPayload: string;
  currentValue: string | null;
  classification: "v2-power-of-two" | "v2-compact" | "v1-compact" | null;
};

type AdoptionBackfillManifest = {
  beforeRowCount: number;
  beforeDigest: string;
  candidateCounts: Record<string, number>;
  expectedAfterRowCount: number;
  expectedAfterDigest: string;
};

export type AdoptionBackfillEvidence = AdoptionBackfillManifest & {
  actualAfterRowCount: number;
  actualAfterDigest: string;
};

export type MigrationRunEvidence = {
  mode: MigrationMode;
  adoption?: AdoptionBackfillEvidence;
};

export const ADOPTION_BACKFILL_MANIFEST = [
  {
    id: "v2-power-of-two",
    result: "power_of_two",
    description:
      "nullable V2 brackets whose constructionAlgorithm is absent or power_of_two",
  },
  {
    id: "v2-compact",
    result: "compact",
    description: "nullable V2 brackets whose constructionAlgorithm is compact",
  },
  {
    id: "v1-compact",
    result: "compact",
    description:
      "nullable V1 or schema-less single-elimination brackets with a slots array",
  },
] as const;

const baselineSnapshot = JSON.parse(
  readFileSync(BASELINE_SNAPSHOT_PATH, "utf8"),
) as BaselineSnapshot;

function expectedMigrations(migrationsFolder = MIGRATIONS_FOLDER) {
  return readMigrationFiles({ migrationsFolder });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNumber(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Migration ledger contains a non-integer value");
  }
  return result;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertEqualSet(
  label: string,
  expected: readonly string[],
  actual: readonly string[],
): void {
  const expectedSorted = sorted(expected);
  const actualSorted = sorted(actual);
  if (
    expectedSorted.length !== actualSorted.length ||
    expectedSorted.some((value, index) => value !== actualSorted[index])
  ) {
    const missing = expectedSorted.filter((value) => !actualSorted.includes(value));
    const unexpected = actualSorted.filter(
      (value) => !expectedSorted.includes(value),
    );
    throw new Error(
      `Database schema drift in ${label}; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
    );
  }
}

function normalizePredicate(value: string, tableName: string): string {
  return value
    .toLowerCase()
    .replaceAll('"', "")
    .replaceAll(`${tableName.toLowerCase()}.`, "")
    .replace(/[()\s]/g, "");
}

function normalizeAction(value: string | undefined): string {
  return (value ?? "no action").toLowerCase();
}

function normalizeDefault(value: unknown): string {
  return asString(value)
    .trim()
    .replace(
      /::(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*(?:\[\])?/gi,
      "",
    )
    .replace(/^\((.*)\)$/s, "$1")
    .replace(/\s+/g, " ");
}

function expectedDefault(column: SnapshotColumn, tableName: string): string {
  if (
    tableName === "tournaments" &&
    column.name === "bracket_construction_algorithm"
  ) {
    return "'compact'";
  }
  if (column.default === undefined) return "";
  return normalizeDefault(column.default);
}

function assertColumnDefaults(
  observed: ReadonlyArray<Record<string, unknown>>,
): void {
  const byColumn = new Map(
    observed.map((column) => [
      `${asString(column.table_name)}.${asString(column.column_name)}`,
      normalizeDefault(column.default_expression),
    ]),
  );
  const drift: string[] = [];
  for (const table of Object.values(baselineSnapshot.tables)) {
    for (const column of Object.values(table.columns)) {
      const key = `${table.name}.${column.name}`;
      const actual = byColumn.get(key) ?? "";
      const expected = expectedDefault(column, table.name);
      if (actual !== expected) {
        drift.push(`${key}: expected=${expected || "none"}, actual=${actual || "none"}`);
      }
    }
  }
  if (drift.length > 0) {
    throw new Error(`Database schema drift in column defaults; ${drift.join("; ")}`);
  }
}

function expectedTableNames(): string[] {
  return Object.values(baselineSnapshot.tables).map((table) => table.name);
}

function expectedColumnSignatures(): string[] {
  return Object.values(baselineSnapshot.tables).flatMap((table) =>
    Object.values(table.columns).map(
      (column) =>
        `${table.name}|${column.name}|${column.type}|${column.type === "text" ? "pg_catalog.default" : ""}|${column.notNull ? "not-null" : "nullable"}`,
    ),
  );
}

function expectedEnumSignatures(): string[] {
  return Object.values(baselineSnapshot.enums).map(
    (enumType) => `${enumType.name}|${enumType.values.join("\u001f")}`,
  );
}

function expectedBtreeOperatorClass(column: SnapshotColumn): string {
  switch (column.type) {
    case "text":
      return "pg_catalog.text_ops";
    case "uuid":
      return "pg_catalog.uuid_ops";
    default:
      throw new Error(
        `Baseline catalog profile is missing the btree operator class for ${column.type}`,
      );
  }
}

function expectedIndexKeySignature(
  table: SnapshotTable,
  {
    expression,
    asc = true,
    nulls = asc ? "last" : "first",
  }: {
    expression: string;
    asc?: boolean;
    nulls?: "first" | "last";
  },
): string {
  const column = table.columns[expression];
  if (!column) {
    throw new Error(
      `Baseline catalog profile cannot infer index semantics for ${table.name}.${expression}`,
    );
  }
  const collation = column.type === "text" ? "pg_catalog.default" : "";
  return `${expression}{${collation}|${expectedBtreeOperatorClass(column)}|${asc ? "asc" : "desc"}|nulls-${nulls}}`;
}

function expectedIndexKeySignatures(
  tableName: string,
  columns: readonly string[],
): string {
  const table = Object.values(baselineSnapshot.tables).find(
    (candidate) => candidate.name === tableName,
  );
  if (!table) {
    throw new Error(`Baseline catalog profile is missing table ${tableName}`);
  }
  return columns
    .map((expression) => expectedIndexKeySignature(table, { expression }))
    .join(",");
}

function implicitConstraintName(
  tableName: string,
  columns: readonly string[],
  suffix: "fkey" | "key" | "pkey",
): string {
  return [tableName, ...(suffix === "pkey" ? [] : columns), suffix].join("_");
}

function expectedConstraintSignature({
  tableName,
  constraintName,
  constraintType,
  columns = [],
  targetTable = "",
  targetColumns = [],
  onUpdate = "",
  onDelete = "",
  matchType = "",
  definition = "",
  backingIndex,
}: {
  tableName: string;
  constraintName: string;
  constraintType: "p" | "u" | "f" | "c";
  columns?: readonly string[];
  targetTable?: string;
  targetColumns?: readonly string[];
  onUpdate?: string;
  onDelete?: string;
  matchType?: string;
  definition?: string;
  backingIndex?: {
    name: string;
    columns: readonly string[];
    nullsNotDistinct?: boolean;
  };
}): string {
  return [
    tableName,
    constraintName,
    constraintType,
    columns.join(","),
    targetTable,
    targetColumns.join(","),
    onUpdate,
    onDelete,
    matchType,
    "not-deferrable",
    "initially-immediate",
    "validated",
    backingIndex?.name ?? "",
    backingIndex ? "btree" : "",
    backingIndex
      ? expectedIndexKeySignatures(tableName, backingIndex.columns)
      : "",
    "",
    backingIndex
      ? backingIndex.nullsNotDistinct
        ? "nulls-not-distinct"
        : "nulls-distinct"
      : "",
    backingIndex ? "immediate" : "",
    backingIndex ? "valid" : "",
    backingIndex ? "ready" : "",
    backingIndex ? "live" : "",
    definition,
  ].join("|");
}

function expectedConstraintSignatures(): string[] {
  return Object.values(baselineSnapshot.tables).flatMap((table) => {
    const signatures: string[] = [];
    const inlinePrimaryKey = Object.values(table.columns)
      .filter((column) => column.primaryKey)
      .map((column) => column.name);
    if (inlinePrimaryKey.length > 0) {
      signatures.push(
        expectedConstraintSignature({
          tableName: table.name,
          constraintName: implicitConstraintName(table.name, inlinePrimaryKey, "pkey"),
          constraintType: "p",
          columns: inlinePrimaryKey,
          backingIndex: {
            name: implicitConstraintName(table.name, inlinePrimaryKey, "pkey"),
            columns: inlinePrimaryKey,
          },
        }),
      );
    }
    for (const primaryKey of Object.values(table.compositePrimaryKeys)) {
      signatures.push(
        expectedConstraintSignature({
          tableName: table.name,
          constraintName:
            primaryKey.name ||
            implicitConstraintName(table.name, primaryKey.columns, "pkey"),
          constraintType: "p",
          columns: primaryKey.columns,
          backingIndex: {
            name:
              primaryKey.name ||
              implicitConstraintName(table.name, primaryKey.columns, "pkey"),
            columns: primaryKey.columns,
          },
        }),
      );
    }
    for (const unique of Object.values(table.uniqueConstraints)) {
      signatures.push(
        expectedConstraintSignature({
          tableName: table.name,
          // The immutable baseline mirrors the implicit names used by the
          // historical boot-time DDL, rather than Drizzle's generated label.
          constraintName: implicitConstraintName(table.name, unique.columns, "key"),
          constraintType: "u",
          columns: unique.columns,
          backingIndex: {
            name: implicitConstraintName(table.name, unique.columns, "key"),
            columns: unique.columns,
            nullsNotDistinct: unique.nullsNotDistinct,
          },
        }),
      );
    }
    for (const foreignKey of Object.values(table.foreignKeys)) {
      signatures.push(
        expectedConstraintSignature({
          tableName: foreignKey.tableFrom,
          constraintName: implicitConstraintName(
            foreignKey.tableFrom,
            foreignKey.columnsFrom,
            "fkey",
          ),
          constraintType: "f",
          columns: foreignKey.columnsFrom,
          targetTable: foreignKey.tableTo,
          targetColumns: foreignKey.columnsTo,
          onUpdate: normalizeAction(foreignKey.onUpdate),
          onDelete: normalizeAction(foreignKey.onDelete),
          matchType: "simple",
        }),
      );
    }
    for (const [snapshotName, check] of Object.entries(table.checkConstraints)) {
      signatures.push(
        expectedConstraintSignature({
          tableName: table.name,
          constraintName: check.name || snapshotName,
          constraintType: "c",
          definition: normalizePredicate(check.value, table.name),
        }),
      );
    }
    return signatures;
  });
}

function expectedIndexSignatures(): string[] {
  return Object.values(baselineSnapshot.tables).flatMap((table) =>
    Object.values(table.indexes).map((index) =>
      [
        table.name,
        index.name,
        index.isUnique ? "unique" : "non-unique",
        index.method,
        index.columns
          .map((column) => expectedIndexKeySignature(table, column))
          .join(","),
        "",
        normalizePredicate(index.where ?? "", table.name),
        "nulls-distinct",
        "immediate",
        "valid",
        "ready",
        "live",
      ].join("|"),
    ),
  );
}

async function inspectLedger(query: MigrationQuery): Promise<LedgerInspection> {
  const existsRows = await query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'drizzle'
        AND relation.relname = '__drizzle_migrations'
        AND relation.relkind = 'r'
    ) AS exists
  `);
  if (existsRows[0]?.exists !== true) {
    return { state: "absent", rows: [] };
  }

  const columns = await query(`
    SELECT
      attribute.attname AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
      attribute.attnotnull AS not_null,
      COALESCE(
        pg_catalog.pg_get_expr(
          default_record.adbin,
          default_record.adrelid,
          true
        ),
        ''
      ) AS default_expression
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_record
      ON default_record.adrelid = attribute.attrelid
     AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'drizzle'
      AND relation.relname = '__drizzle_migrations'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attnum
  `);
  const columnSignatures = columns.map(
    (column) =>
      `${asString(column.column_name)}|${asString(column.data_type)}|${column.not_null === true ? "not-null" : "nullable"}|${normalizeDefault(column.default_expression)}`,
  );
  assertEqualSet(
    "migration ledger columns",
    [
      "id|integer|not-null|nextval('drizzle.__drizzle_migrations_id_seq')",
      "hash|text|not-null|",
      "created_at|bigint|nullable|",
    ],
    columnSignatures,
  );

  const constraints = await query(`
    SELECT
      constraint_record.contype AS constraint_type,
      pg_catalog.array_to_string(
        ARRAY(
          SELECT attribute.attname
          FROM pg_catalog.unnest(constraint_record.conkey)
            WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = constraint_record.conrelid
           AND attribute.attnum = key_column.attnum
          ORDER BY key_column.position
        ),
        ','
      ) AS columns
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'drizzle'
      AND relation.relname = '__drizzle_migrations'
    ORDER BY constraint_record.contype, constraint_record.oid
  `);
  assertEqualSet(
    "migration ledger constraints",
    ["p|id"],
    constraints.map(
      (constraint) =>
        `${asString(constraint.constraint_type)}|${asString(constraint.columns)}`,
    ),
  );

  const rawRows = await query(`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `);
  const rows = rawRows.map((row) => ({
    id: asNumber(row.id),
    hash: asString(row.hash),
    createdAt: asNumber(row.created_at),
  }));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (!row.hash) {
      throw new Error("Migration ledger contains an empty hash");
    }
    if (index > 0 && row.createdAt <= rows[index - 1]!.createdAt) {
      throw new Error("Migration ledger timestamps must be strictly increasing");
    }
  }
  return rows.length === 0
    ? { state: "empty", rows: [] }
    : { state: "nonempty", rows };
}

function assertExactExpectedPrefix(
  rows: readonly AppliedMigration[],
  options: { allowNewer: boolean },
): void {
  const expected = expectedMigrations();
  if (rows.length < expected.length) {
    throw new Error(
      "Database migration ledger is missing migrations required by this application",
    );
  }
  if (!options.allowNewer && rows.length !== expected.length) {
    throw new Error(
      "Database migration ledger is not an exact match for this migration artifact",
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const applied = rows[index];
    const artifact = expected[index];
    if (
      applied?.hash !== artifact?.hash ||
      applied.createdAt !== artifact.folderMillis
    ) {
      throw new Error(
        "Database migration ledger has an edited or reordered migration prefix",
      );
    }
  }
  for (let index = expected.length; index < rows.length; index += 1) {
    const previousCreatedAt = rows[index - 1]?.createdAt ?? 0;
    if (rows[index]!.createdAt <= previousCreatedAt || !rows[index]!.hash) {
      throw new Error(
        "Database migration ledger contains an invalid newer migration suffix",
      );
    }
  }
}

function assertAppliedIsArtifactPrefix(rows: readonly AppliedMigration[]): void {
  const expected = expectedMigrations();
  if (rows.length === 0) {
    throw new Error(
      "Apply mode requires a non-empty migration ledger; use adopt-unversioned for a fresh or historical database",
    );
  }
  if (rows.length > expected.length) {
    throw new Error(
      "Apply mode cannot run because the database contains migrations newer than this artifact",
    );
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (
      rows[index]?.hash !== expected[index]?.hash ||
      rows[index]?.createdAt !== expected[index]?.folderMillis
    ) {
      throw new Error(
        "Apply mode requires the database ledger to be an exact prefix of this artifact",
      );
    }
  }
}

async function isLogicallyFresh(query: MigrationQuery): Promise<boolean> {
  const rows = await query(`
    SELECT
      (
        SELECT count(*)::integer
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
      ) AS table_count,
      (
        SELECT count(*)::integer
        FROM pg_catalog.pg_type AS type_record
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = type_record.typnamespace
        WHERE namespace.nspname = 'public'
          AND type_record.typtype = 'e'
      ) AS enum_count
  `);
  return Number(rows[0]?.table_count) === 0 && Number(rows[0]?.enum_count) === 0;
}

function backfillResult(
  row: AdoptionBackfillRow,
): string | null {
  if (row.currentValue !== null || row.classification === null) {
    return row.currentValue;
  }
  const declaration = ADOPTION_BACKFILL_MANIFEST.find(
    (entry) => entry.id === row.classification,
  );
  if (!declaration) {
    throw new Error(`Unknown adoption backfill class: ${row.classification}`);
  }
  return declaration.result;
}

function backfillDigest(rows: readonly AdoptionBackfillRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function readAdoptionBackfillRows(
  query: MigrationQuery,
): Promise<AdoptionBackfillRow[]> {
  const rows = await query(`
    SELECT
      id::text AS id,
      bracket_json::text AS bracket_json,
      (to_jsonb(tournaments) - 'bracket_construction_algorithm')::text
        AS protected_payload,
      bracket_construction_algorithm AS current_value,
      CASE
        WHEN bracket_json IS NOT NULL
          AND (bracket_json->>'schemaVersion') = '2'
          AND (
            bracket_json->>'constructionAlgorithm' IS NULL
            OR bracket_json->>'constructionAlgorithm' = 'power_of_two'
          )
          THEN 'v2-power-of-two'
        WHEN bracket_json IS NOT NULL
          AND (bracket_json->>'schemaVersion') = '2'
          AND bracket_json->>'constructionAlgorithm' = 'compact'
          THEN 'v2-compact'
        WHEN bracket_json IS NOT NULL
          AND (
            bracket_json->>'schemaVersion' IS NULL
            OR bracket_json->>'schemaVersion' = '1'
          )
          AND bracket_json->>'format' = 'single_elimination'
          AND jsonb_typeof(bracket_json->'slots') = 'array'
          THEN 'v1-compact'
        ELSE NULL
      END AS classification
    FROM tournaments
    ORDER BY id
  `);
  return rows.map((row) => ({
    id: asString(row.id),
    bracketJson:
      row.bracket_json === null ? null : asString(row.bracket_json),
    protectedPayload: asString(row.protected_payload),
    currentValue:
      row.current_value === null ? null : asString(row.current_value),
    classification:
      row.classification === null
        ? null
        : (asString(row.classification) as AdoptionBackfillRow["classification"]),
  }));
}

async function captureAdoptionBackfillManifest(
  query: MigrationQuery,
): Promise<AdoptionBackfillManifest> {
  const beforeRows = await readAdoptionBackfillRows(query);
  const expectedRows = beforeRows.map((row) => ({
    ...row,
    currentValue: backfillResult(row),
  }));
  const candidateCounts = Object.fromEntries(
    ADOPTION_BACKFILL_MANIFEST.map((entry) => [
      entry.id,
      beforeRows.filter(
        (row) => row.currentValue === null && row.classification === entry.id,
      ).length,
    ]),
  );
  return {
    beforeRowCount: beforeRows.length,
    beforeDigest: backfillDigest(beforeRows),
    candidateCounts,
    expectedAfterRowCount: expectedRows.length,
    expectedAfterDigest: backfillDigest(expectedRows),
  };
}

async function assertAdoptionBackfillApplied(
  query: MigrationQuery,
  manifest: AdoptionBackfillManifest,
): Promise<AdoptionBackfillEvidence> {
  const actualRows = await readAdoptionBackfillRows(query);
  const actualDigest = backfillDigest(actualRows);
  if (
    actualRows.length !== manifest.expectedAfterRowCount ||
    actualDigest !== manifest.expectedAfterDigest
  ) {
    throw new Error("Adoption backfill violated its declared manifest");
  }
  return {
    ...manifest,
    actualAfterRowCount: actualRows.length,
    actualAfterDigest: actualDigest,
  };
}

/** Verify the complete logical schema represented by the immutable 0000 snapshot. */
export async function assertBaselineSchema(query: MigrationQuery): Promise<void> {
  const tables = await query(`
    SELECT relation.relname AS table_name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  `);
  assertEqualSet(
    "public tables",
    expectedTableNames(),
    tables.map((row) => asString(row.table_name)),
  );

  const columns = await query(`
    SELECT
      relation.relname AS table_name,
      attribute.attname AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
      COALESCE(
        collation_namespace.nspname || '.' || collation_record.collname,
        ''
      ) AS collation_name,
      attribute.attnotnull AS not_null,
      COALESCE(
        pg_catalog.pg_get_expr(
          default_record.adbin,
          default_record.adrelid,
          true
        ),
        ''
      ) AS default_expression
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_record
      ON default_record.adrelid = attribute.attrelid
     AND default_record.adnum = attribute.attnum
    LEFT JOIN pg_catalog.pg_collation AS collation_record
      ON collation_record.oid = attribute.attcollation
    LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation_record.collnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  `);
  assertEqualSet(
    "public columns",
    expectedColumnSignatures(),
    columns.map(
      (column) =>
        `${asString(column.table_name)}|${asString(column.column_name)}|${asString(column.data_type)}|${asString(column.collation_name)}|${column.not_null === true ? "not-null" : "nullable"}`,
    ),
  );
  assertColumnDefaults(columns);

  const enums = await query(`
    SELECT
      type_record.typname AS enum_name,
      pg_catalog.string_agg(enum_value.enumlabel, chr(31) ORDER BY enum_value.enumsortorder) AS labels
    FROM pg_catalog.pg_type AS type_record
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = type_record.typnamespace
    JOIN pg_catalog.pg_enum AS enum_value
      ON enum_value.enumtypid = type_record.oid
    WHERE namespace.nspname = 'public'
    GROUP BY type_record.typname
  `);
  assertEqualSet(
    "public enums",
    expectedEnumSignatures(),
    enums.map(
      (enumType) => `${asString(enumType.enum_name)}|${asString(enumType.labels)}`,
    ),
  );

  const constraints = await query(`
    SELECT
      source_relation.relname AS table_name,
      constraint_record.conname AS constraint_name,
      constraint_record.contype AS constraint_type,
      pg_catalog.array_to_string(
        ARRAY(
          SELECT attribute.attname
          FROM pg_catalog.unnest(constraint_record.conkey)
            WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = constraint_record.conrelid
           AND attribute.attnum = key_column.attnum
          ORDER BY key_column.position
        ),
        ','
      ) AS columns,
      COALESCE(target_relation.relname, '') AS target_table,
      COALESCE(
        pg_catalog.array_to_string(
          ARRAY(
            SELECT attribute.attname
            FROM pg_catalog.unnest(constraint_record.confkey)
              WITH ORDINALITY AS key_column(attnum, position)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_record.confrelid
             AND attribute.attnum = key_column.attnum
            ORDER BY key_column.position
          ),
          ','
        ),
        ''
      ) AS target_columns,
      CASE constraint_record.confupdtype
        WHEN 'a' THEN 'no action'
        WHEN 'r' THEN 'restrict'
        WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null'
        WHEN 'd' THEN 'set default'
        ELSE ''
      END AS on_update,
      CASE constraint_record.confdeltype
        WHEN 'a' THEN 'no action'
        WHEN 'r' THEN 'restrict'
        WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set null'
        WHEN 'd' THEN 'set default'
        ELSE ''
      END AS on_delete,
      CASE constraint_record.confmatchtype
        WHEN 's' THEN 'simple'
        WHEN 'f' THEN 'full'
        WHEN 'p' THEN 'partial'
        ELSE ''
      END AS match_type,
      constraint_record.condeferrable AS is_deferrable,
      constraint_record.condeferred AS is_initially_deferred,
      constraint_record.convalidated AS is_validated,
      COALESCE(constraint_index_relation.relname, '') AS backing_index_name,
      COALESCE(constraint_index_method.amname, '') AS backing_index_method,
      COALESCE(
        pg_catalog.array_to_string(
          ARRAY(
            SELECT pg_catalog.format(
              '%s{%s|%s|%s|%s}',
              pg_catalog.pg_get_indexdef(
                constraint_index.indexrelid,
                key_position.position,
                true
              ),
              COALESCE(
                key_collation_namespace.nspname || '.' || key_collation.collname,
                ''
              ),
              key_opclass_namespace.nspname || '.' || key_opclass.opcname,
              CASE
                WHEN (
                  constraint_index.indoption[key_position.position - 1] & 1
                ) = 1 THEN 'desc'
                ELSE 'asc'
              END,
              CASE
                WHEN (
                  constraint_index.indoption[key_position.position - 1] & 2
                ) = 2 THEN 'nulls-first'
                ELSE 'nulls-last'
              END
            )
            FROM pg_catalog.generate_series(
              1,
              constraint_index.indnkeyatts
            ) AS key_position(position)
            LEFT JOIN pg_catalog.pg_collation AS key_collation
              ON key_collation.oid =
                constraint_index.indcollation[key_position.position - 1]
            LEFT JOIN pg_catalog.pg_namespace AS key_collation_namespace
              ON key_collation_namespace.oid = key_collation.collnamespace
            JOIN pg_catalog.pg_opclass AS key_opclass
              ON key_opclass.oid =
                constraint_index.indclass[key_position.position - 1]
            JOIN pg_catalog.pg_namespace AS key_opclass_namespace
              ON key_opclass_namespace.oid = key_opclass.opcnamespace
            ORDER BY key_position.position
          ),
          ','
        ),
        ''
      ) AS backing_index_columns,
      COALESCE(
        pg_catalog.array_to_string(
          ARRAY(
            SELECT pg_catalog.pg_get_indexdef(
              constraint_index.indexrelid,
              position,
              true
            )
            FROM pg_catalog.generate_series(
              constraint_index.indnkeyatts + 1,
              constraint_index.indnatts
            ) AS position
          ),
          ','
        ),
        ''
      ) AS backing_index_include_columns,
      constraint_index.indnullsnotdistinct AS backing_index_nulls_not_distinct,
      constraint_index.indimmediate AS backing_index_immediate,
      constraint_index.indisvalid AS backing_index_valid,
      constraint_index.indisready AS backing_index_ready,
      constraint_index.indislive AS backing_index_live,
      CASE
        WHEN constraint_record.contype = 'c'
          THEN pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
        ELSE ''
      END AS definition
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS source_relation
      ON source_relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = source_relation.relnamespace
    LEFT JOIN pg_catalog.pg_class AS target_relation
      ON target_relation.oid = constraint_record.confrelid
    LEFT JOIN pg_catalog.pg_index AS constraint_index
      ON constraint_index.indexrelid = constraint_record.conindid
     AND constraint_record.contype IN ('p', 'u')
    LEFT JOIN pg_catalog.pg_class AS constraint_index_relation
      ON constraint_index_relation.oid = constraint_index.indexrelid
    LEFT JOIN pg_catalog.pg_am AS constraint_index_method
      ON constraint_index_method.oid = constraint_index_relation.relam
    WHERE namespace.nspname = 'public'
      AND constraint_record.contype IN ('p', 'u', 'f', 'c')
  `);
  assertEqualSet(
    "public constraints",
    expectedConstraintSignatures(),
    constraints.map((constraint) => {
      const tableName = asString(constraint.table_name);
      return [
        tableName,
        asString(constraint.constraint_name),
        asString(constraint.constraint_type),
        asString(constraint.columns),
        asString(constraint.target_table),
        asString(constraint.target_columns),
        asString(constraint.on_update),
        asString(constraint.on_delete),
        asString(constraint.match_type),
        constraint.is_deferrable === true ? "deferrable" : "not-deferrable",
        constraint.is_initially_deferred === true
          ? "initially-deferred"
          : "initially-immediate",
        constraint.is_validated === true ? "validated" : "not-validated",
        asString(constraint.backing_index_name),
        asString(constraint.backing_index_method),
        asString(constraint.backing_index_columns),
        asString(constraint.backing_index_include_columns),
        constraint.backing_index_name
          ? constraint.backing_index_nulls_not_distinct === true
            ? "nulls-not-distinct"
            : "nulls-distinct"
          : "",
        constraint.backing_index_name
          ? constraint.backing_index_immediate === true
            ? "immediate"
            : "not-immediate"
          : "",
        constraint.backing_index_name
          ? constraint.backing_index_valid === true
            ? "valid"
            : "invalid"
          : "",
        constraint.backing_index_name
          ? constraint.backing_index_ready === true
            ? "ready"
            : "not-ready"
          : "",
        constraint.backing_index_name
          ? constraint.backing_index_live === true
            ? "live"
            : "not-live"
          : "",
        normalizePredicate(asString(constraint.definition), tableName),
      ].join("|");
    }),
  );

  const indexes = await query(`
    SELECT
      table_relation.relname AS table_name,
      index_relation.relname AS index_name,
      index_record.indisunique AS is_unique,
      access_method.amname AS access_method,
      pg_catalog.array_to_string(
        ARRAY(
          SELECT pg_catalog.format(
            '%s{%s|%s|%s|%s}',
            pg_catalog.pg_get_indexdef(
              index_record.indexrelid,
              key_position.position,
              true
            ),
            COALESCE(
              key_collation_namespace.nspname || '.' || key_collation.collname,
              ''
            ),
            key_opclass_namespace.nspname || '.' || key_opclass.opcname,
            CASE
              WHEN (
                index_record.indoption[key_position.position - 1] & 1
              ) = 1 THEN 'desc'
              ELSE 'asc'
            END,
            CASE
              WHEN (
                index_record.indoption[key_position.position - 1] & 2
              ) = 2 THEN 'nulls-first'
              ELSE 'nulls-last'
            END
          )
          FROM pg_catalog.generate_series(
            1,
            index_record.indnkeyatts
          ) AS key_position(position)
          LEFT JOIN pg_catalog.pg_collation AS key_collation
            ON key_collation.oid =
              index_record.indcollation[key_position.position - 1]
          LEFT JOIN pg_catalog.pg_namespace AS key_collation_namespace
            ON key_collation_namespace.oid = key_collation.collnamespace
          JOIN pg_catalog.pg_opclass AS key_opclass
            ON key_opclass.oid = index_record.indclass[key_position.position - 1]
          JOIN pg_catalog.pg_namespace AS key_opclass_namespace
            ON key_opclass_namespace.oid = key_opclass.opcnamespace
          ORDER BY key_position.position
        ),
        ','
      ) AS columns,
      COALESCE(
        pg_catalog.array_to_string(
          ARRAY(
            SELECT pg_catalog.pg_get_indexdef(
              index_record.indexrelid,
              position,
              true
            )
            FROM pg_catalog.generate_series(
              index_record.indnkeyatts + 1,
              index_record.indnatts
            ) AS position
          ),
          ','
        ),
        ''
      ) AS include_columns,
      COALESCE(
        pg_catalog.pg_get_expr(
          index_record.indpred,
          index_record.indrelid,
          true
        ),
        ''
      ) AS predicate,
      index_record.indnullsnotdistinct AS nulls_not_distinct,
      index_record.indimmediate AS is_immediate,
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
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE namespace.nspname = 'public'
      AND NOT index_record.indisprimary
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_record
        WHERE constraint_record.conindid = index_record.indexrelid
      )
  `);
  assertEqualSet(
    "public explicit indexes",
    expectedIndexSignatures(),
    indexes.map((index) => {
      const tableName = asString(index.table_name);
      return [
        tableName,
        asString(index.index_name),
        index.is_unique === true ? "unique" : "non-unique",
        asString(index.access_method),
        asString(index.columns),
        asString(index.include_columns),
        normalizePredicate(asString(index.predicate), tableName),
        index.nulls_not_distinct === true
          ? "nulls-not-distinct"
          : "nulls-distinct",
        index.is_immediate === true ? "immediate" : "not-immediate",
        index.is_valid === true ? "valid" : "invalid",
        index.is_ready === true ? "ready" : "not-ready",
        index.is_live === true ? "live" : "not-live",
      ].join("|");
    }),
  );
}

async function assertAdoptionPreconditions(
  query: MigrationQuery,
  captureManifest: boolean,
): Promise<AdoptionBackfillManifest | undefined> {
  const ledger = await inspectLedger(query);
  if (ledger.state === "nonempty") {
    throw new Error(
      "Adoption mode requires an absent or canonical empty migration ledger",
    );
  }
  await assertBaselineSchema(query);
  return captureManifest
    ? captureAdoptionBackfillManifest(query)
    : undefined;
}

async function assertApplyPreconditions(query: MigrationQuery): Promise<void> {
  const ledger = await inspectLedger(query);
  if (ledger.state === "nonempty") {
    assertAppliedIsArtifactPrefix(ledger.rows);
    await assertBaselineSchema(query);
    return;
  }
  if (!(await isLogicallyFresh(query))) {
    throw new Error(
      "Apply mode with an absent or empty ledger requires a genuinely empty public schema; use adopt-unversioned only for the exact historical baseline",
    );
  }
}

async function assertPreconditions(
  query: MigrationQuery,
  mode: MigrationMode,
  captureAdoptionManifest = true,
): Promise<AdoptionBackfillManifest | undefined> {
  if (mode === "adopt-unversioned") {
    return assertAdoptionPreconditions(query, captureAdoptionManifest);
  }
  await assertApplyPreconditions(query);
  return undefined;
}

/** Exact postcondition used by migration jobs, not by application startup. */
export async function assertMigrationsExactlyCurrent(
  query: MigrationQuery,
): Promise<void> {
  const ledger = await inspectLedger(query);
  if (ledger.state !== "nonempty") {
    throw new Error("Database migrations are not initialized");
  }
  assertExactExpectedPrefix(ledger.rows, { allowNewer: false });
  await assertBaselineSchema(query);
}

/**
 * Read-only startup gate. A rollback-safe binary accepts a matching known
 * prefix plus strictly newer rows, but never a missing, reordered, or edited
 * known migration.
 */
export async function assertMigrationsCompatible(
  query: MigrationQuery,
): Promise<void> {
  const ledger = await inspectLedger(query);
  if (ledger.state !== "nonempty") {
    throw new Error(
      "Database migrations are not initialized; run the explicit migration command before API startup",
    );
  }
  assertExactExpectedPrefix(ledger.rows, { allowNewer: true });
}

export async function applyPgliteMigrationFiles<
  TSchema extends Record<string, unknown>,
>(
  db: PgliteDatabase<TSchema>,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  await migratePglite(db, { migrationsFolder });
}

type ReservedPostgresSession = Awaited<
  ReturnType<ReturnType<typeof postgres>["reserve"]>
>;

async function assertHostedRuntimePreconditions(
  session: ReservedPostgresSession,
  runtimeRole: string | undefined,
): Promise<void> {
  if (!runtimeRole) return;
  const roleRows = (await session.unsafe(
    `
      SELECT
        runtime_role.rolcanlogin AS can_login,
        runtime_role.rolsuper AS is_superuser,
        runtime_role.rolcreatedb AS can_create_database,
        runtime_role.rolcreaterole AS can_create_role,
        runtime_role.rolreplication AS can_replicate,
        runtime_role.rolbypassrls AS can_bypass_rls,
        runtime_role.rolname = current_user AS is_migration_owner,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS inherited_role
          WHERE inherited_role.oid <> runtime_role.oid
            AND pg_catalog.pg_has_role(
              runtime_role.oid,
              inherited_role.oid,
              'MEMBER'
            )
        ) AS has_any_membership
      FROM pg_catalog.pg_roles AS runtime_role
      WHERE runtime_role.rolname = $1
    `,
    [runtimeRole],
  )) as Array<Record<string, unknown>>;
  const role = roleRows[0];
  if (!role) {
    throw new Error("TAB10_RUNTIME_DATABASE_ROLE does not exist");
  }
  if (
    role.can_login !== true ||
    role.is_superuser === true ||
    role.can_create_database === true ||
    role.can_create_role === true ||
    role.can_replicate === true ||
    role.can_bypass_rls === true ||
    role.is_migration_owner === true ||
    role.has_any_membership === true
  ) {
    throw new Error(
      "TAB10_RUNTIME_DATABASE_ROLE must be a distinct least-privileged login role",
    );
  }

  const privilegeRows = (await session.unsafe(
    `
      WITH runtime_role AS (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1
      ), default_privileges AS (
        SELECT
          namespace.nspname AS schema_name,
          default_acl.defaclobjtype AS object_type,
          expanded_acl.privilege_type
        FROM pg_catalog.pg_default_acl AS default_acl
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = default_acl.defaclnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl)
          AS expanded_acl
        CROSS JOIN runtime_role
        WHERE default_acl.defaclrole = (
          SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
        )
          AND expanded_acl.grantee = runtime_role.oid
      )
      SELECT
        pg_catalog.has_schema_privilege(
          $1,
          pg_catalog.to_regnamespace('public'),
          'USAGE'
        )
          AS public_schema_usage,
        pg_catalog.has_schema_privilege(
          $1,
          pg_catalog.to_regnamespace('drizzle'),
          'USAGE'
        )
          AS ledger_schema_usage,
        NOT pg_catalog.has_schema_privilege(
          $1,
          pg_catalog.to_regnamespace('public'),
          'CREATE'
        ) AS no_public_schema_create,
        NOT pg_catalog.has_schema_privilege(
          $1,
          pg_catalog.to_regnamespace('drizzle'),
          'CREATE'
        ) AS no_ledger_schema_create,
        NOT EXISTS (
          SELECT required.privilege
          FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
            AS required(privilege)
          EXCEPT
          SELECT privilege_type
          FROM default_privileges
          WHERE schema_name = 'public' AND object_type = 'r'
        ) AS public_table_defaults,
        NOT EXISTS (
          SELECT required.privilege
          FROM (VALUES ('USAGE'), ('SELECT')) AS required(privilege)
          EXCEPT
          SELECT privilege_type
          FROM default_privileges
          WHERE schema_name = 'public' AND object_type = 'S'
        ) AS public_sequence_defaults,
        EXISTS (
          SELECT 1
          FROM default_privileges
          WHERE schema_name = 'drizzle'
            AND object_type = 'r'
            AND privilege_type = 'SELECT'
        ) AS ledger_table_defaults
    `,
    [runtimeRole],
  )) as Array<Record<string, unknown>>;
  const privileges = privilegeRows[0];
  if (
    privileges?.public_schema_usage !== true ||
    privileges.ledger_schema_usage !== true ||
    privileges.no_public_schema_create !== true ||
    privileges.no_ledger_schema_create !== true ||
    privileges.public_table_defaults !== true ||
    privileges.public_sequence_defaults !== true ||
    privileges.ledger_table_defaults !== true
  ) {
    throw new Error(
      "Hosted runtime role schemas and default privileges must be provisioned before migration",
    );
  }
}

async function assertHostedRuntimePostconditions(
  session: ReservedPostgresSession,
  runtimeRole: string | undefined,
): Promise<void> {
  if (!runtimeRole) return;
  const rows = (await session.unsafe(
    `
      SELECT
        pg_catalog.has_schema_privilege($1, 'public', 'USAGE')
          AS public_schema_usage,
        pg_catalog.has_schema_privilege($1, 'drizzle', 'USAGE')
          AS ledger_schema_usage,
        pg_catalog.has_table_privilege(
          $1,
          'drizzle.__drizzle_migrations',
          'SELECT'
        ) AS ledger_select,
        NOT pg_catalog.has_table_privilege(
          $1,
          'drizzle.__drizzle_migrations',
          'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
        ) AS ledger_read_only,
        NOT pg_catalog.has_schema_privilege($1, 'public', 'CREATE')
          AS no_public_schema_create,
        NOT pg_catalog.has_schema_privilege($1, 'drizzle', 'CREATE')
          AS no_ledger_schema_create,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_namespace AS namespace
          JOIN pg_catalog.pg_roles AS runtime_role
            ON runtime_role.oid = namespace.nspowner
          WHERE runtime_role.rolname = $1
            AND namespace.nspname IN ('public', 'drizzle')
        ) AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          JOIN pg_catalog.pg_roles AS runtime_role
            ON runtime_role.oid = relation.relowner
          WHERE runtime_role.rolname = $1
            AND namespace.nspname IN ('public', 'drizzle')
        ) AS owns_no_schema_objects,
        COALESCE(
          (
            SELECT bool_and(
              pg_catalog.has_table_privilege($1, relation.oid, 'SELECT')
              AND pg_catalog.has_table_privilege($1, relation.oid, 'INSERT')
              AND pg_catalog.has_table_privilege($1, relation.oid, 'UPDATE')
              AND pg_catalog.has_table_privilege($1, relation.oid, 'DELETE')
            )
            FROM pg_catalog.pg_class AS relation
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind IN ('r', 'p')
          ),
          false
        ) AS public_table_dml,
        COALESCE(
          (
            SELECT bool_and(
              pg_catalog.has_sequence_privilege($1, relation.oid, 'USAGE')
              AND pg_catalog.has_sequence_privilege($1, relation.oid, 'SELECT')
            )
            FROM pg_catalog.pg_class AS relation
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind = 'S'
          ),
          true
        ) AS public_sequence_usage
    `,
    [runtimeRole],
  )) as Array<Record<string, unknown>>;
  const privileges = rows[0];
  if (
    privileges?.public_schema_usage !== true ||
    privileges.ledger_schema_usage !== true ||
    privileges.ledger_select !== true ||
    privileges.ledger_read_only !== true ||
    privileges.no_public_schema_create !== true ||
    privileges.no_ledger_schema_create !== true ||
    privileges.owns_no_schema_objects !== true ||
    privileges.public_table_dml !== true ||
    privileges.public_sequence_usage !== true
  ) {
    throw new Error("Runtime database privileges failed post-migration validation");
  }
}

async function applyPostgresMigrationFiles(
  session: ReservedPostgresSession,
  query: MigrationQuery,
  mode: MigrationMode,
  runtimeRole: string | undefined,
): Promise<AdoptionBackfillEvidence | undefined> {
  await session.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
  await session.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const appliedRows = (await session.unsafe(`
    SELECT hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `)) as Array<{ hash: string; created_at: string | number }>;
  const migrations = expectedMigrations();

  await session.unsafe("BEGIN");
  try {
    let adoptionManifest: AdoptionBackfillManifest | undefined;
    if (mode === "adopt-unversioned") {
      // The historical data manifest must be captured under a lock that blocks
      // concurrent tournament writes until validation and commit complete.
      await session.unsafe(
        "LOCK TABLE tournaments IN SHARE ROW EXCLUSIVE MODE",
      );
      adoptionManifest = await captureAdoptionBackfillManifest(query);
    }
    for (let index = appliedRows.length; index < migrations.length; index += 1) {
      const migration = migrations[index]!;
      for (const statement of migration.sql) {
        await session.unsafe(statement);
      }
      await session.unsafe(
        `
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES ($1, $2)
        `,
        [migration.hash, migration.folderMillis],
      );
    }
    const adoption = adoptionManifest
      ? await assertAdoptionBackfillApplied(query, adoptionManifest)
      : undefined;
    await assertMigrationsExactlyCurrent(query);
    await assertHostedRuntimePostconditions(session, runtimeRole);
    await session.unsafe("COMMIT");
    return adoption;
  } catch (error) {
    await session.unsafe("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function runPgliteMigrations<
  TSchema extends Record<string, unknown>,
>(options: {
  db: PgliteDatabase<TSchema>;
  query: MigrationQuery;
  mode: MigrationMode;
}): Promise<MigrationRunEvidence> {
  const adoptionManifest = await assertPreconditions(
    options.query,
    options.mode,
  );
  await applyPgliteMigrationFiles(options.db);
  const adoption = adoptionManifest
    ? await assertAdoptionBackfillApplied(options.query, adoptionManifest)
    : undefined;
  await assertMigrationsExactlyCurrent(options.query);
  return { mode: options.mode, ...(adoption ? { adoption } : {}) };
}

function boundedMilliseconds(
  label: string,
  value: number | undefined,
  fallback: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 3_600_000) {
    throw new Error(`${label} must be an integer from 1 to 3600000 milliseconds`);
  }
  return result;
}

export async function runPostgresMigrations(
  databaseUrl: string,
  mode: MigrationMode,
  options: {
    lockTimeoutMs?: number;
    statementTimeoutMs?: number;
    idleTransactionTimeoutMs?: number;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<MigrationRunEvidence> {
  const environment = options.environment ?? process.env;
  requireMigrationDatabaseUrl({
    ...environment,
    MIGRATION_DATABASE_URL: databaseUrl,
  });
  const runtimeRole = requireRuntimeDatabaseRole(environment, databaseUrl);
  const lockTimeoutMs = boundedMilliseconds(
    "lockTimeoutMs",
    options.lockTimeoutMs,
    DEFAULT_LOCK_TIMEOUT_MS,
  );
  const statementTimeoutMs = boundedMilliseconds(
    "statementTimeoutMs",
    options.statementTimeoutMs,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const idleTransactionTimeoutMs = boundedMilliseconds(
    "idleTransactionTimeoutMs",
    options.idleTransactionTimeoutMs,
    DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
  );
  const pool = postgres(databaseUrl, { max: 1 });
  let session: Awaited<ReturnType<typeof pool.reserve>> | undefined;
  let lockAcquired = false;
  try {
    session = await pool.reserve();
    await session.unsafe("SET search_path TO public, pg_catalog");
    await session.unsafe(`SET lock_timeout TO '${lockTimeoutMs}ms'`);
    await session.unsafe(`SET statement_timeout TO '${statementTimeoutMs}ms'`);
    await session.unsafe(
      `SET idle_in_transaction_session_timeout TO '${idleTransactionTimeoutMs}ms'`,
    );
    await session.unsafe(
      `SELECT pg_catalog.pg_advisory_lock(${MIGRATION_ADVISORY_LOCK})`,
    );
    lockAcquired = true;

    const query: MigrationQuery = async (statement) =>
      (await session!.unsafe(statement)) as Array<Record<string, unknown>>;
    await assertHostedRuntimePreconditions(session, runtimeRole);
    await assertPreconditions(query, mode, false);
    const adoption = await applyPostgresMigrationFiles(
      session,
      query,
      mode,
      runtimeRole,
    );
    await assertMigrationsExactlyCurrent(query);
    return { mode, ...(adoption ? { adoption } : {}) };
  } finally {
    if (session && lockAcquired) {
      await session
        .unsafe(`SELECT pg_catalog.pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK})`)
        .catch(() => undefined);
    }
    session?.release();
    await pool.end({ timeout: 5 });
  }
}
