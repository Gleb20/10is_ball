import { describe, expect, it } from "vitest";
import {
  createReleaseMetadata,
  ReleaseMetadataSchema,
} from "./release-metadata.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("release metadata contract", () => {
  it("normalizes and accepts an exact deployment SHA", () => {
    expect(
      createReleaseMetadata({
        version: "1.10.1",
        sha: SHA.toUpperCase(),
        environment: "production",
      }),
    ).toEqual({
      sha: SHA,
      version: "1.10.1",
      environment: "production",
      dirty: false,
    });
  });

  it("uses an explicit local marker outside deployed environments", () => {
    expect(
      createReleaseMetadata({
        version: "1.10.1",
        environment: "local",
      }),
    ).toEqual({
      sha: "local",
      version: "1.10.1",
      environment: "local",
      dirty: false,
    });
  });

  it.each(["staging", "production"] as const)(
    "rejects a missing exact SHA in %s",
    (environment) => {
      expect(() =>
        createReleaseMetadata({ version: "1.10.1", environment }),
      ).toThrow("full release commit SHA");
    },
  );

  it("rejects abbreviated SHAs and additional fields", () => {
    expect(() =>
      ReleaseMetadataSchema.parse({
        sha: "0123456",
        version: "1.10.1",
        environment: "production",
        dirty: false,
      }),
    ).toThrow();
    expect(() =>
      ReleaseMetadataSchema.parse({
        sha: SHA,
        version: "1.10.1",
        environment: "production",
        dirty: false,
        branch: "main",
      }),
    ).toThrow();
  });

  it("rejects dirty staging and production releases", () => {
    expect(() =>
      createReleaseMetadata({
        version: "1.10.1",
        sha: SHA,
        environment: "staging",
        dirty: true,
      }),
    ).toThrow("must not be dirty");
  });
});
