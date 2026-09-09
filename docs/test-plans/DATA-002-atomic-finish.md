# DATA-002 — atomic match completion test plan

## Scope and outcome

- Backlog: `DATA-002`.
- Requirements: `MATCH-010`, `MATCH-012`, `TOURNAMENT-013`, `TOURNAMENT-015`.
- Acceptance: `AT-MATCH-014`, `AT-TRN-018`.
- Outcome: confirmation or early stop commits the terminal match result, one-time
  user statistics, judge release, tournament bracket transition, newly
  materialized matches and notifications as one database transaction.
- Non-goals: result void/compensation (`DATA-005`), tournament void policy
  (`DATA-007` / `Q-MATCH-003`), legacy V1 DE support (`DATA-006`) and changes to
  stop/cancel actor policy (`BUG-002`).

## Invariants

1. A failed tournament advancement leaves match status/version/event log,
   statistics, judge session, bracket version/JSON, materialized matches and
   notifications unchanged.
2. A successful same-judge confirmation replay returns the finished match and
   does not apply statistics or advancement twice.
3. Match completion uses match status/version CAS; tournament advancement locks
   the tournament row and retains `bracket_state_version` CAS.
4. Statistics use SQL arithmetic upsert/update, not application read/modify/write.
5. The partial unique index on `(tournament_id, tournament_bracket_match_id)`
   remains the database backstop for one bracket node → one actual match.

## Red evidence

On the pre-change service, the focused PGlite fault-injection test returned HTTP
500 from an injected advancement failure but persisted `matches.status=finished`;
the expected `pending_confirmation` assertion failed 1/1. The first command was
also attempted with the shell's Node 20 and correctly rejected by the repository
Node 24 engine gate; the behavioral Red was then reproduced on bundled Node
24.19.0.

## Verification matrix

| Layer | Case | Gate |
|---|---|---|
| PGlite integration | injected failure after finish/stats/release entry rolls the entire operation back | required local |
| PGlite integration | same judge confirms twice; response stays successful and stats remain exactly once | required local |
| Existing integration | normal tournament advancement and manual stop remain green | required local |
| PostgreSQL 16 | same-match concurrent confirmation is idempotent; two semi-finals confirm concurrently with different judges, both succeed, final/bronze materialize once and stats are exact | required before `verified_local` |
| Repository | API typecheck, docs audit, diff check and full Node 24 `pnpm run ci` | required local |

Only `resolveTestDatabaseUrl`-guarded, loopback, explicitly test-named PostgreSQL
is permitted. Production `DATABASE_URL`, migrations, data, deploy and release are
out of scope. If no guarded PostgreSQL target is available, keep `DATA-002` as
`in_progress` and record the missing gate rather than substituting PGlite.
