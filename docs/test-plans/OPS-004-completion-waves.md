# OPS-004 — Completion waves

Accepted 2026-09-13. Full PRD v2 remains the functional target (D26); retain D33 tournament void preserving downstream history. Onboarding finishes explicitly after returning from tutorial. Delivery uses direct main and native test-stand deployment under D32. No public mutating E2E, database reset, or valuable-production guarantees.

## Baseline and recovery

Remote main and public web/API readiness were observed at `ecf7605fe8d0e5857fb9bb0eebf5ef548c90226a`, version 1.10.1. Original dirty checkout: `/Users/liubavskii/Desktop/work/Codex/tab10`, b62afee. Original worktrees remain untouched. Integration checkout: `/private/tmp/tab10-completion-4F4jia/repo`; source snapshot and SHA-256 manifest: sibling `snapshot/`. Recovery means restoring only the affected task delta after checking for later edits; never reset/clean the original tree. No secret-bearing env files were copied.

## Ordered queue

| Wave | Canonical IDs | Acceptance and dependencies | State |
|---|---|---|---|
| A | Remaining SEC/DATA-001..006, BUG-001..016, GAP-001, OPS-001..005, TECH-001..004 | Preserve released fixes; integrate root-source delta, immutable migrations 0002/0003, exact-SHA quality/PostgreSQL/browser/public gates | released 1.11.0 |
| B | GAP-002, GAP-003, GAP-004 | Profile/privacy/sessions, dedicated filtered cursor history, team ranking/challenge. Reuse bc9c/e263/76bc worktrees selectively; profile service owns shared public-card DTO | released 2.0.0 |
| C | GAP-005, DATA-007 | 1v1/2v2/rules/serve/revenge/log/no-show/handover/correction; reuse 82fe. Preserve D33; two-client acceptance | verified_local 2.1.0 |
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

### Wave A released / Wave B started

Direct main commit `b193e9de7f6448a722ae061cb106825fe273d352` published 1.11.0.
GitHub run34726774716: all4 jobs success. GET-only smoke: web/API/proxy exact
SHA/version matched after7 attempts (84895ms). No public mutating E2E/reset.
Forward migrations run through native startup. This closes the Wave A release
barrier; functional evidence remains locally tested plus released exact SHA.

Wave B frozen parent baseline: b193e9d, snapshot-b-parent outside Git. Parent owns
API services/app/auth/match changes; web worker owns api/App/styles/profile/history/
ranking pages and tests; route worker owns API tests/OpenAPI. Initial Red12/12
missing contract tests; parent integration Green12/12 on PGlite. Real-PG history
query and additional validation tests pending. Rechecked debt: prioritize the
bounded source timezone, history context, and raw PostgreSQL-result corrections
inside these IDs before considering unrelated bundle-size work.

### Wave B integration review

API review corrected withdrawn tournament counts, doubles opponent search and
strict cursor UUID validation. Full API suite passed 220/220; real PostgreSQL
history tests passed 2/2, including raw query rows, dates and cursor boundaries.
Web review corrected cross-account retained state, stale profile errors and own
card routing. Full web suite passed 148/148. Independent reviews were performed
by the opposite bounded implementation worker; a separate Terra reviewer was
unavailable in this runtime. Parent retains final acceptance.

TECH-002 harness regression: the build inherited NODE_ENV=test despite the
production preview. A deterministic script test failed before the fix and all
17 script tests passed after buildEnvironment explicitly set production. The
compiled bundle now contains production React and no development React/jsxDEV.
Earlier Wave A browser evidence remains historical compiled-flow evidence; it
does not establish this corrected build-mode parity.

Compiled Wave B browser acceptance and final aggregate remain pending. Initial
new-journey failures were traced to fixture period selection and accessible-name
selectors, corrected without changing product behavior.

### Wave B accepted locally

Candidate 2.0.0: aggregate 1010/1010 (quality 945, PostgreSQL 42, browser 19,
cleanup 4), zero failed/skipped/todo/interrupted. Rendered review strengthened the
public-card check to wait for actual stats/challenge before privacy assertions;
that browser lane was rerun and passed 19/19. Desktop and 390px profile, ranking,
public card and history return screenshots reviewed. Original 186 files unchanged.
GAP-002/003/004 are verified_local. Public release remains pending.

### Wave B released / Wave C started

Main 8f36941b283a678105558656b1fb3b343546d999 published 2.0.0.
GitHub CI 34728440590: all four jobs success. Read-only web/API/proxy smoke
matched exact SHA/version after 8 attempts (80103ms). No public mutation tests.

Wave C baseline is that commit. API service worker owns match-service and GAP-005
tests; web worker owns api.ts, match create/detail/judge pages and their tests;
parent owns shared contracts/reducer, migrations, app routes/OpenAPI and docs.
Source Red: four API scenarios fail before implementation; manual-correction
reducer Red then 11/11 Green. MATCH-004 groups and OpenAPI Red then 6/6 Green.
D33 and Wave B DTO/auth behavior remain authoritative. Source review requires
exclusive reservations, atomic handover/mutations and no-show replay corrections.
These remain in progress until real PostgreSQL and browser acceptance pass.

### Wave C independent review corrections

- Start now locks registered participant rows in stable order and timestamps the
  transition. Real-PG concurrent shared-player starts have exactly one winner.
- Handover keeps historical judge identities, releases former authority, and
  reserves the slot exclusively. Terminal replay must identify the confirming session.
- Serve rotation retains its anchor; setup cannot bypass correction after points.
  Undo keeps technical history while the UI displays only effective awards.
- UI start/setup, cancellation, undo and terminal actions are mutually guarded.
  Global 401 recovery must retain drafts without stale errors. Full web passed
  164/164 before the additional D7 nonparticipant-entry regression.
- Aggregate attempt stopped on the preserved-draft 401 regression (159/160 web),
  subsequently fixed and focused recovery/create 9/9 green. Browser acceptance
  adds 2×2/no-show/revenge, two-client correction/handover and separate creator/judge start.

### Wave C accepted locally

Final `verify:all` 1056/1056: quality980, PostgreSQL47, browser25 (16 journeys +9
foundation), cleanup4. Zero failed/skipped/todo/interrupted. Rendered desktop/390
creation, detail and judge captures reviewed. Waiting timer regression fixed;
final browser fixture uses the real «Старт» label and awaits the documented
30-second judge refresh. Original186 files unchanged. Candidate2.1.0 public release pending.
[Redacted evidence](../audit/evidence/wave-c-local.json).
