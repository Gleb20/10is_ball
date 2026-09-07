import { describe, expect, it } from "vitest";
import {
  requireMigrationDatabaseUrl,
  requireMigrationMode,
} from "./migration-database-url.js";
import { runPostgresMigrations } from "./migrations.js";

const POSTGRES_SCHEME = "postgresql" + "://";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const PRODUCTION_ENV = {
  TAB10_ENVIRONMENT: "production",
  TAB10_MIGRATION_CONFIRM_SHA: SHA,
  TAB10_RELEASE_SHA: SHA,
  GITHUB_SHA: SHA,
  TAB10_NEON_PROJECT_ID: "project-production",
  TAB10_EXPECTED_NEON_PROJECT_ID: "project-production",
  TAB10_NEON_BRANCH_ID: "branch-production",
  TAB10_EXPECTED_NEON_BRANCH_ID: "branch-production",
  TAB10_NEON_DATABASE: "tab10",
  TAB10_EXPECTED_NEON_DATABASE: "tab10",
  TAB10_NEON_DIRECT_HOST: "ep-production.us-east-2.aws.neon.tech",
  TAB10_NEON_MIGRATION_ROLE: "app",
  TAB10_RUNTIME_DATABASE_ROLE: "tab10_runtime",
  MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-production.us-east-2.aws.neon.tech/tab10?sslmode=require`,
} as const;

describe("requireMigrationDatabaseUrl", () => {
  it("requires the dedicated migration URL and never falls back to DATABASE_URL", () => {
    expect(() => requireMigrationDatabaseUrl({})).toThrow(
      "MIGRATION_DATABASE_URL is required for db:migrate",
    );
    expect(() =>
      requireMigrationDatabaseUrl({
        DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@db.example/tab10`,
      }),
    ).toThrow(
      "MIGRATION_DATABASE_URL is required for db:migrate",
    );
  });

  it("accepts only an explicit direct PostgreSQL URL", () => {
    expect(() =>
      requireMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: "https://db.example/tab10",
      }),
    ).toThrow("must use postgres or postgresql");
    expect(
      requireMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-example.us-east-2.aws.neon.tech/tab10?sslmode=require`,
      }),
    ).toBe(
      `${POSTGRES_SCHEME}app:replace-me@ep-example.us-east-2.aws.neon.tech/tab10?sslmode=require`,
    );
    expect(() =>
      requireMigrationDatabaseUrl({
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-example-pooler.us-east-2.aws.neon.tech/tab10`,
      }),
    ).toThrow("must use a direct, non-pooled database host");
  });

  it.each([
    [`${POSTGRES_SCHEME}?`, "one explicit database host"],
    [`${POSTGRES_SCHEME}/tab10`, "one explicit database host"],
    [`${POSTGRES_SCHEME}localhost`, "explicit database user"],
    [`${POSTGRES_SCHEME}app@localhost`, "one explicit database name"],
    [`${POSTGRES_SCHEME}app@host-a,host-b/tab10`, "one explicit database host"],
  ])("rejects an implicit or incomplete target: %s", (url, message) => {
    expect(() =>
      requireMigrationDatabaseUrl({ MIGRATION_DATABASE_URL: url }),
    ).toThrow(message);
  });

  it("requires an exact production commit confirmation", () => {
    expect(() =>
      requireMigrationDatabaseUrl({
        ...PRODUCTION_ENV,
        TAB10_MIGRATION_CONFIRM_SHA: undefined,
      }),
    ).toThrow("TAB10_MIGRATION_CONFIRM_SHA is required");
    expect(() =>
      requireMigrationDatabaseUrl({
        ...PRODUCTION_ENV,
        TAB10_MIGRATION_CONFIRM_SHA:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toThrow("must match exactly");
    expect(() =>
      requireMigrationDatabaseUrl({
        ...PRODUCTION_ENV,
        GITHUB_SHA: "short-sha",
      }),
    ).toThrow("full 40-character Git SHAs");
  });

  it.each([
    ["TAB10_NEON_PROJECT_ID", "wrong-project"],
    ["TAB10_NEON_BRANCH_ID", "wrong-branch"],
    ["TAB10_NEON_DATABASE", "wrong-database"],
  ] as const)("rejects a mismatched production %s", (name, value) => {
    expect(() =>
      requireMigrationDatabaseUrl({ ...PRODUCTION_ENV, [name]: value }),
    ).toThrow("does not match");
  });

  it.each([
    "TAB10_NEON_PROJECT_ID",
    "TAB10_EXPECTED_NEON_PROJECT_ID",
    "TAB10_NEON_BRANCH_ID",
    "TAB10_EXPECTED_NEON_BRANCH_ID",
    "TAB10_NEON_DATABASE",
    "TAB10_EXPECTED_NEON_DATABASE",
    "TAB10_NEON_DIRECT_HOST",
    "TAB10_NEON_MIGRATION_ROLE",
  ])("rejects a missing production %s before connection", (name) => {
    expect(() =>
      requireMigrationDatabaseUrl({ ...PRODUCTION_ENV, [name]: undefined }),
    ).toThrow(`${name} is required`);
  });

  it("binds the production URL to the resolved direct host and database", () => {
    expect(() =>
      requireMigrationDatabaseUrl({
        ...PRODUCTION_ENV,
        TAB10_NEON_DIRECT_HOST: "ep-other.us-east-2.aws.neon.tech",
      }),
    ).toThrow("host does not match");
    expect(() =>
      requireMigrationDatabaseUrl({
        ...PRODUCTION_ENV,
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-production.us-east-2.aws.neon.tech/other?sslmode=require`,
      }),
    ).toThrow("database does not match");
    expect(() =>
      requireMigrationDatabaseUrl({
        ...PRODUCTION_ENV,
        TAB10_NEON_MIGRATION_ROLE: "other_owner",
      }),
    ).toThrow("user does not match");
    expect(requireMigrationDatabaseUrl(PRODUCTION_ENV)).toBe(
      PRODUCTION_ENV.MIGRATION_DATABASE_URL,
    );
  });

  it("does not require production confirmation in staging", () => {
    expect(
      requireMigrationDatabaseUrl({
        TAB10_ENVIRONMENT: "staging",
        TAB10_RUNTIME_DATABASE_ROLE: "tab10_runtime",
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-staging.us-east-2.aws.neon.tech/tab10_staging`,
      }),
    ).toContain("ep-staging");
  });

  it("allows the disposable hosted stand to omit a split runtime role", () => {
    expect(
      requireMigrationDatabaseUrl({
        TAB10_ENVIRONMENT: "staging",
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-staging.us-east-2.aws.neon.tech/tab10_staging`,
      }),
    ).toContain("ep-staging");
  });

  it("validates a configured split runtime role", () => {
    expect(() =>
      requireMigrationDatabaseUrl({
        TAB10_ENVIRONMENT: "staging",
        TAB10_RUNTIME_DATABASE_ROLE: "Unsafe Role",
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-staging.us-east-2.aws.neon.tech/tab10_staging`,
      }),
    ).toThrow("safe lowercase PostgreSQL identifier");
    expect(() =>
      requireMigrationDatabaseUrl({
        TAB10_ENVIRONMENT: "staging",
        TAB10_RUNTIME_DATABASE_ROLE: "app",
        MIGRATION_DATABASE_URL: `${POSTGRES_SCHEME}app:replace-me@ep-staging.us-east-2.aws.neon.tech/tab10_staging`,
      }),
    ).toThrow("must differ from the migration owner");
  });
});

describe("requireMigrationMode", () => {
  it.each([
    [["--mode=apply"], "apply"],
    [["--mode", "adopt-unversioned"], "adopt-unversioned"],
  ] as const)("accepts an explicit supported mode", (argv, expected) => {
    expect(requireMigrationMode([...argv])).toBe(expected);
  });

  it.each([
    [[], "--mode is required"],
    [["--mode=repair"], "must be apply or adopt-unversioned"],
    [
      ["--mode=apply", "--mode=adopt-unversioned"],
      "must be provided exactly once",
    ],
    [["--mode=apply", "--unknown"], "Unknown migration arguments"],
  ] as const)("rejects unsafe arguments", (argv, message) => {
    expect(() => requireMigrationMode([...argv])).toThrow(message);
  });
});

describe("runPostgresMigrations production gate", () => {
  const localUrl = `${POSTGRES_SCHEME}app:replace-me@127.0.0.1/tab10`;

  it("rejects missing production confirmation before opening a connection", async () => {
    await expect(
      runPostgresMigrations(localUrl, "apply", {
        environment: { TAB10_ENVIRONMENT: "production" },
      }),
    ).rejects.toThrow("TAB10_MIGRATION_CONFIRM_SHA is required");
  });

  it("rejects mismatched production identity before opening a connection", async () => {
    await expect(
      runPostgresMigrations(localUrl, "apply", {
        environment: {
          ...PRODUCTION_ENV,
          TAB10_NEON_DIRECT_HOST: "127.0.0.1",
          TAB10_NEON_PROJECT_ID: "wrong-project",
        },
      }),
    ).rejects.toThrow("TAB10_NEON_PROJECT_ID does not match");
  });
});
