#!/usr/bin/env python3
"""Fail closed on missing stage-0 source IDs, atoms, links and copy integrity."""

from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
UNIVERSE = json.loads((HERE / "source-universe.json").read_text())
MANIFEST = json.loads((HERE / "source-copy-manifest.json").read_text())
BACKLOG = (ROOT / "docs/BACKLOG.md").read_text()
ACCEPTANCE = (ROOT / "docs/requirements/11_ACCEPTANCE_TEST_CATALOG.md").read_text()
DECISIONS = (ROOT / "docs/DECISIONS.md").read_text()
QUESTIONS = (ROOT / "docs/OPEN_QUESTIONS.md").read_text()
errors: list[str] = []


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


for name, detail in MANIFEST.items():
    path = HERE / name
    if not path.is_file() or sha(path) != detail["sha256"] or path.stat().st_size != detail["bytes"]:
        errors.append(f"source copy changed/missing: {name}")

source_rows: dict[tuple[str, str], dict[str, str]] = {}
primary_turns: dict[str, set[str]] = {}
report_image_hashes: dict[str, set[str]] = {}
for source_name, ids in UNIVERSE["episodes"].items():
    folder = HERE / "sessions" / source_name.removeprefix("user-session-")
    receipt = json.loads((folder / "receipt.json").read_text())
    for filename, expected in receipt["files"].items():
        if sha(folder / filename) != expected:
            errors.append(f"receipt hash mismatch: {source_name}/{filename}")
    with (folder / "observations.csv").open(newline="") as file:
        rows = list(csv.DictReader(file))
    seen = [row["episode_id"] for row in rows]
    if seen != ids or len(seen) != len(set(seen)):
        errors.append(f"source episode universe mismatch: {source_name}")
    if len(rows) != receipt.get("csv_rows", receipt.get("rows")):
        errors.append(f"receipt row count mismatch: {source_name}")
    image_hashes = set(re.findall(r"\b[a-f0-9]{64}\b", (folder / "report.md").read_text()))
    report_image_hashes["match" if "table" in source_name else "tournament"] = image_hashes
    if len(image_hashes) != receipt["unique_image_hash_references"]:
        errors.append(f"image hash references mismatch: {source_name}")
    if receipt["original_images_received"] is not False:
        errors.append(f"unreviewed image provenance changed: {source_name}")
    source_rows.update({(source_name, row["episode_id"]): row for row in rows})
    primary_filename = "match-primary-messages.json" if "table" in source_name else "tournament-primary-messages.json"
    messages = json.loads((HERE / "sources" / primary_filename).read_text())["messages"]
    if len(messages) != (10 if "table" in source_name else 5):
        errors.append(f"primary message count drift: {source_name}")
    primary_turns[source_name] = {message["turnId"] for message in messages}

visual = json.loads((HERE / "sources/primary-visual-receipt.json").read_text())
if len(visual.get("files", [])) != 44 or visual.get("counts") != {"match": 19, "tournament": 25}:
    errors.append("visual receipt count mismatch")
for source in ("match", "tournament"):
    observed = {item["sha256"] for item in visual["files"] if item["source"] == source}
    if observed != report_image_hashes.get(source, set()):
        errors.append(f"visual receipt hash set mismatch: {source}")

if UNIVERSE["counts"] != {"episodes": 82, "expert_items": 38}:
    errors.append("frozen counts changed")

with (HERE / "coverage.csv").open(newline="") as file:
    coverage = list(csv.DictReader(file))

implementation = json.loads((HERE / "implementation-results.json").read_text())
if implementation.get("schemaVersion") != 1:
    errors.append("implementation result schema mismatch")
result_rows = implementation.get("results", [])
expected_stage1 = {
    ("user-session-2026-09-16-table-01", "U01-FORM-007", "main"),
    ("user-session-2026-09-16-table-01", "U01-FORM-007", "a01"),
    ("user-session-2026-09-17-tournament-01", "T01-06", "main"),
    ("user-session-2026-09-17-tournament-01", "T01-06", "a01"),
    ("user-session-2026-09-17-tournament-01", "T01-06", "a02"),
    ("user-session-2026-09-17-tournament-01", "T05-02", "main"),
}
stage2_atoms = {
    "HOME-001": ("main", "a01", "a02"),
    "HOME-002": ("main", "a01", "a02", "a03"),
    "HOME-004": ("main", "a01", "a02", "a03"),
    "HOME-005": ("main", "a01", "a02", "a03"),
    "HOME-006": ("main", "a01", "a02"),
    "HOME-007": ("main", "a01", "a02", "a03"),
    "U01-START-001": ("main",),
}
expected_stage2 = {
    ("user-session-2026-09-16-table-01", source_id, atom_id)
    for source_id, atom_ids in stage2_atoms.items() for atom_id in atom_ids
}
if len(expected_stage2) != 23:
    errors.append("stage 2 eligible atom count changed")
table_source = "user-session-2026-09-16-table-01"
expert_source = "expert-stage-08"
expected_stage3 = {
    (table_source, "AUTH-001", "main"): ("BUG-028", "target_pending_implementation", "verified_local"),
    (table_source, "AUTH-001", "a01"): ("BUG-028", "target_pending_implementation", "verified_local"),
    (table_source, "AUTH-001", "a02"): ("BUG-028", "target_pending_implementation", "verified_local"),
    (table_source, "AUTH-002", "main"): ("BUG-028", "target_pending_implementation", "verified_local"),
    (table_source, "AUTH-002", "a01"): ("BUG-028", "target_pending_implementation", "verified_local"),
    (table_source, "AUTH-004", "main"): ("BUG-028", "target_pending_implementation", "verified_local"),
    (table_source, "AUTH-004", "a01"): ("BUG-020", "target_pending_implementation", "verified_local"),
    (table_source, "U01-DETAIL-002", "a01"): ("GAP-034", "target_pending_implementation", "common_sample_verified_local_domain_consumers_pending"),
    (table_source, "U01-JUDGE-003", "a03"): ("GAP-034", "target_pending_implementation", "common_sample_verified_local_domain_consumers_pending"),
    (expert_source, "BUG-018", "main"): ("BUG-018", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-019", "main"): ("BUG-019", "historical_target_reconciled_not_implemented", "verified_local_physical_device_pending"),
    (expert_source, "BUG-020", "main"): ("BUG-020", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-021", "main"): ("BUG-021", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-023", "main"): ("BUG-023", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-024", "main"): ("BUG-024", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-025", "main"): ("BUG-025", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-026", "main"): ("BUG-026", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-027", "main"): ("BUG-027", "historical_target_reconciled_not_implemented", "verified_local"),
    (expert_source, "BUG-028", "main"): ("BUG-028", "historical_target_reconciled_not_implemented", "verified_local"),
}
expected_stage3_pending = {
    (table_source, "AUTH-003", "main"): "physical_device_pending",
    (table_source, "AUTH-003", "a01"): "reproduce_before_acceptance",
    (table_source, "U01-JUDGE-001", "main"): "physical_device_pending",
    (expert_source, "BUG-022", "main"): "pending_decision",
}
overrides = {(r["source"], r["source_id"], r["atom_id"]): r for r in result_rows}
if len(result_rows) != len(overrides) or set(overrides) != expected_stage1 | expected_stage2 | set(expected_stage3):
    errors.append("stage 1, 2 or 3 implementation result keys changed")
coverage_by_key = {(r["source"], r["source_id"], r["atom_id"]): r for r in coverage}
home_role_key = ("user-session-2026-09-16-table-01", "HOME-004", "a01")
if coverage_by_key.get(home_role_key, {}).get("acceptance") != "AT-HOME-001":
    errors.append("HOME-004/a01 lacks AT-HOME-001 bounded projection acceptance")
for key, result in overrides.items():
    row = coverage_by_key.get(key)
    if key in expected_stage1:
        expected_task, expected_stage = "GAP-029", 1
    elif key in expected_stage2:
        expected_task = "GAP-030" if key[1] in {"HOME-006", "U01-START-001"} else "GAP-031"
        expected_stage = 2
        expected_previous, expected_result = "target_pending_implementation", "verified_local"
    elif key in expected_stage3:
        expected_task, expected_previous, expected_result = expected_stage3[key]
        expected_stage = 3
    else:
        errors.append(f"unrecognized implementation result: {key}")
        continue
    if key in expected_stage1:
        expected_previous, expected_result = "target_pending_implementation", "verified_local"
    if (result.get("canonical_task"), result.get("stage"), result.get("previousResult"), result.get("result")) != (expected_task, expected_stage, expected_previous, expected_result):
        errors.append(f"invalid stage {expected_stage} result: {key}")
    if not row or (row["canonical_task"], row["stage"], row["result"]) != (expected_task, str(expected_stage), expected_result):
        errors.append(f"stage {expected_stage} coverage result mismatch: {key}")
    if key in expected_stage2 and row and row["disposition"] != "accepted_target":
        errors.append(f"stage 2 non-target marked verified: {key}")
    evidence = ROOT / result["evidence"]
    if not evidence.is_file() or sha(evidence) != result["evidenceSha256"]:
        errors.append(f"implementation evidence missing or changed: {key}")
for row in coverage:
    key = (row["source"], row["source_id"], row["atom_id"])
    if row["canonical_task"] == "GAP-029" and row["stage"] == "1" and key not in overrides:
        errors.append(f"stage 1 result omitted from evidence overlay: {key}")
    if row["stage"] == "2" and row["source"].startswith("user-session-") and row["disposition"] == "accepted_target" and key not in expected_stage2:
        errors.append(f"new stage 2 target lacks acceptance review: {key}")
    if row["source_id"] == "HOME-003" and row["atom_id"] in {"main", "a01"} and row["result"] == "verified_local":
        errors.append(f"unreproduced Maps atom marked verified: {key}")
    if row["source"] == "expert-stage-08" and row["source_id"] == "GAP-015" and row["disposition"] != "superseded_target":
        errors.append("historical GAP-015 target was restored")
stage3_rows = {
    (row["source"], row["source_id"], row["atom_id"]): row["result"]
    for row in coverage if row["stage"] == "3"
}
expected_stage3_results = {key: detail[2] for key, detail in expected_stage3.items()} | expected_stage3_pending
if stage3_rows != expected_stage3_results:
    errors.append("stage 3 coverage results differ from the accepted 23-row reconciliation")

required_fields = {
    "source", "source_id", "primary_turn_id", "atom_id", "atom_label", "evidence_kind",
    "disposition", "decision_or_gate", "canonical_task", "stage",
    "acceptance", "result",
}
if not coverage or set(coverage[0]) != required_fields:
    errors.append("coverage schema mismatch")

keys = [(r["source"], r["source_id"], r["atom_id"]) for r in coverage]
if len(keys) != len(set(keys)):
    errors.append("duplicate coverage atom")

session_ids = {(r["source"], r["source_id"]) for r in coverage if r["source"] != "expert-stage-08"}
if session_ids != set(source_rows):
    errors.append(f"session coverage differs: missing={sorted(set(source_rows) - session_ids)} extra={sorted(session_ids - set(source_rows))}")

expert_ids = {r["source_id"] for r in coverage if r["source"] == "expert-stage-08"}
if expert_ids != set(UNIVERSE["expert_ids"]):
    errors.append(f"expert coverage differs: missing={sorted(set(UNIVERSE['expert_ids']) - expert_ids)}")
if sum(r["source"] == "expert-stage-08" for r in coverage) != 38:
    errors.append("expert task must have exactly one disposition row")

backlog_ids = set(re.findall(r"^### ((?:SEC|BUG|GAP|DATA|OPS|TECH)-\d{3})\b", BACKLOG, re.M))
at_ids = set(re.findall(r"^### (AT-[A-Z][A-Z0-9-]*)\b", ACCEPTANCE, re.M))
adr_ids = set(re.findall(r"^## (D\d+)\b", DECISIONS, re.M))
question_ids = set(re.findall(r"^## (Q-[A-Z]+-\d{3})\b", QUESTIONS, re.M))
dispositions = {
    "accepted_target", "needs_bounded_target", "decision_gate", "context_evidence",
    "hypothesis_reproduce", "superseded_target", "preserve_existing",
    "preserve_positive", "reconciled_target",
}
for row in coverage:
    ident = f"{row['source']}/{row['source_id']}/{row['atom_id']}"
    if any(not str(value).strip() for value in row.values()):
        errors.append(f"empty field: {ident}")
    if row["canonical_task"] not in backlog_ids:
        errors.append(f"undefined canonical task: {ident}")
    if row["disposition"] not in dispositions:
        errors.append(f"unknown disposition: {ident}")
    if row["decision_or_gate"].startswith("D") and row["decision_or_gate"] not in adr_ids:
        errors.append(f"undefined ADR: {ident}")
    if row["decision_or_gate"].startswith("Q-") and row["decision_or_gate"] not in question_ids:
        errors.append(f"undefined decision gate: {ident}")
    if row["decision_or_gate"] not in adr_ids | question_ids | {"reproduction_gate", "inventory_target_gate", "existing_ADR_and_AT"}:
        errors.append(f"invalid decision/gate: {ident}")
    if not row["stage"].isdigit() or not 0 <= int(row["stage"]) <= 14:
        errors.append(f"invalid stage: {ident}")
    if row["disposition"] == "decision_gate" and row["result"] not in {"pending_decision", "guest_identity_unresolved", "preset_ready_memory_unresolved", "timing_unresolved", "date_future_unresolved", "immutable_result_preserved"}:
        errors.append(f"decision gate silently closed: {ident}")
    for at in row["acceptance"].split(";"):
        if at not in at_ids | {"evidence_only"}:
            errors.append(f"undefined acceptance {at}: {ident}")
    if row["source"] != "expert-stage-08":
        if any(turn not in primary_turns.get(row["source"], set()) for turn in row["primary_turn_id"].split(";")):
            errors.append(f"primary turn missing: {ident}")
        original = source_rows.get((row["source"], row["source_id"]))
        if original:
            source_kind = original.get("evidence_type") or original.get("source_type")
            if row["evidence_kind"] != source_kind:
                errors.append(f"evidence kind drift: {ident}")
    elif row["primary_turn_id"] != "expert_package":
        errors.append(f"expert primary source mismatch: {ident}")

# Semantic checklist complements set equality: a composite row can be present
# while one of its independently requested ideas is omitted.
required_atoms = {
    "HOME-001": ["background visible refresh", "Retry remains"],
    "HOME-004": ["Only mine", "history fallback", "role-aware"],
    "HOME-005": ["View all", "top3", "empty state"],
    "U01-FORM-001": ["actual date and time", "match history search by participant surnames", "name creation timing"],
    "U01-FORM-003": ["11/21/custom", "numeric keyboard", "remembered custom"],
    "U01-FORM-007": ["hide game invite", "automatic judge ownership", "history of people leading"],
    "U01-DETAIL-004": ["ten second Undo", "archive"],
    "U01-DETAIL-002": ["all system status chips", "match detail applies shared status semantics"],
    "U01-JUDGE-003": ["service-wide icon consistency", "tap serve"],
    "U01-JUDGE-001": ["landscape white gutters", "dismissible rotation hint"],
    "U01-JUDGE-004": ["whole player card", "scroll guard", "start overlay"],
    "T01-03": ["default title", "future date"],
    "T02-04": ["single source of rules", "advantage rule"],
    "T02-10": ["one roster input", "guest fallback", "native confirm"],
    "T03-08": ["third-place match", "separate zoom and arrows", "scroll region"],
    "T03-09": ["potential edges", "next slots"],
    "T04-06": ["minimum unfinished stage", "parallel ready matches"],
    "T04-07": ["vertical drift", "fullscreen"],
    "T04-10": ["distinct metrics", "full stats"],
}
for source_id, phrases in required_atoms.items():
    labels = " ".join(row["atom_label"] for row in coverage if row["source_id"] == source_id and row["atom_id"] != "main").lower()
    for phrase in phrases:
        if phrase.lower() not in labels:
            errors.append(f"missing semantic atom {source_id}: {phrase}")

stage_for_expert = {row["source_id"]: int(row["stage"]) for row in coverage if row["source"] == "expert-stage-08"}
for source_id, stage in {"BUG-018": 3, "BUG-019": 3, "BUG-023": 3, "BUG-025": 3, "BUG-029": 4, "GAP-018": 0}.items():
    if stage_for_expert.get(source_id) != stage:
        errors.append(f"expert stage drift: {source_id}")

# GAP-019 is one canonical task with sequential stage-7 and stage-8 subscopes.
for row in coverage:
    if row["canonical_task"] == "GAP-019" and row["source"] != "expert-stage-08":
        expected = "8" if row["source_id"].startswith(("T03-", "T04-")) else "7"
        if row["stage"] != expected:
            errors.append(f"GAP-019 stage split drift: {row['source_id']}/{row['atom_id']}")
for source_id in ("U01-DETAIL-002", "U01-JUDGE-003"):
    if not any(row["source_id"] == source_id and row["canonical_task"] == "GAP-034" and row["stage"] == "3" and row["acceptance"] == "AT-UI-STATUS-001" for row in coverage):
        errors.append(f"cross-surface UI semantics missing: {source_id}")

print(json.dumps({
    "source_episodes": len(source_rows), "expert_ids": len(expert_ids),
    "coverage_rows": len(coverage), "dispositions": dict(Counter(r["disposition"] for r in coverage)),
    "errors": errors,
}, ensure_ascii=False, indent=2))
if errors:
    raise SystemExit(1)
