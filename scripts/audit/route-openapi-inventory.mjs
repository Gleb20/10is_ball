#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE = path.join(ROOT, "apps/api/src/app.ts");
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function normalizeRoute(route) {
  return route.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed object beginning at offset ${openIndex}`);
}

function registeredOperations(source) {
  const operations = [];
  const matcher = /\bapp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gms;
  for (const match of source.matchAll(matcher)) {
    operations.push(`${match[1].toUpperCase()} ${normalizeRoute(match[2])}`);
  }
  return [...new Set(operations)].sort();
}

function documentedOperations(source) {
  const functionStart = source.indexOf("function openApiSpec");
  if (functionStart === -1) throw new Error("openApiSpec() was not found");
  const pathsLabel = source.indexOf("paths:", functionStart);
  const pathsOpen = source.indexOf("{", pathsLabel);
  const pathsClose = matchingBrace(source, pathsOpen);
  const body = source.slice(pathsOpen + 1, pathsClose);
  const operations = [];
  let cursor = 0;

  while (cursor < body.length) {
    const pathMatch = /["'](\/[^"']+)["']\s*:\s*\{/g.exec(body.slice(cursor));
    if (!pathMatch) break;
    const matchStart = cursor + pathMatch.index;
    const objectOpen = matchStart + pathMatch[0].lastIndexOf("{");
    const objectClose = matchingBrace(body, objectOpen);
    const route = normalizeRoute(pathMatch[1]);
    const routeBody = body.slice(objectOpen + 1, objectClose);
    for (const methodMatch of routeBody.matchAll(/\b(get|post|put|patch|delete)\s*:/g)) {
      operations.push(`${methodMatch[1].toUpperCase()} ${route}`);
    }
    cursor = objectClose + 1;
  }

  return [...new Set(operations)].sort();
}

const source = await readFile(SOURCE, "utf8");
const registered = registeredOperations(source);
const documented = documentedOperations(source);
const registeredPaths = [...new Set(registered.map((item) => item.slice(item.indexOf(" ") + 1)))];
const documentedPaths = [...new Set(documented.map((item) => item.slice(item.indexOf(" ") + 1)))];
const missingFromOpenApi = registered.filter((item) => !documented.includes(item));
const notRegistered = documented.filter((item) => !registered.includes(item));
const report = {
  schemaVersion: 1,
  source: path.relative(ROOT, SOURCE),
  inventoryMethod: "direct literal app.<method>() registrations and openApiSpec paths",
  limitations: [
    "Routes registered dynamically, through plugins, or outside apps/api/src/app.ts require a separate inventory update",
  ],
  registeredCount: registered.length,
  documentedCount: documented.length,
  registeredPathCount: registeredPaths.length,
  documentedPathCount: documentedPaths.length,
  coveragePercent: Number(((documented.length / registered.length) * 100).toFixed(1)),
  registered,
  documented,
  missingFromOpenApi,
  notRegistered,
};

const output = valueAfter("--out");
if (output) {
  const outputPath = path.resolve(ROOT, output);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

let failed = false;
const baselinePath = valueAfter("--baseline");
if (baselinePath) {
  const baseline = JSON.parse(await readFile(path.resolve(ROOT, baselinePath), "utf8"));
  const baselineRegistered = new Set(baseline.registered ?? []);
  const baselineDocumented = new Set(baseline.documented ?? []);
  const currentRegistered = new Set(registered);
  const currentDocumented = new Set(documented);
  const addedRegistered = registered.filter((item) => !baselineRegistered.has(item));
  const removedRegistered = [...baselineRegistered].filter(
    (item) => !currentRegistered.has(item),
  );
  const addedDocumented = documented.filter((item) => !baselineDocumented.has(item));
  const removedDocumented = [...baselineDocumented].filter(
    (item) => !currentDocumented.has(item),
  );
  if (
    addedRegistered.length > 0 ||
    removedRegistered.length > 0 ||
    addedDocumented.length > 0 ||
    removedDocumented.length > 0 ||
    notRegistered.length > 0
  ) {
    failed = true;
    report.regression = {
      addedRegistered,
      removedRegistered,
      addedDocumented,
      removedDocumented,
      notRegistered,
    };
  }
}
if (args.includes("--strict") && (missingFromOpenApi.length > 0 || notRegistered.length > 0)) {
  failed = true;
}

console.log(JSON.stringify(report, null, 2));
if (failed) process.exitCode = 1;
