# OPS-004 — Completion waves

Accepted 2026-09-13. Full PRD v2 remains the functional target (D26); retain D33 tournament void preserving downstream history. Onboarding finishes explicitly after returning from tutorial. Delivery uses direct main and native test-stand deployment under D32. No public mutating E2E, database reset, or valuable-production guarantees.

## Baseline and recovery

Remote main and public web/API readiness were observed at `ecf7605fe8d0e5857fb9bb0eebf5ef548c90226a`, version 1.10.1. Original dirty checkout: `/Users/liubavskii/Desktop/work/Codex/tab10`, b62afee. Original worktrees remain untouched. Integration checkout: `/private/tmp/tab10-completion-4F4jia/repo`; source snapshot and SHA-256 manifest: sibling `snapshot/`. Recovery means restoring only the affected task delta after checking for later edits; never reset/clean the original tree. No secret-bearing env files were copied.

## Ordered queue

| Wave | Canonical IDs | Acceptance and dependencies | State |
|---|---|---|---|
| A | Remaining SEC/DATA-001..006, BUG-001..016, GAP-001, OPS-001..005, TECH-001..004 | Preserve released fixes; integrate root-source delta, immutable migrations 0002/0003, exact-SHA quality/PostgreSQL/browser/public gates | in_progress |
| B | GAP-002, GAP-003, GAP-004 | Profile/privacy/sessions, dedicated filtered cursor history, team ranking/challenge. Reuse bc9c/e263/76bc worktrees selectively; profile service owns shared public-card DTO | pending A |
| C | GAP-005, DATA-007 | 1v1/2v2/rules/serve/revenge/log/no-show/handover/correction; reuse 82fe. Preserve D33; two-client acceptance | pending B |
| D | GAP-007 then GAP-006 | Team captain/invite/leave/transfer/archive, then complete SE/DE 3/5/8-player lifecycle and placements with PostgreSQL races | pending C |
| E | GAP-008, GAP-009, GAP-010 | Notification event matrix/popups, explicit onboarding/help/feedback, full admin role/state/audit matrix | pending D |
| F | GAP-011, TECH-002 | Full REQ/AT reconciliation, desktop/390/360/landscape, keyboard/axe/focus, empty/loading/error/readonly/stale-session, compiled browser critical journeys | pending E |

Every wave is divided into bounded tasks within its canonical IDs. An implementation report does not close a task. Capture deterministic Red, apply the smallest correction, run focused checks, independent review when available, then integration checks, canonical docs and release evidence. New discoveries receive a fresh canonical ID only when independently actionable. Recheck debt before work; propose a bounded debt sprint after each released stage without silently expanding scope.

## Ownership and handoff

Parent owns API services/schema/migrations/shared contracts, lockfile/CI, integration, release and final acceptance. Bounded web and route writers have exclusive assigned files until they return; no overlapping writers. Shared routes, migrations and journals are serialized. Separate persistent chats may carry a bounded backlog task and exact baseline; canonical documents remain the queue of record.

## Release gate

Exact Node 24.20.0, pnpm 9.15.0, disposable PostgreSQL 16, compiled browser suite. Run `pnpm run verify:all`, `pnpm run audit:docs`, and `git diff --check`; no failed/skipped/todo required suites. Review staged thematic changes before commit/push. After push, inspect hosted CI and `pnpm smoke:public` for matching web/API/proxy SHA/version. Failed release stops the next wave and is repaired forward; no automatic down migration. Versions follow VERSIONING. Preserve readonly public-test boundary.

## Current evidence

- Frozen install completed on Node 24.20.0.
- GAP-001 Red: both home acceptance tests failed against main before route integration (missing dashboard response fields).
- Migration extension exposed missing intermediate snapshot/check/index normalization; fixing under DATA-003 with regression coverage.
- Web integration reported 125 component tests and typecheck passed; parent browser/integration acceptance remains pending.
- No commit, push or deployment has occurred in this execution stage.

### Integration findings

- DATA-004 review: migration 0002 now rejects duplicate active participants in a tournament with bracket/progress before any reconciliation; no implicit bracket repair. Deterministic Red reproduced unsafe success; PGlite migration suite20 passes after guard. Matching PostgreSQL regression awaits required lane.
- TECH-001: reusing a verification evidence directory exposed stale cleanup ready markers. Harness now removes only its previous marker before launching each child; four real Docker cleanup modes are rechecked in the aggregate gate.
- API full suite201 passed; route-focused38 passed. OPS safety7 passed. Compiled browser and PostgreSQL remain pending.

- Read-only Neon preflight 2026-09-13: target project shiny-leaf-88815850 / br-calm-scene-asc4ye20 / neondb has 2 ledger rows and 0 duplicate active participant pairs in bracket/progress tournaments. This is a point-in-time preflight, not a migration execution.

- Candidate version 1.11.0 follows VERSIONING (new capabilities inside existing flows). Full fast lane903 and PostgreSQL lane40 passed before version metadata update; final aggregate rerun is in progress. Browser first attempt was blocked by macOS sandbox MachPort permissions, so the local-only gate is rerun with escalation.

### Wave B integration contract

Rechecked source worktrees against candidate 1.11.0. Integrate profile first,
history independently, team ranking against the resulting profile contract.
Profile owns nested `{profile:{identity,avatar,stats,facts,teams,isOwn,canChallenge}}`
at `/players/:userId`; discard the old ranking branch's flat player-card endpoint.
Keep D10 avatar read-only and public email/birthDate absent. Validate UUID params.
Do not replace shared app/api/OpenAPI/CSS files wholesale: preserve release metadata,
D33, auth generation and Wave A fixes. Shared ranking helpers already match.

Required source corrections: history day filters must use Europe/Moscow independent
of client timezone; profile timestamps also use Moscow; ranking sends canonical
`all_time|calendar_week|calendar_month`. Cover stale filter responses, recovery without
mutation replay, history detail/back context, blocked/own public profile, session
revoke failures, team non-membership and empty states before closure. History raw
keyset query requires disposable PostgreSQL evidence as well as PGlite.

### Wave A final gate retry

Candidate 1.11.0 passed quality906, PostgreSQL40 and all6 browser journeys.
The aggregate command then failed because the reused sanitized-trace output
already existed; this is not recorded as an aggregate pass. A fresh run uses
sibling `evidence-a-final/`. Three web race fixes passed independent review and
23 focused tests. No release has occurred yet.

### Accepted local candidate

Final `evidence-a-release/` aggregate passed965/965 with zero failures/skips/todo.
Includes the rendered stale-alert correction, independently reviewed with6/6
focused tests. Mobile screenshot confirms restored draft without unauthorized
alert. Local Wave A IDs are `verified_local`; public release remains pending.
See [redacted evidence](../audit/evidence/wave-a-local.json).
