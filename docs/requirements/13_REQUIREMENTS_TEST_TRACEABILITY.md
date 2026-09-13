# Requirements ↔ Tests Traceability

Обновлено **2026-09-13**. Таблица показывает существующий
evidence и пробелы; перечисление слоя не означает, что слой уже реализован.
Capability-level выводы находятся в [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md),
дефекты — в [`../BACKLOG.md`](../BACKLOG.md).

| Requirement group | Acceptance / intended evidence | Current evidence | Coverage | Blocking backlog |
|---|---|---|---|---|
| AUTH-001..008 | AT-AUTH-001..008; API + browser first-login/session journeys | API integration включает exact method+router-path gate для temporary-password session; browser journey и часть session UX неполны | `partial` | BUG-007, TECH-003 |
| ADM-001..008 | AT-ADM-001..005, AT-AUTH-008; admin role/user journeys and persisted audit | Wave E successful lanes1229/1229: quality1112, PostgreSQL66, browser47 including38 desktop/390 journeys, cleanup4. Consent PostgreSQL8/8 includes three reproduced cross-match40P01 regressions; admin/catalog/audit, consent/history, onboarding/tutorial return/Help actions pass. See wave-e-local.json; GAP-011 quality remains | `verified` | SEC-004, BUG-011, GAP-010 |
| ADM-MATCH / void | AT-ADM-MATCH-001..007; AT-MATCH-VOID-001..004 | BUG-002 cancel/force-close и DATA-005/007 void green локально: creator/active-admin actor matrix, stale/outsider rejection, one-time compensation, immutable audit, purge safeguard and tournament downstream preservation | `partial` | GAP-005 |
| HOME-001..006 | AT-HOME-001/002; AT-EMPTY-001; active/recent/stats/rival states | Wave A UI covers active standalone+tournament, hero+rival, combined recent-5, all-time/month top-3 and actionable empty states; component 3/3 and API focused gates green, browser pending | `partial` | GAP-001 (`in_progress`) |
| PROFILE-001..006 | AT-PROFILE-001..005; own/public/privacy/edit/avatar/session contracts | Wave B API 220/220 and web 148/148 cover nested DTO/privacy/blocked/current-session/strict mutation; browser own/public/blocked/profile-session/challenge passed at desktop and 390px; aggregate gate pending | `partial` | GAP-002 (`in_progress`) |
| RANK-001..005 | AT-RANK-001..006; timezone/team/card cases | Wave B team/period API and web contracts consume canonical public profile DTO; ranking → profile → challenge and Moscow-boundary browser checks passed at desktop and 390px; aggregate gate pending | `partial` | GAP-004 (`in_progress`) |
| HISTORY-001..004 | AT-VIS-001..004; AT-VIS-003 filters/pagination | Existing visibility/void/tutorial coverage plus Wave B dedicated history API covers server filters, keyset and tournament results; PostgreSQL history 2/2 and browser journey recorded, selector issues/final aggregate gate pending | `partial` | GAP-003 (`in_progress`) |
| MATCH-001..017 | AT-MATCH-001..016, START/STOP, CANCEL-001..004, VOID-001..004 | Wave C full gate1056/1056: quality980, PostgreSQL47, browser25 (16 compiled journeys +9 foundation). GAP-005 service12/12, real-PG concurrency5/5, options/OpenAPI6/6, shared13/13. `tests/e2e/wave-c.spec.ts` covers grouped 2v2/no-show/revenge, correction/undo/handover and separate creator/club-judge start at desktop/390; persisted state and rendered captures checked. | `verified` | GAP-005 (`verified_local`) |
| JUDGE-001..012 | AT-JUDGE-001..010; two-client browser lifecycle | Wave C full gate1056/1056: quality980, PostgreSQL47, browser25 (16 compiled journeys +9 foundation). GAP-005 service12/12, real-PG concurrency5/5, options/OpenAPI6/6, shared13/13. `tests/e2e/wave-c.spec.ts` covers grouped 2v2/no-show/revenge, correction/undo/handover and separate creator/club-judge start at desktop/390; persisted state and rendered captures checked. | `verified` | GAP-005 (`verified_local`) |
| TOURNAMENT-001..019 | AT-TRN-001..021 and AT-MATCH-VOID-004; deterministic V2 SE/DE E2E | Wave D final local gate 1135/1135 covers organizer settings/transitions, seed/BYE invalidation/regeneration, SE/DE 3/5/8, busy-player locks, persisted summary/stop reason, D33 preservation and terminal auto-BYE suppression. PostgreSQL 56/56 and browser 41/41 passed; desktop/390/landscape rendered states reviewed. | `verified` | GAP-006 (`verified_local`) |
| TEAM-001..009 | AT-TEAM-001..007; captain/invite/leave/archive E2E | Wave D final local gate 1135/1135 covers service/auth/real-PG serialization, team contracts, component recovery/guards, full lifecycle, privacy-safe DTO, atomic block reassignment/archive and multi-user browser journey. PostgreSQL 56/56 and browser 41/41 passed. | `verified` | DATA-004, GAP-007 (`verified_local`) |
| NOTIF-001..006 | AT-NOTIF-001..005; expiry/read/popup lifecycle | Wave E successful lanes1229/1229: quality1112, PostgreSQL66, browser47 including38 desktop/390 journeys, cleanup4. Consent PostgreSQL8/8 includes three reproduced cross-match40P01 regressions; admin/catalog/audit, consent/history, onboarding/tutorial return/Help actions pass. See wave-e-local.json; GAP-011 quality remains | `verified` | BUG-013 (`in_progress`), GAP-008 |
| ONB-001..005 | AT-ONB-001..003; first-login/resume/restart/tutorial-return E2E | Wave E successful lanes1229/1229: quality1112, PostgreSQL66, browser47 including38 desktop/390 journeys, cleanup4. Consent PostgreSQL8/8 includes three reproduced cross-match40P01 regressions; admin/catalog/audit, consent/history, onboarding/tutorial return/Help actions pass. See wave-e-local.json; GAP-011 quality remains | `verified` | BUG-012 (`in_progress`), GAP-009 |
| HELP-001..003 | FAQ/feedback categories and validation | Wave E successful lanes1229/1229: quality1112, PostgreSQL66, browser47 including38 desktop/390 journeys, cleanup4. Consent PostgreSQL8/8 includes three reproduced cross-match40P01 regressions; admin/catalog/audit, consent/history, onboarding/tutorial return/Help actions pass. See wave-e-local.json; GAP-011 quality remains | `verified` | GAP-009 |
| EMPTY | AT-EMPTY-001 across all zero states | isolated smoke/components, not route matrix | `partial` | GAP-001..010 |
| LIVE-001 | AT-LIVE-001/002; fake-timer components + two-client browser | Wave A web 9/9 covers visible cadence, resume, cleanup, coalescing, terminal stop and manual retry; browser pending | `partial` | BUG-008 (`in_progress`) |
| UI async mutation resilience | AT-UI-001/002; double-submit/action-error + API concurrency | Wave A preserves loaded context and blocks duplicate form actions; web and focused API gates green, browser pending | `partial` | BUG-006/009 (`in_progress`) |
| NFR performance/cold start | load SLO; AT-OPS-COLD-001/002 | Wave A fake-timer 3/3 covers checking→waking, bounded abort/Retry and warm-request isolation; public cold smoke pending | `partial` | OPS-005 (`in_progress`), TECH-002 |
| NFR schema evolution | AT-DATA-MIG-001/002; fresh + historical upgrade on PGlite/PostgreSQL; read-only startup preflight | DATA-003 PGlite fresh/0000→0001/no-op/checksum/startup policy is green; DATA-005 adds forward migration `0001_data_005_match_void.sql`, current-snapshot drift checks and an append-only trigger. PostgreSQL 16 remains a release gate | `partial` | DATA-003 |
| NFR security | negative authz/schema/secret/dependency tests | DATA-001 match payload runtime validation/no-side-effect table, SEC-002/003 и SEC-006/007 negative API matrices verified locally; SEC-005 working-tree audit 0 high/critical and full CI green; 3 moderate React Router findings triaged; credential rotation verified_prod | `broken` | SEC-001, SEC-004/005 |
| NFR a11y/compatibility | NFR §§9–10, A11Y checklist; real browser/viewport/focus/axe | F current shared controls/Dialog/judge/bracket/ranking fixes: full1249/1249 including48 Chromium journeys, plus7 Firefox; WebKit7 runtime failures before app, physical/device/AT/latest-two breadth remains. [Evidence](../audit/evidence/wave-f-local.json) | `partial` | GAP-011, TECH-002 (`in_progress`) |
| AUDIT | immutable ledger + D24/D33 actor/prior-state/optional-reason/compensation integration tests | dedicated `match_void_audits` preserves actor/key/prior version/result/events/reason/compensation and tournament policy; tests reject update/delete and prove rollback/replay. Generic technical audit remains outside the sporting-void scope | `partial` | — |
| NFR backup/observability | AT-OPS-SAFE-001/002, AT-OPS-OBS-001/002; safe restore rehearsal; readiness/log assertions | OPS safety 7/7 green after stdin-quoted identifier fix and fail-closed new restore-target rule; API readiness/log focused evidence exists, production dashboard/RPO/RTO remain open | `partial` | OPS-002/003, Q-OPS-002/003 |
| NFR delivery/release identity | AT-OPS-DELIVERY-001..009; quality/PostgreSQL/compiled-browser plus native-Git exact-SHA public smoke | D32 direct-main command and native deploy configured; b193e9d/1.11.0 exact-SHA public smoke and all four CI jobs passed | `partial` | OPS-004; VPS recovery follow-up |

## Naming convention

- Unit: `REQ_<group>__<rule>`
- Integration: `INT_<group>__<behavior>`
- API: `API_<method>_<route>__<behavior>`
- Browser E2E: `E2E_<journey>__<outcome>`

Имена старых тестов можно сохранять; новый test должен ссылаться на acceptance ID
в названии или описании, если такой ID существует.

## Review rule

Если requirement изменён:

1. решение фиксируется ADR, если меняется продуктовая политика;
2. acceptance scenario изменяется до implementation;
3. тест демонстрирует Red либо документируется characterization для уже
   существующего поведения;
4. после Green обновляются as-built docs, эта matrix, capability status, backlog и
   changelog по [`../WORKFLOW.md`](../WORKFLOW.md).

Нельзя указывать `E2E` как текущее покрытие без существующего browser test и
сохранённого результата прогона.

### Wave B final local evidence (2026-09-13)

The earlier pending Wave B checks above are superseded by
[wave-b-local.json](../audit/evidence/wave-b-local.json): aggregate 1010/1010,
then strengthened loaded-card browser 19/19. `tests/e2e/wave-b.spec.ts` covers
AT-PROFILE-001..005, AT-RANK-005..006 and AT-VIS-003 at desktop and 390px,
including persisted edit/revoke, public privacy after load, team scopes, challenge,
21-row pagination and detail/back context. Production-mode harness regression is
in `scripts/verify/verify-scripts.test.mjs`; 17/17 passed. Public release pending.

Wave D local evidence additions: `gap-006.integration.test.ts`, `gap-006-lifecycle.integration.test.ts`,
`gap-006.postgres.integration.test.ts`, `modules/tournaments/tournament-summary.test.ts`,
`modules/tournaments/bracket-load.test.ts`, `TournamentDetailPage.gap006.test.tsx`,
`TournamentBracket.gap006.test.tsx`, and `tests/e2e/wave-d-tournaments.spec.ts` map to
TOURNAMENT-007/009/010/011/012/013/015/016/017 and AT-TRN-006..013 plus D33;
the detail-page regression also suppresses terminal/cancelled/already-resolved auto-BYE
"next match" hints.
`gap-007.integration.test.ts`, `gap-007.postgres.integration.test.ts`,
`team-contract.integration.test.ts`, team page tests and `tests/e2e/wave-d-teams.spec.ts`
map to TEAM-001..009 / AT-TEAM-001..007. A prior aggregate passed 1133/1133
(quality 1032, PostgreSQL 56, browser 41, cleanup 4), followed by the rendered-review
auto-BYE repair passing 17/17 focused tests and typecheck. The final aggregate then
passed 1135/1135 (quality 1034, PostgreSQL 56, browser 41 with 32 journeys and
9 foundation checks, cleanup 4), with zero failed/skipped/todo/interrupted. Desktop,
390px and landscape rendered states were reviewed. [Wave D evidence](../audit/evidence/wave-d-local.json).
Wave D is locally verified; there is no public Wave D release yet.

### Wave E focused evidence (2026-09-13)

Wave E recorder evidence remains local and does not close the capabilities. Notification
coverage is split across popup (3), center (5), lifecycle (6), API contract (1),
PostgreSQL consent (2), and transactional event producers (6). The relevant sources are
`apps/web/src/InvitationNotice.test.tsx`,
`apps/web/src/pages/NotificationsPage.test.tsx`,
`apps/api/src/gap-008-notifications.integration.test.ts`,
`apps/api/src/gap-008-api.integration.test.ts`,
`apps/api/src/gap-008.postgres.integration.test.ts`,
`apps/api/src/gap-008-event-notifications.integration.test.ts`, and
`apps/api/src/openapi.contract.test.ts`.

Admin coverage is `apps/api/src/gap-010.integration.test.ts` (4 service/API cases),
`apps/web/src/pages/AdminPage.gap010.test.tsx` (6 web cases), plus existing auth
integration coverage. Help coverage is `apps/api/src/gap-009.integration.test.ts`
(3 service/API cases), `apps/web/src/pages/HelpPage.gap009.test.tsx` (2), and
`apps/web/src/pages/SubmissionGuards.test.tsx` (5). Onboarding coverage is
`apps/api/src/onboarding.integration.test.ts` (7 focused cases), with contextual-page
focused coverage recorded at 54/54.

The fixture-only reconciliation in `data-002.integration.test.ts`,
`data-005.integration.test.ts`, `load.integration.test.ts`,
`match-authorization.integration.test.ts`, `match-validation.integration.test.ts`,
`ownership.integration.test.ts`, `domain.integration.test.ts`,
`gap-005.postgres.integration.test.ts`, and `postgres-date.integration.test.ts`
preserves earlier requirement mappings and explicitly accepts each required synthetic
player invitation through the service with the invited user as actor before intended
starts. Browser E coverage and the final aggregate gate remain pending.

### Wave E consent repair evidence checkpoint

`gap-008.integration.test.ts` now contains23 cases and
`gap-008.postgres.integration.test.ts` contains5. Together with API, event/lifecycle
and authorization suites, the finishing task recorded42/42 PGlite and5/5
PostgreSQL passes. They map to AT-NOTIF-001/002/005, MATCH-003/008 and the
transactional no-write/side-bound consent invariants. Included regressions cover
legacy old-side pending reinvite, accepted/current-side reuse, team-membership
changes, all six terminal match states and stale blocked actors. The injected
notification failure proves invitation/read rollback before side writes occur;
it must not be described as fault injection after participant-side mutation.
Independent review found a possible cross-match user/FK lock cycle absent from
those five PG tests; this is not a completed E gate. Full acceptance awaits the
focused concurrency follow-up and sequential aggregate/browser verification.

The consent PostgreSQL checkpoint above is superseded by8 permanent cases.
Three new cases map GAP-008/DATA-002/GAP-006 cross-match ordering: swap versus
reinvite, swap versus standalone create, and nonplaying tournament organizer
versus judge reinvite. The identical final test file produces3 SQL40P01 failures
on frozen pre-fix services and8/8 passes on the combined repair; related
tournament PG2/2, PGlite5/5 and standalone validation7/7 also pass.
[Focused evidence](../audit/evidence/wave-e-consent-focused.json). Full E
aggregate is not established by these focused tests.

BUG-017 adds `apps/api/src/bug-017.integration.test.ts` under JUDGE-004 /
AT-JUDGE-002: two real auth sessions, same/cross-match409 contract, exact
requestId envelope, persisted no-write and first-session authority preservation.
Red2/2 returned500; Green2/2 passed. Four existing judge cases passed with29
intentionally excluded by explicit name filter, not a zero-skip full-suite
claim. [Focused evidence](../audit/evidence/bug-017-local.json); final F gate pending.

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

### Final F mapping and integration evidence

`apps/web/src/ui.a11y.test.tsx` covers5 current Dialog cases (callback stability,
CSS-hidden ancestor, dynamic hidden ancestor, active disabled and active removed).
`BracketAlgorithmDialog.test.tsx` covers pending controls; JudgePage tests cover
disclosure/live summary without changing score queue; UserPicker error is announced.
`a11y.smoke.test.tsx` now makes semantic claims only; geometry moved to browser.
`onboarding-resume.test.tsx` waits for the existing passive focus effect.

`tests/e2e/wave-f-a11y.spec.ts` maps5 journeys to NFR§§9–10 and the A11Y checklist:
auth/admin/rankings geometry and contrast with real isolated user; bracket/algorithm
keyboard/touch/zoom; judge landscape/live status; onboarding/notification recovery;
hidden/removed/pending Dialog focus. At least4 real ranking entries expose the
decorative rest-row avatar. `critical.spec.ts` retains all axe rules including
color-contrast. `wave-b.spec.ts` awaits the exact month/team response and asserts
settled own-member or empty state; this is response/render consistency, not a
new independent calendar-boundary or identical-row stale-response proof.

Fresh verify:all1249/1249 includes web227 and API BUG-017's two-session no-write
regressions under JUDGE-004/AT-JUDGE-002. Additional Firefox7/7 is separate;
WebKit7 pre-page native crashes and physical-device/AT checks remain unverified.
[Local gate](../audit/evidence/wave-f-local.json);
[engine evidence](../audit/evidence/wave-f-compatibility.json).
