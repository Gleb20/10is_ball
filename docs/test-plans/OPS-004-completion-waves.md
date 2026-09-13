# OPS-004 — Completion waves

## D+E+F release 3.0.0 published — 2026-09-13

Code commit165aecdaaa2eba6ffa5fd9d39926bca155016c95 is public3.0.0.
Local1249/1249, GitHub CI34746947853 all4 jobs success, Render live, Vercel READY,
exact-SHA web/API/proxy GET-only smoke PASS. [Evidence](../audit/evidence/release-3.0.0-public.json).
This supersedes historical pending release/approval checkpoints below. Functional
acceptance stays verified_local; public smoke proves identity/readiness only.
GAP-011/TECH-002 full WebKit/device/AT breadth remains in_progress, not waived.


## Release 3.0.0 authorization — 2026-09-13

User explicitly confirmed: «Подтверждаю. Давай делать версию 3.0.0».
This supersedes the historical pending version approval below. Release the accepted
D+E+F and BUG-017 candidate through D32 direct main and native Git deployment.
Fresh version3.0.0 verify:all passed1249/1249 with449 source identities unchanged.
Exact-SHA public/CI evidence remains pending at this pre-publication checkpoint.
Existing WebKit/device/AT residuals remain open; no public mutating E2E or reset.


Accepted 2026-09-13. Full PRD v2 remains the functional target (D26); retain D33 tournament void preserving downstream history. Onboarding finishes explicitly after returning from tutorial. Delivery uses direct main and native test-stand deployment under D32. No public mutating E2E, database reset, or valuable-production guarantees.

## Baseline and recovery

Remote main and public web/API readiness were observed at `ecf7605fe8d0e5857fb9bb0eebf5ef548c90226a`, version 1.10.1. Original dirty checkout: `/Users/liubavskii/Desktop/work/Codex/tab10`, b62afee. Original worktrees remain untouched. Integration checkout: `/private/tmp/tab10-completion-4F4jia/repo`; source snapshot and SHA-256 manifest: sibling `snapshot/`. Recovery means restoring only the affected task delta after checking for later edits; never reset/clean the original tree. No secret-bearing env files were copied.

## Ordered queue

| Wave | Canonical IDs | Acceptance and dependencies | State |
|---|---|---|---|
| A | Remaining SEC/DATA-001..006, BUG-001..016, GAP-001, OPS-001..005, TECH-001..004 | Preserve released fixes; integrate root-source delta, immutable migrations 0002/0003, exact-SHA quality/PostgreSQL/browser/public gates | released 1.11.0 |
| B | GAP-002, GAP-003, GAP-004 | Profile/privacy/sessions, dedicated filtered cursor history, team ranking/challenge. Reuse bc9c/e263/76bc worktrees selectively; profile service owns shared public-card DTO | released 2.0.0 |
| C | GAP-005, DATA-007 | 1v1/2v2/rules/serve/revenge/log/no-show/handover/correction; reuse 82fe. Preserve D33; two-client acceptance | released 2.1.0 |
| D | GAP-007 then GAP-006 | Team captain/invite/leave/transfer/archive, then complete SE/DE 3/5/8-player lifecycle and placements with PostgreSQL races | verified_local; release blocked on explicit version approval |
| E | GAP-008, GAP-009, GAP-010 | Notification event matrix/popups, explicit onboarding/help/feedback, full admin role/state/audit matrix | verified_local; successful lanes1229/1229, final D+E+F release pending |
| F | GAP-011, TECH-002 | Full REQ/AT reconciliation, desktop/390/360/landscape, keyboard/axe/focus, empty/loading/error/readonly/stale-session, compiled browser critical journeys | local core gate1249/1249 accepted; Firefox7/7, WebKit runtime/device/AT breadth still open |

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

### Wave C released / Wave D teams started

Main615169c780a4522591d3359530177e7574923f14 published2.1.0. CI34730792219
all four jobs success. GET-only exact-SHA/version smoke passed after5 attempts
(82087ms). Read-only Neon check confirmed5 migration entries and3 new columns.
No public mutating tests/reset. Wave D starts with GAP-007. API worker owns team
and auth services plus new GAP-007 tests; web worker owns teams/list/detail/API/App;
parent owns shared validation, app hook/routes/OpenAPI, browser acceptance and docs.
Confirmed debt: create/member insert and block/captain/notification writes must be
atomic. A single blocked-user transaction hook reuses the existing service boundary
pattern; no duplicate auth implementation. Archive is automatic when no active
member remains; captain cannot leave/remove self before transfer. D10 keeps avatar
upload/edit outside this implementation. Tournament work follows team acceptance.

### Wave D review repairs and parallel tournament slice

Team review identified and repaired stale response/reauthentication/reinvite UI issues and
block-versus-create/invite/accept/role-change races. Focused web23/23, PostgreSQL7/7 and
team contract1/1 passed; aggregate attempt1 found the old route inventory, now80/80 operations.
Attempt2 was deliberately interrupted before acceptance when review findings arrived.
No team completion claim or release yet. The parent owns tournament summary/strict API
contracts and settings/seed transaction edits while the web worker owns tournament UI.
The API worker owns TournamentService and bounded MatchService terminal lock changes, plus new GAP-006 lifecycle/PostgreSQL tests. The web writer is frozen; parent owns aggregate/browser and canonical documents. Independent summary/team route-fix review passed.
New tournament pure tests9/9 + persisted summary1/1 + bracket loader3/3 pass; broader acceptance
including start/edit/stop concurrency and desktop/390/landscape browser remains pending.

### Wave D aggregate / release preparation

`evidence-d-aggregate` passed1133/1133 (quality1032, PostgreSQL56, browser41 including32
journeys and9 foundation, cleanup4). Rendered review then found a stale next-match hint
for completed automatic-bye nodes; a focused repair and final gate remain required.
The stop route now returns the full detail DTO and validates bounded reason input.
Version remains2.1.0: automatic approval rejected bump3.0.0 twice, including after the
parent retrieved the approved plan's explicit VERSIONING instruction. The second review
did not accept conversation retrieval as authorization. Do not bypass this restriction;
finish the concrete local result, then obtain direct user confirmation of3.0.0 before
bump/release-note edits. The code change itself and disposable verification remain allowed.

### Wave E source recheck before implementation

GAP-010 ADM-002/004 needs search/status, created/last-login and profile edits; ADM-008
requires persisted audit, not a new audit viewer. Do not add pagination solely for routing.
GAP-008 must preserve atomic complete selected match participants (data model) while
adding player consent records for new standalone external invitees. Sides are already
assigned by the organizer. Same-team inclusion and existing pre-migration matches
remain compatible. Pending/declined/expired player consent blocks start; optional judge
consent never blocks start or replaces D7 free-slot acquisition. Roster replacement
must retain terminal invitation history, not delete it. Mutation and expiry races need
real PostgreSQL evidence. GAP-009 feedback may request a material link within message
text; a new attachment/storage mechanism is outside HELP-003. E implementation waits
for the frozen D gate/release preparation; no E behavior has been marked complete.

### Wave D final local acceptance

Final `verify:all` passed **1135/1135**: quality1034, PostgreSQL56, browser41
(32 journeys plus9 foundation), cleanup4. Zero failed/skipped/todo/interrupted.
The completed auto-BYE hint regression is fixed and checked in both rendered desktop
and390px results, with terminal-next absence now asserted by E2E. Landscape bracket
capture reviewed; original186 files unchanged. [Evidence](../audit/evidence/wave-d-local.json).
Tested version remains2.1.0; proposed3.0.0 is not applied or released. Direct user
confirmation is the remaining version/release-preparation blocker; E/F remain open.

### Wave E isolated continuation while release approval is pending

Wave D release confirmation was requested directly via the native asynchronous panel;
no answer has been received yet. Do not infer consent. Frozen D code is unchanged.
Independent E work runs in sibling `wave-e-work`, copied from the accepted D candidate;
its dependencies link to the integration checkout. Do not release or mix its changes
into D. Parent owns E app/OpenAPI/help/feedback/browser acceptance; API worker owns
match invitation schema/migration0005, MatchService and focused tests; web worker owns
onboarding/context tips after completing admin UI. Admin API19/19 and web23/23 passed
before migration edits. Help API3/3 and web7/7 passed; later mixed API attempt encountered
the in-flight migration drift and is not acceptance. Full E validation is pending.
GAP-005 prestart roster editing was absent in actual code despite an earlier exploration
assumption: implement alongside consent, preserving exact roster cardinality and linked
accepted participant IDs. Both GAP-005 and GAP-008 must reflect that dependency in E docs.

### Wave E isolated implementation checkpoint

Work continues in `/private/tmp/tab10-completion-4F4jia/wave-e-work`, separately from
the frozen D release candidate. GAP-008/009/010 remain in progress. Migration0005
adds historical match invitations; prestart match patches retain consent only for
unchanged participant identity and side. Pending player consent blocks start; judge
consent never reserves the slot. Runtime contract regression caught and fixed an
incorrect500 for missing consent (now409); expired invitations return400.
Focused evidence: match web33/33, notification/popup8/8, notification lifecycle6/6,
match consent PostgreSQL2/2, migration PGlite21/21, API contract1/1, OpenAPI9/9.
The broad fast pass and new browser journeys are not yet accepted. Admin/help
implementation and event producers still require aggregate acceptance. D release
version confirmation remains pending; no version files or public release changed.

### Wave E independent review and rework

The first compiled-browser pass29/38 is not acceptance: a name-order assertion failed
in the new consent journey, its unclosed waiting fixture caused later busy-player failures,
and repeated display names made the mobile selector ambiguous. The fixture now uses
unique names, authoritative displayName and a finally cancellation on the local stand.
Admin and onboarding/help journeys passed at desktop/390; captures were reviewed.
The concurrent fast pass1041/1043 found the obsolete generic tournament reason expectation
and a load SLO overrun during browser execution. The reason assertion was corrected;
load passed in isolation. The final aggregate must run sequentially.
Independent reviews found stale actor mutation, conflicting user lock order, side-bound
consent, terminal notification read and actor-switch UI gaps. Rework added deterministic
Red/Green evidence; canonical admin lock probe and delete-after-terminal race passed2/2
on PostgreSQL. Notification StrictMode and stale-popup-navigation tests are now included.
No gate or capability is closed by these focused checks.


### Coordinator resumed in separate task, 2026-09-13

Current candidate is `/private/tmp/tab10-completion-4F4jia/wave-e-work` at
615169c with uncommitted D+E. Accepted D remains separately in sibling `repo`;
the automatically created coordinator worktree has no candidate changes.
Original snapshot recheck: all 186 files byte-identical. No previous test/load
processes were found at resumption. Previous gate counts remain historical
evidence until the required fresh E aggregate succeeds.

Ownership: separate task requested as client-new-thread:41654c13-76c9-470a-b2e2-95bbcc4b1ea3
owns only MatchService and GAP-008 integration/PostgreSQL tests plus disposable
result `e-consent-finish-result.md`; startup is not yet confirmed. Coordinator
owns canonical docs, test harness acceptance and integration. No competing
writer may change these three backend files while that task is assigned.
After its focused evidence and coordinator review: sequential full verify:all,
rendered desktop/390 E review, freeze/rollback, then separate Wave F task.
Version3.0.0 remains blocked by unanswered explicit confirmation after automatic
approval rejection. No version bump or release has been attempted on resumption.

### Active coordinator recovery — 2026-09-13 05:34 UTC

Coordinator `01a0993c-8cab-79e2-bc40-7f88f9b63273` recovered the prior user's
separate-chat requirement and actual task identity. The previously pending consent
writer is running as `01a09937-35b5-7c63-b153-d0145a7076ba` (confirmed by
read_thread); do not create a duplicate. It retains MatchService and the two
GAP-008 test files until its final result. Independent read-only consent review
was requested separately; native preparation ID
`client-new-thread:1eb7d993-696f-4aa5-b65d-285163f0f566` is not a threadId.
Parent owns sequential aggregate verification and canonical documentation.
Original source manifest rechecked: 186 files, zero changed. API writer reports
focused green results, but E acceptance awaits its frozen handoff, independent
review and aggregate/browser evidence. No product version or release changed.

### E consent review rework

Consent worker returned frozen focused evidence: PGlite42/42, PostgreSQL5/5,
typecheck and three-file rollback passed. Separate reviewer
`01a0993f-8bc9-7ee0-a528-a3125657443a` identified a possible cross-match
user/FK lock-order cycle between waiting side swap and reinvitation. Parent
interrupted `e-coordinator-final` before PostgreSQL/browser acceptance; it is
not a passing aggregate. Shared534 and test-utils4 passed before interruption.
The same consent task owns a deterministic PostgreSQL reproduction and minimal
repair if confirmed. No concurrent candidate writers or full verification.

### E cross-match lock-cycle reproduction

PostgreSQL Red confirmed40P01 for both swap-versus-reinvite and swap-versus-create.
A bounded related probe confirmed nonplaying tournament creator versus judge
reinvite also deadlocks through the creator FK. Parent owns the minimal
TournamentService.start change: creator joins the existing sorted user set
before participant locks. Consent worker owns MatchService and its regression
tests, including the related DATA-002/GAP-006 probe. No new lock framework or
schema change. Parent one-file reverse/forward rollback passed. Historical frozen
D is preserved; it must not be released independently while this known case
remains unaccepted. Separate F source plan is ready in wave-f-work-order.md;
thread01a09942-e6dd-77d3-b0f7-cb31030bf22f waits for E freeze before implementation.

### E consent repair accepted for aggregate

Both writers released source files. Independent four-file re-review returned
PASS against final hashes: legacy pending reinvite plus creator-inclusive sorted
locks, same final PostgreSQL file Red3×40P01/Green8/8. Related PG2/2, tournament
PGlite5/5 and standalone validation7/7 passed. Initial report remains historical
REWORK. Parent started fresh sequential aggregate in e-coordinator-accepted;
no E completion claim until its final summary and rendered review.

### Wave E final functional acceptance

[Wave E evidence](../audit/evidence/wave-e-local.json): successful lanes1229/1229,
zero failed/skipped/todo/interrupted. Original aggregate retains failed browser
launch record; browser-only authorized repeat passes38 journeys +9 foundation.
No source changed between successful lanes. Parent reviewed5 saved E images;
mobile Help journey passed but final screenshot was deleted before collection.
No unnecessary quality/PostgreSQL repeats. Independent consent/lock review PASS.
GAP-008/009/010 verified_local; F and public release remain open.

### Wave F implementation dispatched

Accepted E snapshot: sibling e-accepted-snapshot/source and443-file SHA256
manifest. Original186 files rechecked unchanged. Same separate F task
01a09942-e6dd-77d3-b0f7-cb31030bf22f received implementation start with exclusive
web/test scope from wave-f-work-order.md plus conditional minimal AdminPage
layout repairs. Backend/shared/vendor/lockfile/version are forbidden. Parent
retains canonical docs and aggregate; task owns focused component/browser
checks on disposable resources, report wave-f-implementation-result.md.
Next: worker evidence -> independent F review -> parent sequential full gate,
canonical acceptance and concrete release preparation. No version consent yet.

### F concurrent API contract task BUG-017

F Red fixtures exposed failed cancel cleanup (missing expectedVersion/UUID
idempotency key). The F writer owns fixture repair with persisted terminal and
released-session assertions, without explicit-release masking. Separately,
source confirms missing JUDGE_OTHER_DEVICE message/status mapping causes500
for documented JUDGE-004 device conflict. New BUG-017 API task owns app.ts
mapping/OpenAPI/new two-session API regression; parent owns canonical docs.
It may run focused PGlite/typecheck only, not load/PG/browser beside F.
Current queued native creation ID client-new-thread:4151cc7f-6205-40fd-aa3b-96043ab1524f
is not a threadId; resolve actual task before waiting or reassignment.

BUG-017 actual task resolved:01a0995f-5d4f-7520-b4e8-0a98741669e3, confirmed
active by read_thread. No duplicate API writer. F test-only scope now includes
onboarding-resume.test.tsx: heading DOM presence is awaited, but focus is set
by passive useEffect; use waitFor on the actual focus assertion at both call
sites. Parent verified the source; do not label isolated4/4 rerun as a fix or
change onboarding behavior. Existing failed full-web221/222 remains evidence.

### Wave F independent review checkpoint — 2026-09-13

F15-path candidate delivered with web223/223, main browser21/21 and last
ButtonGroup/link correction11/11. The earlier21/21 is not an aggregate over the
last CSS bytes. Parent inspected auth360, admin1440, bracket360, judge640 and
text200, bootstrap and dialog text200 screenshots. Independent reviewer matched
all15 hashes and found two P2 Dialog focus gaps: a CSS-hidden ancestor is not
filtered and disable/remove of the focused control can send focus outside the
panel. Returned to the same F task for deterministic Red→Green and live browser
regression. No F acceptance or full aggregate yet. BUG-017 focused patch is
reviewed and remains pending that aggregate. Compatibility/device/actual screen
reader coverage remains open. No version/commit/push/deploy.

### F aggregate checkpoint — 2026-09-13

R1/R2 re-review PASS on corrected15-path F delta
(6a9ece081695589ab77a8b03bb4a91bffd3ba768633859b4d19e4b802e2d22a8).
First coordinator `verify:all` f-coordinator-final FAILED1247/1249:
quality1122, PostgreSQL66, cleanup4 pass; browser46/48+9foundation. Both
failures are the F rankings fixture waiting for the empty-team CreateTeam link
after Wave B gives the shared admin a team. RankingsPage correctly renders this
link only when availableTeams is empty. Same F task owns test-only deterministic
fixture correction. Product447-file pre-run snapshot matched after completion;
no product source regression inferred. Full browser lane must rerun after the
actual correction; do not call the original aggregate successful.
42 selected D/E synthetic screenshots retained and representative SE-finished
and DE-generated desktop images reviewed; full-page captures alone do not prove
fixed-navigation placement. Firefox/WebKit preparation ready, no engine test yet.
No version, commit, push or public release.

### F ranking integration correction — 2026-09-13

F now16 paths: a one-attribute RankingsPage decorative-avatar correction plus
the isolated real-user geometry fixture. Role-img-alt Red is retained in
f-membership-green-browser; no axe exclusion. Parent review verified named
links/visible names remain and at least4 real ranking entries force a rest-row.
RankingsPage5/5 and typecheck pass. WaveB mobile failure in f-avatar-green-browser
was traced to expecting1 month row without seeding a played match and accepting
stale all-time rendering. Parent changed only tests/e2e/wave-b.spec.ts: await
exact month/team response, settle loading and verify own-member/empty-or-rendered
state against that response. All-time single-member assertion retained.
Fresh f-period-green passes4/4 WaveB→F journeys (desktop/mobile) +9foundation.
No rankings response mocks, sleeps, retries or disabled assertions. Product/source
rollback snapshots remain outside Git. A fresh full verify:all is the next gate;
compatibility waits its frozen compiled output. Original failed aggregates remain
failed historical evidence. No version/commit/push/deploy.

### Final local candidate acceptance — 2026-09-13

Fresh f-coordinator-accepted verify:all PASS1249/1249:1122 quality,66 PostgreSQL,
57 browser (48 journeys+9foundation),4 cleanup; no failures/skips/todo/interrupted.
All447 input files unchanged through the run. Independent F focus and final
ranking/avatar/period-test reviews PASS. BUG-017 verified_local; D+E functional
acceptance retained. F implementation16 files plus parent WaveB test correction;
source snapshot/patch/rollback evidence outside Git, canonical evidence linked
from PROJECT_STATUS. Source/browser metadata remains version2.1.0 at base615169c
with uncommitted delta, not a published3.0.0 or hosted-CI result.

Additional engine lane is PARTIAL: Firefox155.0 7/7, WebKit26.6 0/7 due native
page-creation SIGSEGV before app assertions;9foundation pass. Its combined16/23
failed status is retained.689 source+dist identities unchanged; ports free and
no disposable resources remain. GAP-011/TECH-002 retain full compatibility/device/
AT residuals. No source fix is justified by the WebKit crash evidence alone.

Next decision: explicit user confirmation for proposed3.0.0 release. Earlier
auto-review twice rejected version/CHANGELOG/VERSIONING mutation; do not retry
without new authorization. No version, commit, push, migration or deploy occurred
in this coordinator stage. Q-OPS-003 and SEC-001 negative old-credential probe
remain existing separate residuals. A bounded next QA slice should recheck WebKit
runtime on a compatible pinned runner, then physical mobile and spoken AT.
