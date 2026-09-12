# BUG-016 — Moscow default event titles

## Scope

- Backlog: BUG-016.
- Decision and requirements: D20, MATCH-001, TOURNAMENT-001, AT-MATCH-015,
  AT-TRN-021.
- Outcome: match and tournament forms derive editable default titles from the
  `Europe/Moscow` calendar independently of client timezone.
- Non-goals: other timestamps, API/UTC storage changes, redesign or deploy.

## Evidence

- Deterministic Red: the fixed instant `2026-01-15T21:05:00.000Z` differed in
  UTC, America/Los_Angeles and Asia/Tokyo before an explicit timezone.
- Agent Green: 6/6 formatter checks across those zones, focused web 15/15, full
  web 121/121, API create 2/2, typechecks/build and scoped desktop/mobile
  Browser checks.
- Root integration: rerun formatter table, full web regression and combined CI.
- Production/external services are out of scope without release approval.
