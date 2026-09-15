import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(evidenceDir);
const repoDir = path.resolve(packageDir, "../../../..");
const frozenDir = "/private/tmp/tab10-ux-audit-dispatch-v1";
const expectedBaseSha = "9f71b9f4c91f6f7184e8c34716d7b57b7c27a221";
const expectedManifestSha = "c39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6";
const expectedApplicationFingerprint = "8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3";

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const findings = await readJson(path.join(packageDir, "findings.json"));
const requiredFindingKeys = [
  "id", "title", "kind", "priority", "confidence", "where", "actual", "expected",
  "reproduction", "evidence", "impact", "frequency", "overlap", "smallestRemedy",
  "preserved", "dependencies", "validationNeeded", "target", "reviewerVerdict",
];
check(findings.length === 6, `findings.json: ожидалось 6 записей, получено ${findings.length}`);
check(new Set(findings.map(({ id }) => id)).size === findings.length, "findings.json: повторяющиеся id");
for (const finding of findings) {
  for (const key of requiredFindingKeys) check(key in finding, `${finding.id}: отсутствует ${key}`);
  for (const evidence of finding.evidence ?? []) {
    if (!evidence.includes("/") || evidence.startsWith("J-RUN-")) continue;
    const candidate = path.resolve(packageDir, evidence.split("#")[0]);
    try { await access(candidate); } catch { failures.push(`${finding.id}: не найдено evidence ${evidence}`); }
  }
}

const runtime = await readJson(path.join(evidenceDir, "runtime-states.json"));
check(runtime.records.length === 42, `runtime-states.json: ожидалось 42 состояния, получено ${runtime.records.length}`);
check(runtime.consoleProblems.length === 12, `runtime-states.json: ожидалось 12 ожидаемых console failures, получено ${runtime.consoleProblems.length}`);
check(runtime.records.every(({ horizontalOverflow }) => horizontalOverflow === undefined || horizontalOverflow === false), "runtime-states.json: найден horizontal overflow");
const unknownOutcome = runtime.records.find(({ id }) => id === "j11-unknown-outcome-authoritative-score-1440");
check(unknownOutcome?.idempotencyKeyCaptured === true, "j11: exact idempotency key не был захвачен");
check(unknownOutcome?.scores?.join(":") === "4:1", "j11: authoritative score не равен 4:1");

const fixture = await readJson(path.join(evidenceDir, "fixture-index.json"));
check(fixture.runtime.sha === expectedBaseSha, `fixture-index.json: неожиданный SHA ${fixture.runtime.sha}`);
check(fixture.runtime.environment === "test", "fixture-index.json: runtime не test");
check(fixture.actors.length === 5 && fixture.actors.every(({ credentialStored }) => credentialStored === false), "fixture-index.json: synthetic actor/credential contract нарушен");

const readbacks = await readJson(path.join(evidenceDir, "authoritative-readbacks.json"));
check(readbacks.main.status === "finished" && readbacks.main.scoreA === 10 && readbacks.main.scoreB === 2 && readbacks.main.winnerSide === "A" && readbacks.main.activeJudge === null, "authoritative-readbacks.json: main result не равен finished 10:2/A/null");
check(readbacks.noShow.status === "stopped" && readbacks.noShow.scoreA === 0 && readbacks.noShow.scoreB === 0 && readbacks.noShow.finishReason === "no_show", "authoritative-readbacks.json: no-show readback не совпал");
check(readbacks.stopped.status === "stopped" && readbacks.stopped.scoreA === 0 && readbacks.stopped.scoreB === 0 && readbacks.stopped.finishReason === "manual_stop", "authoritative-readbacks.json: stop readback не совпал");
check(readbacks.releaseWarningMatch.status === "waiting", "authoritative-readbacks.json: release-warning match не waiting");

const screenshots = (await readdir(path.join(evidenceDir, "screenshots"))).filter((name) => name.endsWith(".png"));
const wireframes = (await readdir(path.join(evidenceDir, "wireframes"))).filter((name) => name.endsWith(".png"));
check(screenshots.length === 25, `ожидалось 25 runtime screenshots, получено ${screenshots.length}`);
check(wireframes.length === 3, `ожидалось 3 target wireframes, получено ${wireframes.length}`);

const csvContracts = [["runs.csv", 10], ["requirement-coverage-delta.csv", 8]];
for (const [name, columns] of csvContracts) {
  const rows = (await readFile(path.join(packageDir, name), "utf8")).trimEnd().split("\n");
  rows.forEach((row, index) => check(row.split(",").length === columns, `${name}:${index + 1}: ожидалось ${columns} полей`));
}
const runRows = (await readFile(path.join(packageDir, "runs.csv"), "utf8")).trimEnd().split("\n").slice(1);
for (const [index, row] of runRows.entries()) {
  for (const evidence of row.split(",")[8].split(";").map((value) => value.trim())) {
    if (!/^(?:evidence\/|\.\.\/)/.test(evidence)) continue;
    const candidate = path.resolve(packageDir, evidence.split("#")[0]);
    try { await access(candidate); } catch { failures.push(`runs.csv:${index + 2}: не найдено evidence ${evidence}`); }
  }
}

for (const name of ["report.md", "target-spec.md", "handoff.md", "flow-report.html", "evidence/target-wireframes.html"]) {
  const file = path.join(packageDir, name);
  const source = await readFile(file, "utf8");
  check(!source.includes("{{"), `${name}: найден незаполненный placeholder`);
  const links = [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)|(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? match[2]);
  for (const link of links) {
    if (/^(?:https?:|data:|mailto:|#)/.test(link)) continue;
    const candidate = path.resolve(path.dirname(file), decodeURIComponent(link.split("#")[0]));
    try { await access(candidate); } catch { failures.push(`${name}: не найдена ссылка ${link}`); }
  }
}

const frozenManifestPath = path.join(frozenDir, "manifest.json");
const frozenManifestBuffer = await readFile(frozenManifestPath);
check(sha256(frozenManifestBuffer) === expectedManifestSha, "SHA-256 frozen manifest не совпал");
const frozenManifest = JSON.parse(frozenManifestBuffer);
check(Object.keys(frozenManifest.files).length === 310, "frozen manifest не содержит 310 paths");
for (const [relative, entry] of Object.entries(frozenManifest.files)) {
  const candidate = path.join(repoDir, relative);
  if (entry.deleted) {
    try { await access(candidate); failures.push(`frozen source должен отсутствовать: ${relative}`); } catch {}
    continue;
  }
  try {
    check(sha256(await readFile(candidate)) === entry.sha256, `frozen source hash mismatch: ${relative}`);
  } catch {
    failures.push(`frozen source отсутствует: ${relative}`);
  }
}

const candidateSource = await readJson(path.resolve(packageDir, "..", "candidate-source.json"));
check(candidateSource.source_content_fingerprint === expectedApplicationFingerprint, "application fingerprint не совпал");

try {
  const manifestRows = (await readFile(path.join(packageDir, "manifest.sha256"), "utf8")).trimEnd().split("\n");
  for (const row of manifestRows) {
    const match = row.match(/^([0-9a-f]{64})  (.+)$/);
    check(Boolean(match), `manifest.sha256: некорректная строка ${row}`);
    if (!match) continue;
    const [, expected, relative] = match;
    try { check(sha256(await readFile(path.resolve(packageDir, relative))) === expected, `manifest.sha256: mismatch ${relative}`); }
    catch { failures.push(`manifest.sha256: отсутствует ${relative}`); }
  }
} catch {
  failures.push("manifest.sha256 отсутствует");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "PASS", findings: findings.length, runtimeStates: runtime.records.length, screenshots: screenshots.length, wireframes: wireframes.length, frozenPaths: Object.keys(frozenManifest.files).length }));
}
