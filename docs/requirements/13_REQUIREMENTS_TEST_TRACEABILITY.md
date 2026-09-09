# Requirements ↔ Tests Traceability

Обновлено **2026-09-07**. Таблица показывает существующий
evidence и пробелы; перечисление слоя не означает, что слой уже реализован.
Capability-level выводы находятся в [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md),
дефекты — в [`../BACKLOG.md`](../BACKLOG.md).

| Requirement group | Acceptance / intended evidence | Current evidence | Coverage | Blocking backlog |
|---|---|---|---|---|
| AUTH-001..008 | AT-AUTH-001..008; API + browser first-login/session journeys | API integration включает exact method+router-path gate для temporary-password session; browser journey и часть session UX неполны | `partial` | BUG-007, TECH-003 |
| ADM-001..008 | AT-ADM-001..005, AT-AUTH-008; admin role/user/audit journeys | integration/API и AdminPage tests частично | `partial` | SEC-004, BUG-011, GAP-010 |
| ADM-MATCH / void | AT-ADM-MATCH-001..007; AT-MATCH-VOID-001..004 | BUG-002 cancel/force-close и DATA-005/007 void green локально: creator/active-admin actor matrix, stale/outsider rejection, one-time compensation, immutable audit, purge safeguard and tournament downstream preservation | `partial` | GAP-005 |
| HOME-001..006 | AT-EMPTY-001; active/recent/stats/rival states | `/home.lastMatches` наследует actor-scoped BUG-001 filter и tutorial isolation в local API matrix; composition/UI всё ещё не полный PRD | `partial` | GAP-001 |
| PROFILE-001..006 | AT-PROFILE-001; own/public/privacy/edit/avatar/session contracts | exact 11-field profile mutation allowlist API test; нет полного public flow | `broken` | GAP-002 |
| RANK-001..005 | AT-RANK-001..004; timezone boundary cases | unit/integration basics; текущие period boundaries UTC | `broken` | BUG-014, GAP-004 |
| HISTORY-001..004 | AT-VIS-001..004; AT-VIS-003 filters/pagination | `visibility.integration.test.ts` локально покрывает AT-VIS-001/002/004 на match/tournament list+detail/home, включая terminal `finished|stopped|cancelled`; DATA-005 API/browser подтверждает club-visible `voided`, а `HistoryPage.test.tsx` запрещает terminal purge CTA. Dedicated AT-VIS-003 API/browser flow отсутствует | `partial` | GAP-003 |
| MATCH-001..017 | AT-MATCH-001..014, START/STOP, CANCEL-001..004, VOID-001..004 | DATA-001 validation, DATA-002 atomic finish, BUG-002 action matrix, DATA-005/007 void and BUG-003 FIFO queue green locally; MatchDetail covers named confirmation and tournament preservation warning | `partial` | BUG-010, GAP-005 |
| JUDGE-001..012 | AT-JUDGE-001..006; two-client browser lifecycle | API integration plus deterministic rapid `+1 → +2` FIFO/version-conflict JudgePage tests; full lock lifecycle remains incomplete | `partial` | BUG-004/005, GAP-005 |
| TOURNAMENT-001..019 | AT-TRN-001..018 and AT-MATCH-VOID-004; deterministic V2 SE/DE E2E | local API covers organizer ownership, cross-tournament isolation, DATA-002 rollback/replay and D33 tournament void preserving bracket/downstream/notifications; PostgreSQL concurrency and full browser lifecycle are release gates | `partial` | GAP-006 |
| TEAM-001..009 | AT-TEAM-001..006; captain/invite/leave/archive E2E | service/API basics, sparse page coverage | `partial` | DATA-004, GAP-007 |
| NOTIF-001..006 | AT-NOTIF-001..004; expiry/read/popup lifecycle | list/read + limited integration/UI | `partial` | BUG-013, GAP-008 |
| ONB-001..005 | AT-ONB-001/002; first-login/resume/restart E2E | static page; guided state not covered | `broken` | BUG-012, GAP-009 |
| HELP-001..003 | FAQ/feedback categories and validation | endpoints/basic page only | `partial` | GAP-009 |
| EMPTY | AT-EMPTY-001 across all zero states | isolated smoke/components, not route matrix | `partial` | GAP-001..010 |
| NFR performance/cold start | load SLO; AT-OPS-COLD-001/002 | in-process PGlite load only; live cold start observed | `partial` | OPS-005, TECH-002 |
| NFR schema evolution | AT-DATA-MIG-001/002; fresh + historical upgrade on PGlite/PostgreSQL; read-only startup preflight | DATA-003 PGlite fresh/0000→0001/no-op/checksum/startup policy is green; DATA-005 adds forward migration `0001_data_005_match_void.sql`, current-snapshot drift checks and an append-only trigger. PostgreSQL 16 remains a release gate | `partial` | DATA-003 |
| NFR security | negative authz/schema/secret/dependency tests | DATA-001 match payload runtime validation/no-side-effect table, SEC-002/003 и SEC-006/007 negative API matrices verified locally; SEC-005 working-tree audit 0 high/critical and full CI green; 3 moderate React Router findings triaged; credential rotation verified_prod | `broken` | SEC-001, SEC-004/005 |
| NFR a11y/compatibility | axe, browser/viewport/keyboard/safe-area matrix | jsdom smoke only | `broken` | GAP-011, TECH-002 |
| AUDIT | immutable ledger + D24/D33 actor/prior-state/optional-reason/compensation integration tests | dedicated `match_void_audits` preserves actor/key/prior version/result/events/reason/compensation and tournament policy; tests reject update/delete and prove rollback/replay. Generic technical audit remains outside the sporting-void scope | `partial` | — |
| NFR backup/observability | safe restore rehearsal; readiness/log assertions | unsafe rehearsal script; no readiness/structured logs | `unknown` | OPS-002/003 |
| NFR delivery/release identity | AT-OPS-DELIVERY-001..009; quality/PostgreSQL/compiled-browser plus native-Git exact-SHA public smoke | D32 direct-main command and native deploy configured; first converged public smoke still required | `partial` | OPS-004; VPS recovery follow-up |

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
