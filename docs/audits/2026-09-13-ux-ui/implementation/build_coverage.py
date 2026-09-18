#!/usr/bin/env python3
"""Build the stage-0 trace table from frozen session copies and explicit routing."""

from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
UNIVERSE = json.loads((HERE / "source-universe.json").read_text())
FIELDNAMES = [
    "source", "source_id", "primary_turn_id", "atom_id", "atom_label", "evidence_kind",
    "disposition", "decision_or_gate", "canonical_task", "stage",
    "acceptance", "result",
]

# Every source ID must be routed explicitly. This mapping is a decision overlay,
# not a measurement of task success or a copy of old expert readiness.
route: dict[str, tuple[str, int, str, str, str, str]] = {}


def assign(ids: str, task: str, stage: int, acceptance: str, decision: str,
           disposition: str = "accepted_target", result: str = "target_pending_implementation") -> None:
    for source_id in ids.split():
        if source_id in route:
            raise ValueError(f"duplicate routing: {source_id}")
        route[source_id] = (task, stage, acceptance, decision, disposition, result)


assign("SETUP-001 U01-EV-001 U01-EV-002 U01-EV-003 U01-EV-004 U01-EV-005 U01-EV-006 U01-CLAR-001 SESSION-STOP T05-01", "TECH-008", 0, "evidence_only", "D36", "context_evidence", "no_implementation_task")
assign("AUTH-001 AUTH-002 AUTH-004", "BUG-028", 3, "AT-AUTH-009", "D36")
assign("AUTH-003 U01-JUDGE-001", "BUG-040", 3, "AT-HOME-003", "reproduction_gate", "hypothesis_reproduce", "physical_device_pending")
assign("HOME-001", "GAP-031", 2, "AT-LIVE-002", "D36")
assign("HOME-002 HOME-004 HOME-005 HOME-007", "GAP-031", 2, "AT-HOME-003", "D36")
assign("HOME-003", "GAP-031", 2, "AT-HOME-003", "reproduction_gate", "hypothesis_reproduce", "app_cause_unproven")
assign("HOME-006 U01-START-001", "GAP-030", 2, "AT-HOME-003", "D36")
assign("U01-FORM-001", "GAP-013", 5, "AT-MATCH-017", "Q-UX-006", "decision_gate", "timing_unresolved")
assign("U01-FORM-002 U01-FORM-004 U01-FORM-005 U01-FORM-006", "GAP-013", 5, "AT-MATCH-017", "D35")
assign("U01-FORM-003", "GAP-013", 5, "AT-MATCH-016", "Q-UX-005", "decision_gate", "preset_ready_memory_unresolved")
assign("U01-FORM-007", "GAP-029", 1, "AT-UI-INV-001", "D37")
assign("U01-FORM-008", "GAP-013", 5, "AT-MATCH-013", "Q-UX-004", "decision_gate", "guest_identity_unresolved")
assign("U01-DETAIL-001 U01-DETAIL-002 U01-DETAIL-003", "GAP-017", 6, "AT-HOME-003", "D36")
assign("U01-DETAIL-004", "GAP-032", 6, "AT-MATCH-VOID-003", "Q-UX-008", "decision_gate", "immutable_result_preserved")
assign("U01-JUDGE-002 U01-JUDGE-003 U01-JUDGE-004 U01-JUDGE-005 U01-JUDGE-006", "GAP-032", 6, "AT-JUDGE-007", "D24", "needs_bounded_target", "concept_not_verified")
assign("T01-01 T01-07", "GAP-019", 7, "AT-TRN-024", "D36")
assign("T01-02 T01-04 T01-05", "GAP-019", 7, "AT-TRN-024", "D36", "needs_bounded_target", "copy_and_order_pending")
assign("T01-03", "GAP-019", 7, "AT-TRN-024", "Q-UX-010", "decision_gate", "date_future_unresolved")
assign("T01-06 T05-02", "GAP-029", 1, "AT-UI-INV-001", "D37")
assign("T02-01 T02-02 T02-03 T02-04 T02-05", "GAP-019", 7, "AT-TRN-024", "D36")
assign("T02-06 T02-07 T02-08 T02-10", "GAP-021", 7, "AT-TRN-022", "D35")
assign("T02-09 T02-11", "BUG-033", 8, "AT-TRN-013", "D36")
assign("T03-01 T03-02", "GAP-020", 8, "AT-TRN-010", "D36", "preserve_positive", "explanation_retained")
assign("T03-03 T03-04 T03-05 T03-10", "GAP-019", 8, "AT-TRN-024", "D36")
assign("T03-06 T03-07 T03-08 T03-09 T03-11", "GAP-020", 8, "AT-TRN-010", "D36", "needs_bounded_target", "geometry_requires_browser")
assign("T04-01 T04-02 T04-03", "GAP-019", 8, "AT-TRN-024", "D36")
assign("T04-04 T04-05 T04-06 T04-07 T04-11 T04-12", "GAP-020", 8, "AT-TRN-010", "D36", "needs_bounded_target", "geometry_requires_browser")
assign("T04-08 T04-09 T04-10", "BUG-033", 8, "AT-TRN-013", "D36")

# Atoms below make composite feedback independently traceable. The full reports,
# not this short label, remain the source for exact phrasing and limitations.
atoms: dict[str, list[tuple[str, str, int, str, str, str]]] = {
    "AUTH-001": [("input and action widths", "BUG-028", 3, "D36", "AT-AUTH-009", "accepted_target"), ("touch heights", "BUG-028", 3, "D36", "AT-AUTH-009", "accepted_target")],
    "AUTH-002": [("password reveal inside field", "BUG-028", 3, "D36", "AT-AUTH-009", "accepted_target")],
    "AUTH-003": [("zoom persists after keyboard dismiss", "BUG-040", 3, "reproduction_gate", "AT-HOME-003", "hypothesis_reproduce")],
    "AUTH-004": [("single visible focus boundary without removing keyboard indicator", "BUG-020", 3, "D36", "AT-AUTH-009", "accepted_target")],
    "HOME-001": [("background visible refresh instead of persistent manual Refresh", "GAP-031", 2, "D36", "AT-LIVE-002", "accepted_target"), ("explicit Retry remains after failure", "GAP-031", 2, "D36", "AT-LIVE-002", "accepted_target")],
    "HOME-002": [("compact avatar/name/surname/rank/matches/wins/losses", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target"), ("secondary stats move to profile", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target"), ("persistent greeting and rival callout removed from Home hierarchy", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target")],
    "HOME-003": [("Maps destination requires reproduction; app cause unknown", "GAP-031", 2, "reproduction_gate", "AT-HOME-003", "hypothesis_reproduce")],
    "HOME-004": [("role-aware active events", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target"), ("history fallback when no active event", "GAP-031", 2, "D36", "AT-HOME-002", "accepted_target"), ("Only mine means player events, not all judged events", "GAP-031", 2, "D36", "AT-HOME-003", "needs_bounded_target")],
    "HOME-005": [("empty state for every dashboard block", "GAP-031", 2, "D36", "AT-HOME-002", "accepted_target"), ("View all opens full history", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target"), ("ranking top3 follows current tasks and history", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target")],
    "HOME-006": [("no bottom tabs or universal menu", "GAP-030", 2, "D36", "AT-HOME-003", "accepted_target"), ("profile and notifications still discoverable", "GAP-030", 2, "D36", "AT-HOME-003", "accepted_target")],
    "HOME-007": [("match cards keep players score duration winner", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target"), ("secondary details remain accessible", "GAP-031", 2, "D36", "AT-HOME-003", "accepted_target"), ("winner distinguishable by icon or name state", "GAP-031", 2, "D36", "AT-HOME-003", "needs_bounded_target")],
    "U01-FORM-001": [("automatic match name", "GAP-013", 5, "D35", "AT-MATCH-015", "accepted_target"), ("name creation timing", "GAP-013", 5, "Q-UX-006", "AT-MATCH-015", "decision_gate"), ("actual date and time, not fabricated future schedule", "GAP-013", 5, "D20", "AT-MATCH-015", "preserve_existing"), ("match history search by participant surnames", "GAP-024", 10, "D36", "AT-VIS-003", "accepted_target")],
    "U01-FORM-002": [("1v1 and 2v2", "GAP-013", 5, "D35", "AT-MATCH-016", "preserve_existing"), ("creator playing is secondary and not default", "GAP-013", 5, "D35", "AT-MATCH-017", "accepted_target")],
    "U01-FORM-003": [("11/21/custom presets", "GAP-013", 5, "D35", "AT-MATCH-016", "accepted_target"), ("numeric keyboard and reachable sheet", "GAP-013", 5, "D36", "AT-MATCH-016", "accepted_target"), ("remembered custom value", "GAP-013", 5, "Q-UX-005", "AT-MATCH-016", "decision_gate"), ("plus/minus controls", "GAP-013", 5, "D36", "AT-MATCH-016", "needs_bounded_target")],
    "U01-FORM-004": [("mercy threshold in same row", "GAP-013", 5, "D8", "AT-MATCH-016", "accepted_target"), ("formula rounding and range preserve D8", "GAP-013", 5, "D8", "AT-MATCH-016", "needs_bounded_target")],
    "U01-FORM-005": [("serve selection in judge context", "GAP-013", 5, "D35", "AT-MATCH-017", "needs_bounded_target"), ("coin flip and alert removal", "GAP-013", 5, "D35", "AT-MATCH-017", "needs_bounded_target")],
    "U01-FORM-006": [("frequent/recent opponent contextual only", "GAP-013", 5, "D35", "AT-MATCH-016", "accepted_target"), ("direct other-player selection", "GAP-013", 5, "D35", "AT-MATCH-017", "accepted_target")],
    "U01-FORM-007": [("hide game invite and optional judge invitation UI", "GAP-029", 1, "D37", "AT-UI-INV-001", "accepted_target"), ("automatic judge ownership requires separate decision", "GAP-032", 6, "Q-UX-006", "AT-JUDGE-001", "decision_gate"), ("history of people leading on shared phone", "GAP-032", 6, "Q-UX-009", "AT-JUDGE-002", "decision_gate")],
    "U01-FORM-008": [("reusable guest identity", "GAP-013", 5, "Q-UX-004", "AT-MATCH-013", "decision_gate"), ("future account link collision/history/privacy", "GAP-013", 5, "Q-UX-004", "AT-MATCH-013", "decision_gate")],
    "U01-DETAIL-001": [("create to judge without redundant step", "GAP-017", 6, "Q-UX-006", "AT-HOME-003", "decision_gate"), ("prestart player side serve rules edits and partial errors", "GAP-017", 6, "D35", "AT-MATCH-017", "needs_bounded_target"), ("suggested 1v1 11-point mercy-at-5 manual-server defaults need contract review", "GAP-013", 5, "D8", "AT-MATCH-016", "needs_bounded_target")],
    "U01-DETAIL-002": [("all system status chips read as information, not false buttons; icon or text communicates meaning", "GAP-034", 3, "inventory_target_gate", "AT-UI-STATUS-001", "needs_bounded_target"), ("side and score association; first actual server", "GAP-017", 6, "D36", "AT-MATCH-003", "needs_bounded_target"), ("match detail applies shared status semantics after stage 3 target", "GAP-017", 6, "inventory_target_gate", "AT-UI-STATUS-001", "needs_bounded_target")],
    "U01-DETAIL-003": [("primary next action and secondary controls", "GAP-017", 6, "D36", "AT-HOME-003", "accepted_target"), ("same roster/rules next match and replay", "GAP-032", 6, "Q-UX-007", "AT-MATCH-VOID-003", "decision_gate")],
    "U01-DETAIL-004": [("ten second Undo", "GAP-032", 6, "Q-UX-008", "AT-MATCH-VOID-003", "decision_gate"), ("archive versus immutable void", "GAP-032", 6, "Q-UX-008", "AT-MATCH-VOID-004", "decision_gate")],
    "U01-JUDGE-001": [("landscape white gutters", "BUG-040", 6, "reproduction_gate", "AT-HOME-003", "hypothesis_reproduce"), ("portrait rotation hint and animation", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("dismissible rotation hint", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target")],
    "U01-JUDGE-002": [("context prompt and timer", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("scroll text blink and persistent instruction placement", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("reduced motion", "GAP-032", 6, "D36", "AT-JUDGE-007", "accepted_target")],
    "U01-JUDGE-003": [("tap serve and icon", "GAP-032", 6, "D36", "AT-MATCH-003", "needs_bounded_target"), ("small center swap and keyboard alternative to drag", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("service-wide icon consistency inventory and semantic target", "GAP-034", 3, "inventory_target_gate", "AT-UI-STATUS-001", "needs_bounded_target")],
    "U01-JUDGE-004": [("whole player card scoring with scroll guard", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("start overlay no geometry shift", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("fast motion without bounce and visual separation", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target")],
    "U01-JUDGE-005": [("blurred confirmation with explicit accept/continue", "GAP-032", 6, "D24", "AT-MATCH-008", "needs_bounded_target"), ("stable cards and prestart rules drawer", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target"), ("active contextual menu", "GAP-032", 6, "D36", "AT-JUDGE-007", "needs_bounded_target")],
    "U01-JUDGE-006": [("timeline authoritative time/side/+1", "GAP-032", 6, "D24", "AT-JUDGE-007", "needs_bounded_target"), ("correction and Undo semantics", "GAP-032", 6, "D24", "AT-MATCH-005", "needs_bounded_target"), ("avoid unexplained long dash in log copy", "GAP-032", 6, "D36", "AT-JUDGE-007", "accepted_target")],
    "T01-03": [("positive default title", "GAP-019", 7, "D36", "AT-TRN-021", "preserve_positive"), ("future date scheduling", "GAP-019", 7, "Q-UX-010", "AT-TRN-024", "decision_gate")],
    "T01-04": [("enable losers bracket instead of Single/Double", "GAP-019", 7, "D36", "AT-TRN-024", "accepted_target")],
    "T01-05": [("organizer self-participation remains optional", "GAP-019", 7, "D35", "AT-TRN-003", "preserve_existing")],
    "T01-06": [("hide consent setting and policy copy", "GAP-029", 1, "D37", "AT-UI-INV-001", "accepted_target"), ("direct roster default false consent", "GAP-029", 1, "D37", "AT-TRN-022", "accepted_target")],
    "T01-07": [("rules on first authoritative step", "GAP-019", 7, "D36", "AT-TRN-024", "needs_bounded_target"), ("visible progress toward bracket", "GAP-019", 7, "D36", "AT-TRN-024", "accepted_target")],
    "T02-04": [("single source of rules; later read-only summary", "GAP-019", 7, "D36", "AT-TRN-024", "accepted_target"), ("prestart return to edit; no duplicate refresh", "GAP-019", 7, "D35", "AT-TRN-024", "needs_bounded_target"), ("advantage rule in player language", "GAP-019", 7, "D36", "AT-TRN-024", "needs_bounded_target")],
    "T02-10": [("one roster input and ordered list", "GAP-019", 7, "D36", "AT-TRN-024", "needs_bounded_target"), ("guest fallback cannot silently create on typo", "GAP-019", 7, "Q-UX-004", "AT-TRN-024", "decision_gate"), ("remove ordinary native confirm; preserve required warning", "GAP-021", 7, "D35", "AT-TRN-022", "accepted_target"), ("compact removal with keyboard label", "GAP-019", 7, "D36", "AT-TRN-024", "needs_bounded_target")],
    "T02-11": [("hide zero result before play", "BUG-033", 8, "D36", "AT-TRN-013", "accepted_target"), ("top3 primary; full summary secondary", "BUG-033", 8, "D36", "AT-TRN-013", "accepted_target")],
    "T03-02": [("compact/classic explanation positive", "GAP-020", 8, "D36", "AT-TRN-010", "preserve_positive"), ("context icon refinement", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target")],
    "T03-06": [("zoom below 100 percent or full overview without illegible text", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target")],
    "T03-07": [("connector render source hypothesis; target potential edges", "GAP-020", 8, "reproduction_gate", "AT-TRN-010", "hypothesis_reproduce")],
    "T03-04": [("bracket first", "GAP-019", 8, "D36", "AT-TRN-024", "accepted_target"), ("compact read-only summary and no roster duplication", "GAP-019", 8, "D36", "AT-TRN-024", "accepted_target")],
    "T03-09": [("potential edges to exact next slots before known winner", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target")],
    "T03-08": [("third-place match remains accessible", "GAP-033", 8, "D36", "AT-TRN-010", "preserve_existing"), ("remove redundant separate zoom and arrows for one third-place match; preserve global bracket overview", "GAP-033", 8, "D36", "AT-TRN-010", "needs_bounded_target"), ("clipped neighboring scroll region requires rendered review", "GAP-033", 8, "reproduction_gate", "AT-TRN-010", "hypothesis_reproduce")],
    "T03-10": [("seed/swap/late add/method change preserved in context", "GAP-019", 8, "D35", "AT-TRN-006", "preserve_existing"), ("cancel/dissolve/back have explicit consequences", "BUG-032", 8, "D35", "AT-TRN-007", "accepted_target"), ("cancel confirmation sheet is a presentation proposal, safeguard required", "BUG-032", 8, "D35", "AT-TRN-014", "needs_bounded_target"), ("third-place match remains reachable; redundant local controls can be removed", "GAP-033", 8, "D36", "AT-TRN-010", "needs_bounded_target"), ("use nonblocking snackbar or no redundant success alert; keep errors visible", "GAP-019", 8, "D36", "AT-TRN-024", "needs_bounded_target")],
    "T03-11": [("scroll overlap is hypothesis, reproduce first", "GAP-020", 8, "reproduction_gate", "AT-TRN-010", "hypothesis_reproduce")],
    "T04-02": [("bracket to match is positive and returns to same bracket", "GAP-030", 8, "D36", "AT-HOME-003", "preserve_positive")],
    "T04-05": [("clear outcome icon and stable score", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target"), ("winner path to next exact slot", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target")],
    "T04-06": [("viewport closest ready in minimum unfinished stage", "GAP-020", 8, "D36", "AT-TRN-009", "needs_bounded_target"), ("does not prohibit parallel ready matches or steal keyboard focus", "GAP-020", 8, "D36", "AT-TRN-009", "preserve_existing")],
    "T04-07": [("late vertical drift and alignment", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target"), ("fullscreen bracket view", "GAP-020", 8, "D36", "AT-TRN-010", "needs_bounded_target")],
    "T04-08": [("finished champion positive; stopped tournament has no champion", "BUG-033", 8, "D36", "AT-TRN-012", "accepted_target")],
    "T04-09": [("21/11/27 are distinct game-point sums, not ranking proof", "BUG-033", 8, "D36", "AT-TRN-013", "preserve_existing")],
    "T04-10": [("placement and point sum are distinct metrics", "BUG-033", 8, "D36", "AT-TRN-013", "accepted_target"), ("full stats remain secondary", "BUG-033", 8, "D36", "AT-TRN-013", "accepted_target")],
    "T05-02": [("invitation response scenario untested", "TECH-008", 0, "D37", "evidence_only", "context_evidence")],
}


def main() -> None:
    rows = []
    for source_name, ids in UNIVERSE["episodes"].items():
        source_dir = HERE / "sessions" / source_name.removeprefix("user-session-")
        primary_filename = "match-primary-messages.json" if "table" in source_name else "tournament-primary-messages.json"
        primary = json.loads((HERE / "sources" / primary_filename).read_text())["messages"]
        def primary_turn(source_id: str) -> str:
            if "table" in source_name:
                index = 0 if source_id == "SESSION-STOP" else 1 if source_id == "U01-CLAR-001" else 2 if source_id.startswith("U01-EV-") else 3 if source_id.startswith(("U01-DETAIL-", "U01-JUDGE-")) else 4 if source_id.startswith(("U01-START-", "U01-FORM-")) else 5 if source_id.startswith("HOME-") else 7 if source_id.startswith("AUTH-") else 8
            else:
                index = 0 if source_id.startswith("T05-") else 1 if source_id.startswith("T04-") else 2 if source_id.startswith("T03-") else 3 if source_id.startswith("T02-") else 4
            if "table" in source_name and source_id == "AUTH-003":
                return primary[7]["turnId"] + ";" + primary[6]["turnId"]
            return primary[index]["turnId"]
        with (source_dir / "observations.csv").open(newline="") as file:
            source_rows = list(csv.DictReader(file))
        assert [row["episode_id"] for row in source_rows] == ids
        for source_row in source_rows:
            source_id = source_row["episode_id"]
            task, stage, acceptance, decision, disposition, result = route[source_id]
            label = source_row.get("participant_statement") or source_row.get("observation") or source_row.get("finding") or source_id
            if label.strip().lower() in {"none", "n/a", "—"}:
                label = source_row.get("observed_action") or source_row.get("interpretation") or source_id
            label = re.sub(r"\s+", " ", label).strip()
            evidence_kind = source_row.get("evidence_type") or source_row.get("source_type") or "source_unspecified"
            turn_id = primary_turn(source_id)
            rows.append([source_name, source_id, turn_id, "main", label, evidence_kind, disposition, decision, task, stage, acceptance, result])
            for index, (atom_label, atom_task, atom_stage, atom_decision, atom_at, atom_disposition) in enumerate(atoms.get(source_id, []), 1):
                rows.append([source_name, source_id, turn_id, f"a{index:02d}", atom_label, evidence_kind,
                             atom_disposition, atom_decision, atom_task, atom_stage, atom_at,
                             "pending_decision" if atom_disposition == "decision_gate" else
                             "reproduce_before_acceptance" if atom_disposition == "hypothesis_reproduce" else
                             "preserve_behavior" if atom_disposition in ("preserve_existing", "preserve_positive") else
                             "target_pending_implementation"])

    backlog = (ROOT / "docs/BACKLOG.md").read_text()
    heading_matches = list(re.finditer(r"^### ((?:BUG|GAP|TECH)-\d{3}) — ([^\n]+)", backlog, re.M))
    headings = {match.group(1): match.group(2) for match in heading_matches}
    sections = {match.group(1): backlog[match.start(): heading_matches[i + 1].start() if i + 1 < len(heading_matches) else len(backlog)] for i, match in enumerate(heading_matches)}
    known_at = set(re.findall(r"^### (AT-[A-Z][A-Z0-9-]*)\b", (ROOT / "docs/requirements/11_ACCEPTANCE_TEST_CATALOG.md").read_text(), re.M))
    expert_stage = {
        0: "GAP-018",
        2: "GAP-015",
        3: "BUG-018 BUG-019 BUG-020 BUG-021 BUG-022 BUG-023 BUG-024 BUG-025 BUG-026 BUG-027 BUG-028",
        4: "BUG-029 BUG-031 BUG-039",
        5: "GAP-013",
        6: "GAP-017 BUG-030 GAP-023",
        7: "GAP-019 GAP-021",
        8: "BUG-032 BUG-033 GAP-020",
        9: "GAP-022 BUG-034 BUG-035 GAP-025",
        10: "GAP-024 BUG-036 BUG-037",
        11: "GAP-026 GAP-027 GAP-028",
        12: "BUG-038",
        13: "GAP-014 GAP-016",
    }
    stage_for = {id_: stage for stage, ids in expert_stage.items() for id_ in ids.split()}
    assert set(stage_for) == set(UNIVERSE["expert_ids"])
    for source_id in UNIVERSE["expert_ids"]:
        disposition = "superseded_target" if source_id in {
            "BUG-019", "GAP-013", "GAP-015", "GAP-017", "GAP-018", "BUG-033", "GAP-019", "BUG-037"
        } else "decision_gate" if source_id in {"BUG-022", "GAP-025", "GAP-028"} else "reconciled_target"
        decision = "Q-UX-011" if source_id == "GAP-018" else "D37" if source_id == "BUG-037" else "D36" if disposition == "superseded_target" else "existing_ADR_and_AT"
        acceptance = [at for at in dict.fromkeys(re.findall(r"\bAT-[A-Z][A-Z0-9-]*\b", sections[source_id])) if at in known_at]
        acceptance_fallback = {"BUG-020": "AT-AUTH-009", "BUG-023": "AT-MATCH-016", "GAP-018": "AT-UI-INV-001"}
        if not acceptance and source_id in acceptance_fallback:
            acceptance = [acceptance_fallback[source_id]]
        if not acceptance:
            raise ValueError(f"expert task lacks AT reference: {source_id}")
        rows.append(["expert-stage-08", source_id, "expert_package", "main", headings[source_id], "expert_review",
                     disposition, decision, source_id, stage_for[source_id], ";".join(acceptance[:8]),
                     "pending_decision" if disposition == "decision_gate" else "historical_target_reconciled_not_implemented"])

    # Implementation outcomes are a separate, evidence-bound overlay. Keep the
    # frozen source routing and dispositions unchanged when regenerating CSV.
    outcomes = json.loads((HERE / "implementation-results.json").read_text())
    if outcomes.get("schemaVersion") != 1:
        raise ValueError("implementation result schema mismatch")
    by_key = {}
    for outcome in outcomes["results"]:
        key = (outcome["source"], outcome["source_id"], outcome["atom_id"])
        if key in by_key or outcome["result"] != "verified_local":
            raise ValueError(f"invalid or duplicate implementation outcome: {key}")
        evidence = ROOT / outcome["evidence"]
        if not evidence.is_file() or hashlib.sha256(evidence.read_bytes()).hexdigest() != outcome["evidenceSha256"]:
            raise ValueError(f"implementation evidence missing or changed: {key}")
        by_key[key] = outcome
    applied = set()
    for row in rows:
        key = (row[0], row[1], row[3])
        outcome = by_key.get(key)
        if outcome is None:
            continue
        if (row[8], row[9], row[11]) != (outcome["canonical_task"], outcome["stage"], outcome["previousResult"]):
            raise ValueError(f"implementation outcome drift: {key}")
        row[11] = outcome["result"]
        applied.add(key)
    if applied != set(by_key):
        raise ValueError(f"implementation outcomes not found: {set(by_key) - applied}")

    with (HERE / "coverage.csv").open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(FIELDNAMES)
        writer.writerows(rows)
    print(f"coverage rows={len(rows)} session_ids={sum(len(v) for v in UNIVERSE['episodes'].values())} expert_ids={len(UNIVERSE['expert_ids'])}")


if __name__ == "__main__":
    main()
