import { readFileSync } from "node:fs";
import {
  createReleaseMetadata,
  ExactCommitShaSchema,
  ReleaseEnvironmentSchema,
  type ReleaseEnvironment,
  type ReleaseMetadata,
} from "@tab10/shared";

type RuntimeEnvironment = Record<string, string | undefined>;

function productVersion(): string {
  const packageJsonUrl = new URL("../../../package.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string") {
    throw new Error("Root package.json must contain a product version");
  }
  return parsed.version;
}

function releaseDirtyFrom(env: RuntimeEnvironment): boolean {
  const raw = env.TAB10_RELEASE_DIRTY?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("TAB10_RELEASE_DIRTY must be true or false");
}

export function releaseEnvironmentFrom(
  env: RuntimeEnvironment,
): ReleaseEnvironment {
  const explicit = env.TAB10_ENVIRONMENT?.trim().toLowerCase();
  if (explicit) return ReleaseEnvironmentSchema.parse(explicit);
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test") return "test";
  return "local";
}

export function resolveRuntimeReleaseMetadata(
  env: RuntimeEnvironment = process.env,
): ReleaseMetadata {
  const expectedVersion = productVersion();
  const configuredVersion =
    env.TAB10_RELEASE_VERSION?.trim() || expectedVersion;
  if (configuredVersion !== expectedVersion) {
    throw new Error(
      "TAB10_RELEASE_VERSION must match the root package.json version",
    );
  }

  const environment = releaseEnvironmentFrom(env);
  const shaSources = [
    ["TAB10_RELEASE_SHA", env.TAB10_RELEASE_SHA],
    ["RENDER_GIT_COMMIT", env.RENDER_GIT_COMMIT],
    ["GITHUB_SHA", env.GITHUB_SHA],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  const normalizedShas = shaSources.map(([name, value]) => {
    const normalized = value.trim().toLowerCase();
    if (environment === "staging" || environment === "production") {
      const parsed = ExactCommitShaSchema.safeParse(normalized);
      if (!parsed.success) {
        throw new Error(`${name} must be a full 40-character Git SHA`);
      }
    }
    return normalized;
  });
  if (new Set(normalizedShas).size > 1) {
    throw new Error("Hosted release SHA sources disagree");
  }

  return createReleaseMetadata({
    sha: normalizedShas[0],
    version: configuredVersion,
    environment,
    dirty: releaseDirtyFrom(env),
  });
}
