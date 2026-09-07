#!/usr/bin/env node

import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import {
  argValue,
  assertDeployEnvironment,
  createReleaseMetadata,
  fetchJson,
  publicError,
  releaseMetadataFromEnv,
  requiredEnv,
  validatedOrigin,
  writeJsonAtomic,
} from "./release-lib.mjs";

const RELEASE_KEYS = ["dirty", "environment", "sha", "version"];

export function validateReleasePayload(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Release payload is not an object");
  }
  const keys = Object.keys(value).sort();
  if (!isDeepStrictEqual(keys, RELEASE_KEYS)) {
    throw new Error("Release payload does not match the canonical shape");
  }
  const parsed = createReleaseMetadata(value);
  if (!isDeepStrictEqual(parsed, expected)) {
    throw new Error("Observed release identity does not match the requested SHA");
  }
  return parsed;
}

export async function smokeRelease({
  webOrigin,
  apiOrigin,
  expected,
  fetchImpl = globalThis.fetch,
  allowHttp = false,
}) {
  assertDeployEnvironment(expected.environment);
  const web = validatedOrigin(webOrigin, "Web origin", { allowHttp });
  const api = validatedOrigin(apiOrigin, "API origin", { allowHttp });
  const checks = [
    {
      name: "web-release",
      url: `${web}/release.json`,
      release: (body) => body,
    },
    { name: "web-health-proxy", url: `${web}/health`, status: "ok" },
    { name: "web-ready-proxy", url: `${web}/ready`, status: "ready" },
    {
      name: "web-openapi-proxy",
      url: `${web}/api/v1/openapi.json`,
      openApi: true,
    },
    ...apiChecks(api),
  ];
  const results = [];
  for (const check of checks) {
    const body = await fetchJson(
      check.url,
      { headers: { Accept: "application/json", "Cache-Control": "no-cache" } },
      { fetchImpl },
    );
    if (check.status && body?.status !== check.status) {
      throw new Error(`${check.name} returned an unexpected status`);
    }
    if (check.openApi) {
      if (body?.info?.version !== expected.version) {
        throw new Error(`${check.name} reported a different product version`);
      }
    } else {
      validateReleasePayload(check.release ? check.release(body) : body?.release, expected);
    }
    results.push({ name: check.name, ok: true });
  }
  return {
    ok: true,
    release: expected,
    checkedAt: new Date().toISOString(),
    checks: results,
  };
}

function apiChecks(api) {
  return [
    { name: "api-health", url: `${api}/health`, status: "ok" },
    { name: "api-ready", url: `${api}/ready`, status: "ready" },
    { name: "api-openapi", url: `${api}/api/v1/openapi.json`, openApi: true },
  ];
}

export async function smokeApiRelease({
  apiOrigin,
  expected,
  fetchImpl = globalThis.fetch,
  allowHttp = false,
}) {
  assertDeployEnvironment(expected.environment);
  const api = validatedOrigin(apiOrigin, "API origin", { allowHttp });
  const results = [];
  for (const check of apiChecks(api)) {
    const body = await fetchJson(
      check.url,
      { headers: { Accept: "application/json", "Cache-Control": "no-cache" } },
      { fetchImpl },
    );
    if (check.status && body?.status !== check.status) {
      throw new Error(`${check.name} returned an unexpected status`);
    }
    if (check.openApi) {
      if (body?.info?.version !== expected.version) {
        throw new Error(`${check.name} reported a different product version`);
      }
    } else {
      validateReleasePayload(body?.release, expected);
    }
    results.push({ name: check.name, ok: true });
  }
  return {
    ok: true,
    release: expected,
    checkedAt: new Date().toISOString(),
    checks: results,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const expected = await releaseMetadataFromEnv(process.env);
  const webOrigin = argValue(args, "--web-origin");
  const apiOrigin =
    argValue(args, "--api-origin") ?? requiredEnv(process.env, "TAB10_API_ORIGIN");
  const result = args.includes("--api-only")
    ? await smokeApiRelease({
        apiOrigin,
        expected,
        allowHttp: args.includes("--allow-http"),
      })
    : await smokeRelease({
        webOrigin: webOrigin ?? requiredEnv(process.env, "TAB10_WEB_ORIGIN"),
        apiOrigin,
        expected,
        allowHttp: args.includes("--allow-http"),
      });
  const resultFile = argValue(args, "--result-file");
  if (resultFile) await writeJsonAtomic(resultFile, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${publicError(error)}\n`);
    process.exitCode = 1;
  });
}
