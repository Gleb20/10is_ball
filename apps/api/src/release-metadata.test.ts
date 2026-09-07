import { describe, expect, it } from "vitest";
import {
  releaseEnvironmentFrom,
  resolveRuntimeReleaseMetadata,
} from "./release-metadata.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("API runtime release metadata", () => {
  it("uses Render's immutable commit identifier", () => {
    expect(
      resolveRuntimeReleaseMetadata({
        NODE_ENV: "production",
        RENDER_GIT_COMMIT: SHA,
      }),
    ).toEqual({
      sha: SHA,
      version: "1.10.1",
      environment: "production",
      dirty: false,
    });
  });

  it("rejects disagreement with the provider's immutable commit SHA", () => {
    const explicitSha = "abcdef0123456789abcdef0123456789abcdef01";
    expect(() =>
      resolveRuntimeReleaseMetadata({
        NODE_ENV: "production",
        TAB10_RELEASE_SHA: explicitSha,
        TAB10_RELEASE_VERSION: "1.10.1",
        TAB10_ENVIRONMENT: "production",
        TAB10_RELEASE_DIRTY: "false",
        RENDER_GIT_COMMIT: SHA,
      }),
    ).toThrow("SHA sources disagree");
  });

  it("accepts matching hosted SHA sources", () => {
    expect(
      resolveRuntimeReleaseMetadata({
        NODE_ENV: "production",
        TAB10_RELEASE_SHA: SHA,
        RENDER_GIT_COMMIT: SHA,
        GITHUB_SHA: SHA,
      }).sha,
    ).toBe(SHA);
  });

  it("fails closed when a production process has no exact SHA", () => {
    expect(() =>
      resolveRuntimeReleaseMetadata({ NODE_ENV: "production" }),
    ).toThrow("full release commit SHA");
  });

  it("maps ordinary local and test processes without deployment metadata", () => {
    expect(releaseEnvironmentFrom({})).toBe("local");
    expect(releaseEnvironmentFrom({ NODE_ENV: "test" })).toBe("test");
    expect(resolveRuntimeReleaseMetadata({ NODE_ENV: "test" }).sha).toBe("test");
  });

  it("rejects version drift from the root package", () => {
    expect(() =>
      resolveRuntimeReleaseMetadata({
        NODE_ENV: "test",
        TAB10_RELEASE_VERSION: "9.9.9",
      }),
    ).toThrow("root package.json version");
  });
});
