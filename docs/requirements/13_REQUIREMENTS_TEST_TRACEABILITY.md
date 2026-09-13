# Requirements ↔ Tests Traceability

Обновлено **2026-09-13**. Таблица показывает существующий
evidence и пробелы; перечисление слоя не означает, что слой уже реализован.
Capability-level выводы находятся в [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md),
дефекты — в [`../BACKLOG.md`](../BACKLOG.md).

| Requirement group | Acceptance / intended evidence | Current evidence | Coverage | Blocking backlog |
|---|---|---|---|---|
| AUTH-001..008 | AT-AUTH-001..008; API + browser first-login/session journeys | API integration включает exact method+router-path gate для temporary-password session; browser journey и часть session UX неполны | `partial` | BUG-007, TECH-003 |
| ADM-001..008 | AT-ADM-001..005, AT-AUTH-008; admin role/user/audit journeys | integration/API и AdminPage tests частично | `partial` | SEC-004, BUG-011, GAP-010 |
| ADM-MATCH / void | AT-ADM-MATCH-001..007; AT-MATCH-VOID-001..004 | BUG-002 cancel/force-close и DATA-005/007 void green локально: creator/active-admin actor matrix, stale/outsider rejection, one-time compensation, immutable audit, purge safeguard and tournament downstream preservation | `partial` | GAP-005 |
| HOME-001..006 | AT-HOME-001/002; AT-EMPTY-001; active/recent/stats/rival states | Wave A UI covers active standalone+tournament, hero+rival, combined recent-5, all-time/month top-3 and actionable empty states; component 3/3 and API focused gates green, browser pending | `partial` | GAP-001 (`in_progress`) |
| PROFILE-001..006 | AT-PROFILE-001..005; own/public/privacy/edit/avatar/session contracts | Wave B API 220/220 and web 148/148 cover nested DTO/privacy/blocked/current-session/strict mutation; browser own/public/blocked/profile-session/challenge passed at desktop and 390px; aggregate gate pending | `partial` | GAP-002 (`in_progress`) |
| RANK-001..005 | AT-RANK-001..006; timezone/team/card cases | Wave B team/period API and web contracts consume canonical public profile DTO; ranking → profile → challenge and Moscow-boundary browser checks passed at desktop and 390px; aggregate gate pending | `partial` | GAP-004 (`in_progress`) |
| HISTORY-001..004 | AT-VIS-001..004; AT-VIS-003 filters/pagination | Existing visibility/void/tutorial coverage plus Wave B dedicated history API covers server filters, keyset and tournament results; PostgreSQL history 2/2 and browser journey recorded, selector issues/final aggregate gate pending | `partial` | GAP-003 (`in_progress`) |
| MATCH-001..017 | AT-MATCH-001..016, START/STOP, CANCEL-001..004, VOID-001..004 | Wave C full gate1056/1056: quality980, PostgreSQL47, browser25 (16 compiled journeys +9 foundation). GAP-005 service12/12, real-PG concurrency5/5, options/OpenAPI6/6, shared13/13. `tests/e2e/wave-c.spec.ts` covers grouped 2v2/no-show/revenge, correction/undo/handover and separate creator/club-judge start at desktop/390; persisted state and rendered captures checked. | `verified` | GAP-005 (`verified_local`) |
| JUDGE-001..012 | AT-JUDGE-001..010; two-client browser lifecycle | Wave C full gate1056/1056: quality980, PostgreSQL47, browser25 (16 compiled journeys +9 foundation). GAP-005 service12/12, real-PG concurrency5/5, options/OpenAPI6/6, shared13/13. `tests/e2e/wave-c.spec.ts` covers grouped 2v2/no-show/revenge, correction/undo/handover and separate creator/club-judge start at desktop/390; persisted state and rendered captures checked. | `verified` | GAP-005 (`verified_local`) |
| TOURNAMENT-001..019 | AT-TRN-001..018 and AT-MATCH-VOID-004; deterministic V2 SE/DE E2E | local API covers organizer ownership, cross-tournament isolation, DATA-002 rollback/replay and D33 tournament void preserving bracket/downstream/notifications; PostgreSQL concurrency and full browser lifecycle are release gates | `partial` | GAP-006 |
| TEAM-001..009 | AT-TEAM-001..006; captain/invite/leave/archive E2E | service/API basics, sparse page coverage | `partial` | DATA-004, GAP-007 |
| NOTIF-001..006 | AT-NOTIF-001..005; expiry/read/popup lifecycle | Wave A component 2/2 and focused API gates cover visible-read and terminal action suppression; browser pending | `partial` | BUG-013 (`in_progress`), GAP-008 |
| ONB-001..005 | AT-ONB-001..003; first-login/resume/restart/tutorial-return E2E | Wave A components and focused API cover auto-open, persisted resume, explicit completion, restart, single-flight and tutorial return; browser pending | `partial` | BUG-012 (`in_progress`), GAP-009 |
| HELP-001..003 | FAQ/feedback categories and validation | endpoints/basic page only | `partial` | GAP-009 |
| EMPTY | AT-EMPTY-001 across all zero states | isolated smoke/components, not route matrix | `partial` | GAP-001..010 |
| LIVE-001 | AT-LIVE-001/002; fake-timer components + two-client browser | Wave A web 9/9 covers visible cadence, resume, cleanup, coalescing, terminal stop and manual retry; browser pending | `partial` | BUG-008 (`in_progress`) |
| UI async mutation resilience | AT-UI-001/002; double-submit/action-error + API concurrency | Wave A preserves loaded context and blocks duplicate form actions; web and focused API gates green, browser pending | `partial` | BUG-006/009 (`in_progress`) |
| NFR performance/cold start | load SLO; AT-OPS-COLD-001/002 | Wave A fake-timer 3/3 covers checking→waking, bounded abort/Retry and warm-request isolation; public cold smoke pending | `partial` | OPS-005 (`in_progress`), TECH-002 |
| NFR schema evolution | AT-DATA-MIG-001/002; fresh + historical upgrade on PGlite/PostgreSQL; read-only startup preflight | DATA-003 PGlite fresh/0000→0001/no-op/checksum/startup policy is green; DATA-005 adds forward migration `0001_data_005_match_void.sql`, current-snapshot drift checks and an append-only trigger. PostgreSQL 16 remains a release gate | `partial` | DATA-003 |
| NFR security | negative authz/schema/secret/dependency tests | DATA-001 match payload runtime validation/no-side-effect table, SEC-002/003 и SEC-006/007 negative API matrices verified locally; SEC-005 working-tree audit 0 high/critical and full CI green; 3 moderate React Router findings triaged; credential rotation verified_prod | `broken` | SEC-001, SEC-004/005 |
| NFR a11y/compatibility | axe, browser/viewport/keyboard/safe-area matrix | TECH-002 build-mode regression: 17/17 Node tests; production artifact inspection dev React 0, prod React 1, jsxDEV 0; Wave B browser surfaces checked at desktop/390px; full keyboard/safe-area/landscape/cross-browser matrix remains | `partial` | GAP-011, TECH-002 (`in_progress`) |
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
