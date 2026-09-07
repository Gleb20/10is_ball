#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCAN_ROOTS = [
  "README.md",
  "CHANGELOG.md",
  "AGENTS.md",
  "apps/api/AGENTS.md",
  "apps/web/AGENTS.md",
  "packages/shared/AGENTS.md",
  "docs",
  ".cursor/rules",
];
const BACKLOG_ID = /\b(?:SEC|BUG|GAP|DATA|OPS|TECH)-\d{3}\b/g;
const BACKLOG_FIELDS = [
  "Type",
  "Priority",
  "Status",
  "Evidence",
  "Expected",
  "Actual",
  "Repro",
  "Risk",
  "Verification",
  "Dependencies",
];
const BACKLOG_STATUSES = new Set([
  "confirmed",
  "ready",
  "in_progress",
  "verified_local",
  "verified_prod",
  "done",
  "blocked_decision",
]);

async function collect(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  try {
    const info = await stat(absolute);
    if (info.isFile()) return /\.(md|mdc)$/i.test(relativePath) ? [relativePath] : [];
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }
  const result = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    result.push(...(await collect(path.join(relativePath, entry.name))));
  }
  return result;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

const files = (await Promise.all(SCAN_ROOTS.map(collect))).flat().sort();
const brokenLinks = [];
const brokenAnchors = [];
const sourceCache = new Map();

async function sourceFor(absolutePath) {
  if (!sourceCache.has(absolutePath)) {
    sourceCache.set(absolutePath, await readFile(absolutePath, "utf8"));
  }
  return sourceCache.get(absolutePath);
}

function headingAnchors(source) {
  const anchors = new Set();
  const seen = new Map();
  for (const match of source.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const text = match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s/g, "-");
    const duplicate = seen.get(text) ?? 0;
    seen.set(text, duplicate + 1);
    anchors.add(duplicate === 0 ? text : `${text}-${duplicate}`);
  }
  for (const match of source.matchAll(/<(?:a|span)\s+(?:name|id)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

for (const file of files) {
  const absoluteSource = path.join(ROOT, file);
  const source = await sourceFor(absoluteSource);
  const links = source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (/^(https?:|mailto:|data:|\/)/i.test(target)) continue;
    const hashIndex = target.indexOf("#");
    const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
    const rawAnchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
    const decodedPath = decodeURIComponent(rawPath);
    const absoluteTarget = rawPath
      ? path.resolve(path.dirname(absoluteSource), decodedPath)
      : absoluteSource;
    if (!(await exists(absoluteTarget))) {
      brokenLinks.push({ file, target });
      continue;
    }
    if (rawAnchor) {
      const info = await stat(absoluteTarget);
      if (info.isFile() && /\.(md|mdc)$/i.test(absoluteTarget)) {
        const anchor = decodeURIComponent(rawAnchor).toLowerCase();
        const anchors = headingAnchors(await sourceFor(absoluteTarget));
        if (!anchors.has(anchor)) brokenAnchors.push({ file, target });
      }
    }
  }
}

const backlogPath = path.join(ROOT, "docs/BACKLOG.md");
const backlogIds = [];
const malformedBacklogHeadings = [];
const incompleteBacklogItems = [];
const invalidBacklogStatuses = [];
if (await exists(backlogPath)) {
  const backlog = await sourceFor(backlogPath);
  for (const match of backlog.matchAll(/^###\s+((?:SEC|BUG|GAP|DATA|OPS|TECH)-\d{3})\b/gm)) {
    backlogIds.push(match[1]);
  }
  for (const match of backlog.matchAll(/^(#{1,6})\s+((?:SEC|BUG|GAP|DATA|OPS|TECH)-\d{3})\b/gm)) {
    if (match[1] !== "###") malformedBacklogHeadings.push(match[2]);
  }
  const definitions = [...backlog.matchAll(/^###\s+((?:SEC|BUG|GAP|DATA|OPS|TECH)-\d{3})\b/gm)];
  for (let index = 0; index < definitions.length; index += 1) {
    const current = definitions[index];
    const next = definitions[index + 1];
    const section = backlog.slice(current.index, next?.index ?? backlog.length);
    const missingFields = BACKLOG_FIELDS.filter(
      (field) => !new RegExp(`^- \\*\\*${field}:\\*\\*`, "m").test(section),
    );
    if (missingFields.length > 0) {
      incompleteBacklogItems.push({ id: current[1], missingFields });
    }
    const status = section.match(/^- \*\*Status:\*\*\s+([^\s]+)/m)?.[1];
    if (!status || !BACKLOG_STATUSES.has(status)) {
      invalidBacklogStatuses.push({ id: current[1], status: status ?? null });
    }
  }
}
const duplicates = [...new Set(backlogIds.filter((id, index) => backlogIds.indexOf(id) !== index))];
const definitionSet = new Set(backlogIds);
const unknownBacklogReferences = [];
for (const file of files) {
  const source = await sourceFor(path.join(ROOT, file));
  for (const id of source.match(BACKLOG_ID) ?? []) {
    if (!definitionSet.has(id)) unknownBacklogReferences.push({ file, id });
  }
}
const uniqueUnknownReferences = [
  ...new Map(unknownBacklogReferences.map((item) => [JSON.stringify(item), item])).values(),
];

const report = {
  checkedFiles: files.length,
  brokenLinks,
  brokenAnchors,
  backlogDefinitionCount: backlogIds.length,
  duplicateBacklogDefinitions: duplicates,
  malformedBacklogHeadings,
  incompleteBacklogItems,
  invalidBacklogStatuses,
  unknownBacklogReferences: uniqueUnknownReferences,
};
console.log(JSON.stringify(report, null, 2));
if (
  brokenLinks.length > 0 ||
  brokenAnchors.length > 0 ||
  duplicates.length > 0 ||
  malformedBacklogHeadings.length > 0 ||
  incompleteBacklogItems.length > 0 ||
  invalidBacklogStatuses.length > 0 ||
  uniqueUnknownReferences.length > 0
) {
  process.exitCode = 1;
}
