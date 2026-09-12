import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  validateBackupConfig,
  validateSeedApiBase,
} from "./ops-safety.mjs";

function postgresUrl(host, database, options = {}) {
  const user = options.user ?? "user";
  const credential = options.credential ?? "test-credential";
  const query = options.query ? `?${options.query}` : "";
  return ["postgresql://", user, ":", credential, "@", host, "/", database, query].join("");
}

test("backup rehearsal rejects remote and non-test database targets", () => {
  assert.throws(
    () =>
      validateBackupConfig({
        databaseUrl: postgresUrl("db.example.com", "prod"),
        restoreDb: "tab10_restore_rehearsal_test",
        confirmation: "1",
      }),
    /loopback/i,
  );
  assert.throws(
    () =>
      validateBackupConfig({
        databaseUrl: postgresUrl("localhost", "tab10_prod"),
        restoreDb: "tab10_restore_rehearsal_test",
        confirmation: "1",
      }),
    /test database/i,
  );
});

test("backup rehearsal requires confirmation and a bounded restore identifier", () => {
  const base = {
    databaseUrl: postgresUrl("127.0.0.1", "tab10_test"),
    restoreDb: "tab10_restore_rehearsal_test",
  };
  assert.throws(
    () => validateBackupConfig({ ...base, confirmation: undefined }),
    /confirmation/i,
  );
  assert.throws(
    () =>
      validateBackupConfig({
        ...base,
        confirmation: "1",
        restoreDb: 'tab10_restore_rehearsal_test"; DROP DATABASE prod; --',
      }),
    /restore database/i,
  );
});

test("backup rehearsal returns a redacted-safe local admin target", () => {
  const result = validateBackupConfig({
    databaseUrl: postgresUrl("localhost:5432", "tab10_test", {
      query: "sslmode=disable",
    }),
    restoreDb: "tab10_restore_rehearsal_ci_42",
    confirmation: "1",
  });
  assert.equal(result.sourceDatabase, "tab10_test");
  assert.equal(result.restoreDatabase, "tab10_restore_rehearsal_ci_42");
  assert.equal(
    result.adminUrl,
    postgresUrl("localhost:5432", "postgres", { query: "sslmode=disable" }),
  );
});

test("local player seed fails closed for production and remote API targets", () => {
  assert.throws(
    () => validateSeedApiBase("https://tab-10.example.com", "development"),
    /loopback/i,
  );
  assert.throws(
    () => validateSeedApiBase("http://localhost:3001", "production"),
    /production/i,
  );
  assert.equal(
    validateSeedApiBase("http://127.0.0.1:3001", "development"),
    "http://127.0.0.1:3001",
  );
});

test("backup shell uses a unique temp directory, quoted psql variables, and cleanup", () => {
  const fixture = mkdtempSync(join(tmpdir(), "tab10-ops-safety-"));
  const fakeBin = join(fixture, "bin");
  const log = join(fixture, "calls.jsonl");
  const currentPath = process.env.PATH ?? "";
  try {
    writeFileSync(
      join(fixture, "make-fakes.mjs"),
      `import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
       import { join } from "node:path";
       const dir = process.argv[2];
       mkdirSync(dir);
       const pgDump = \`#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.OPS_TEST_LOG, JSON.stringify({ bin: "pg_dump", args }) + "\\\\n");
const index = args.indexOf("--file");
writeFileSync(args[index + 1], "-- disposable dump\\\\n");
\`;
       const psql = \`#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.OPS_TEST_LOG, JSON.stringify({ bin: "psql", args }) + "\\\\n");
if (args.includes("-tAc")) process.stdout.write("auth_sessions\\\\nmatches\\\\ntournaments\\\\nusers\\\\n");
\`;
       writeFileSync(join(dir, "pg_dump"), pgDump);
       writeFileSync(join(dir, "psql"), psql);
       chmodSync(join(dir, "pg_dump"), 0o755);
       chmodSync(join(dir, "psql"), 0o755);`,
    );
    const setup = spawnSync(
      process.execPath,
      [join(fixture, "make-fakes.mjs"), fakeBin],
      { encoding: "utf8" },
    );
    assert.equal(setup.status, 0, setup.stderr);

    const result = spawnSync("bash", ["scripts/backup-rehearsal.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${currentPath}`,
        OPS_TEST_LOG: log,
        DATABASE_URL: postgresUrl("127.0.0.1", "tab10_test", {
          user: "local_user",
          credential: "do-not-print",
        }),
        RESTORE_DB: "tab10_restore_rehearsal_test_42",
        BACKUP_REHEARSAL_CONFIRM: "1",
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /do-not-print/);
    const dumpPath = result.stdout.match(/Dump written: (.+\/tab10\.sql)/)?.[1];
    assert.ok(dumpPath);
    assert.equal(existsSync(dumpPath), false);

    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(calls[0].bin, "pg_dump");
    const databaseCommands = calls
      .filter((call) => call.bin === "psql" && call.args.includes("-c"))
      .map((call) => call.args);
    assert.ok(
      databaseCommands.every((args) =>
        args.includes("restore_db=tab10_restore_rehearsal_test_42"),
      ),
    );
    assert.ok(
      databaseCommands.every((args) =>
        args.some((arg) => arg.includes(':"restore_db"')),
      ),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("backup shell rejects a remote source before invoking database tools", () => {
  const fixture = mkdtempSync(join(tmpdir(), "tab10-ops-reject-"));
  const log = join(fixture, "calls.jsonl");
  try {
    const result = spawnSync("bash", ["scripts/backup-rehearsal.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPS_TEST_LOG: log,
        DATABASE_URL: postgresUrl("db.example.com", "tab10_test"),
        RESTORE_DB: "tab10_restore_rehearsal_test",
        BACKUP_REHEARSAL_CONFIRM: "1",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /loopback/i);
    assert.equal(existsSync(log), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("seed CLI rejects remote API_BASE before making a request", () => {
  const result = spawnSync(process.execPath, ["scripts/seed-local-meme-players.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      API_BASE: "https://api.example.com",
      NODE_ENV: "development",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loopback/i);
});
