#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  assertDeployEnvironment,
  assertExactSha,
  createReleaseMetadata,
  publicError,
  releaseMetadataFromEnv,
} from "./release-lib.mjs";
import { smokeApiRelease } from "./smoke-release.mjs";

const API_ORIGIN = "https://one0is-ball.onrender.com";
const DRAIN_MS = 420_000;
const TIMEOUT_MS = 25 * 60_000;
const POLL_MS = 15_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A successful poll must include health, database readiness and OpenAPI identity.
// Any interruption restarts the conservative old-instance drain window.
export async function waitForApiDrain({
  expected,
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  wait = sleep,
}) {
  const release = createReleaseMetadata(expected);
  assertDeployEnvironment(release.environment);
  const deadline = now() + TIMEOUT_MS;
  let healthySince = null;
  let attempts = 0;
  while (now() < deadline) {
    attempts += 1;
    try {
      await smokeApiRelease({
        apiOrigin: API_ORIGIN,
        expected: release,
        fetchImpl: async (input, init = {}) => {
          const remaining = Math.ceil(deadline - now());
          if (remaining <= 0) throw new Error("API drain deadline reached");
          const bounded = AbortSignal.timeout(Math.min(10_000, remaining));
          return fetchImpl(input, {
            ...init,
            redirect: "error",
            signal: init.signal ? AbortSignal.any([init.signal, bounded]) : bounded,
          });
        },
      });
      const observedAt = now();
      if (observedAt >= deadline) break;
      healthySince ??= observedAt;
      if (observedAt - healthySince >= DRAIN_MS) {
        return { verifiedForMs: observedAt - healthySince, attempts, release };
      }
    } catch {
      healthySince = null;
    }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(POLL_MS, remaining));
  }
  throw new Error("API release readiness and drain timed out; web publication refused");
}

export async function gateProductionWebBuild({
  env = process.env,
  waitForApi = waitForApiDrain,
} = {}) {
  if (env.VERCEL_ENV !== "production") return { status: "not-production" };
  assertExactSha(env.VERCEL_GIT_COMMIT_SHA, "VERCEL_GIT_COMMIT_SHA");
  const expected = await releaseMetadataFromEnv(env);
  assertDeployEnvironment(expected.environment);
  return { status: "ready", ...(await waitForApi({ expected })) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  gateProductionWebBuild().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}
