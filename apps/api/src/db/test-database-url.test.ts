import { describe, expect, it } from "vitest";
import { resolveTestDatabaseUrl } from "./test-database-url.js";

const LOCAL_TEST_URL =
  "postgresql://tab10_test:example-only@127.0.0.1:5432/tab10_test";

describe("resolveTestDatabaseUrl", () => {
  it("never falls back to DATABASE_URL", () => {
    expect(
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://app:example-only@db.internal/tab10",
      }),
    ).toBeUndefined();
  });

  it("fails closed when the dedicated PostgreSQL lane requires a URL", () => {
    expect(() =>
      resolveTestDatabaseUrl({ NODE_ENV: "test" }, { required: true }),
    ).toThrow("required for the PostgreSQL integration lane");
  });

  it("accepts an explicit loopback test database", () => {
    expect(
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        TEST_DATABASE_URL: LOCAL_TEST_URL,
        ALLOW_TEST_DATABASE_RESET: "1",
      }),
    ).toBe(LOCAL_TEST_URL);
  });

  it("requires explicit consent before the test schema may be reset", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        TEST_DATABASE_URL: LOCAL_TEST_URL,
      }),
    ).toThrow("ALLOW_TEST_DATABASE_RESET=1 is required");
  });

  it("rejects use outside NODE_ENV=test", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "production",
        TEST_DATABASE_URL: LOCAL_TEST_URL,
      }),
    ).toThrow("may only be used with NODE_ENV=test");
  });

  it("rejects any simultaneous ordinary DATABASE_URL", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://app:example-only@127.0.0.1/tab10",
        TEST_DATABASE_URL: LOCAL_TEST_URL,
      }),
    ).toThrow("DATABASE_URL must be unset");
  });

  it("rejects a database without a test-name segment", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        TEST_DATABASE_URL:
          "postgresql://tab10:example-only@127.0.0.1:5432/tab10",
      }),
    ).toThrow("standalone \"test\" segment");
  });

  it("rejects non-loopback and non-PostgreSQL targets", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        TEST_DATABASE_URL:
          "postgresql://tab10_test:example-only@db.internal/tab10_test",
      }),
    ).toThrow("loopback host");
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        TEST_DATABASE_URL: "https://127.0.0.1/tab10_test",
      }),
    ).toThrow("must use postgres or postgresql");
  });

  it("does not include credentials in validation errors", () => {
    const privateValue =
      "postgresql" + "://private-user:private-password@db.internal/tab10_test";
    expect(() =>
      resolveTestDatabaseUrl({
        NODE_ENV: "test",
        TEST_DATABASE_URL: privateValue,
      }),
    ).toThrowError(expect.not.stringContaining(privateValue));
  });
});
