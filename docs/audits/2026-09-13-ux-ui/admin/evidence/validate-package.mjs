import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("docs/audits/2026-09-13-ux-ui/admin");
for (const file of ["findings.json", "evidence/runtime-observations.json", "evidence/environment.json", "evidence/cleanup.json", "evidence/fixture-index.json"]) JSON.parse(readFileSync(path.join(root, file), "utf8"));
for (const [file, rows] of [["runs.csv", 8], ["requirement-coverage-delta.csv", 17]]) {
  const actual = readFileSync(path.join(root, file), "utf8").trim().split(/\r?\n/).length - 1;
  if (actual !== rows) throw new Error(`${file}: expected ${rows} data rows, found ${actual}`);
}

const linkFiles = ["report.md", "handoff.md", "target-spec.md", "source-review.md", "flow-report.html", "annotated-before-after.html"];
const missing = [];
for (const file of linkFiles) {
  const text = readFileSync(path.join(root, file), "utf8");
  const refs = [...text.matchAll(/(?:href|src)=["']([^"']+)["']|\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1] ?? match[2]);
  for (const ref of refs) {
    const clean = ref.split("#")[0];
    if (!clean || /^(?:https?:|data:|mailto:)/.test(clean)) continue;
    if (!existsSync(path.resolve(path.dirname(path.join(root, file)), clean))) missing.push(`${file}: ${ref}`);
  }
}
if (missing.length) throw new Error(`Missing local references:\n${missing.join("\n")}`);

const candidate = JSON.parse(readFileSync(path.resolve("docs/audits/2026-09-13-ux-ui/candidate-source.json"), "utf8"));
const mismatches = [];
for (const [file, expected] of Object.entries(candidate.sha256)) {
  if (!existsSync(file) || createHash("sha256").update(readFileSync(file)).digest("hex") !== expected) mismatches.push(file);
}
if (mismatches.length) throw new Error(`Accepted candidate changed: ${mismatches.join(", ")}`);

const cleanup = JSON.parse(readFileSync(path.join(root, "evidence/cleanup.json"), "utf8"));
if (cleanup.status !== "complete" || Object.values(cleanup.ports).some((value) => value !== "free") || cleanup.secretsPersisted !== false) throw new Error("Cleanup evidence is not complete");
console.log(JSON.stringify({ status: "pass", json: 5, csvRows: 25, links: "pass", candidateFiles: Object.keys(candidate.sha256).length, cleanup: "complete" }));
