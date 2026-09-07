#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  argValue,
  releaseMetadataFromEnv,
  writeJsonAtomic,
} from "./release-lib.mjs";
import { smokeApiRelease, smokeRelease } from "./smoke-release.mjs";

const API_ORIGIN = "https://one0is-ball.onrender.com";
const WEB_ORIGIN = "https://tab-10.vercel.app";
const MAX_TIMEOUT_MS = 25 * 60_000;
const DEFAULT_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 60_000;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function duration(value, fallback, { name, maximum }) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range`);
  }
  return parsed;
}

function boundedFetch(fetchImpl, deadline, now) {
  return async (input, init = {}) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("Public release wait deadline reached");
    const deadlineSignal = AbortSignal.timeout(remaining);
    const signal = init.signal
      ? AbortSignal.any([init.signal, deadlineSignal])
      : deadlineSignal;
    return fetchImpl(input, { ...init, signal });
  };
}

function redactedSmoke(smoke) {
  return {
    checkedAt: smoke.checkedAt,
    checks: smoke.checks.map(({ name, ok }) => ({ name, ok })),
  };
}

export async function waitForPublicRelease({
  expected,
  timeoutMs = MAX_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  wait = sleep,
} = {}) {
  if (!expected) throw new Error("Expected release metadata is required");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error("timeoutMs is outside its allowed range");
  }
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new Error("intervalMs is outside its allowed range");
  }

  const startedAtMs = now();
  const deadline = startedAtMs + timeoutMs;
  let attempts = 0;

  while (now() < deadline) {
    attempts += 1;
    try {
      const fetchWithinDeadline = boundedFetch(fetchImpl, deadline, now);
      const api = await smokeApiRelease({
        apiOrigin: API_ORIGIN,
        expected,
        fetchImpl: fetchWithinDeadline,
      });
      const web = await smokeRelease({
        webOrigin: WEB_ORIGIN,
        apiOrigin: API_ORIGIN,
        expected,
        fetchImpl: fetchWithinDeadline,
      });
      return {
        schemaVersion: 1,
        ok: true,
        release: expected,
        attempts,
        elapsedMs: Math.max(0, now() - startedAtMs),
        api: redactedSmoke(api),
        web: redactedSmoke(web),
        completedAt: new Date().toISOString(),
      };
    } catch {
      const remaining = deadline - now();
      if (remaining <= 0) break;
      await wait(Math.min(intervalMs, remaining));
    }
  }

  return {
    schemaVersion: 1,
    ok: false,
    release: expected,
    attempts,
    elapsedMs: Math.max(0, now() - startedAtMs),
    failure: "exact-release-not-observed-before-deadline",
    completedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const resultFile = argValue(args, "--result-file");
  if (!resultFile) throw new Error("--result-file is required");
  const expected = await releaseMetadataFromEnv(process.env);
  const timeoutMs = duration(argValue(args, "--timeout-ms"), MAX_TIMEOUT_MS, {
    name: "--timeout-ms",
    maximum: MAX_TIMEOUT_MS,
  });
  const intervalMs = duration(
    argValue(args, "--interval-ms"),
    DEFAULT_INTERVAL_MS,
    { name: "--interval-ms", maximum: MAX_INTERVAL_MS },
  );
  const result = await waitForPublicRelease({
    expected,
    timeoutMs,
    intervalMs,
  });
  await writeJsonAtomic(resultFile, result);
  process.stdout.write(
    `${JSON.stringify({ ok: result.ok, sha: expected.sha, version: expected.version, attempts: result.attempts, elapsedMs: result.elapsedMs })}\n`,
  );
  if (!result.ok) {
    throw new Error("Exact public release was not observed before the deadline");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    process.stderr.write("Public release convergence failed\n");
    process.exitCode = 1;
  });
}
