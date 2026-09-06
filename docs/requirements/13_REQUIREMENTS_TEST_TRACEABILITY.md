# Requirements ↔ Tests Traceability

Обновлено по baseline-аудиту **2026-09-06**. Таблица показывает существующий
evidence и пробелы; перечисление слоя не означает, что слой уже реализован.
Capability-level выводы находятся в [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md),
дефекты — в [`../BACKLOG.md`](../BACKLOG.md).

| Requirement group | Acceptance / intended evidence | Current evidence | Coverage | Blocking backlog |
|---|---|---|---|---|
| AUTH-001..008 | AT-AUTH-001..008; API + browser first-login/session journeys | API integration и часть component tests | `partial` | SEC-003, BUG-007, TECH-003 |
| ADM-001..008 | AT-ADM-001..005, AT-AUTH-008; admin role/user/audit journeys | integration/API и AdminPage tests частично | `partial` | SEC-004, BUG-011, GAP-010 |
| ADM-MATCH / void | AT-ADM-MATCH-001..007; standalone AT-MATCH-VOID-001..003; tournament criteria after Q-MATCH-003 | force-close/delete tests есть; D23 actor matrix расходится с cancel service, целевой D24 void отсутствует | `broken` | BUG-002, DATA-005/007 |
| HOME-001..006 | AT-EMPTY-001; active/recent/stats/rival states | aggregate и Home UI, но не полный PRD | `partial` | BUG-001, GAP-001 |
| PROFILE-001..006 | own/public/privacy/edit/avatar/session contracts | auth/profile basics; нет полного public flow | `broken` | SEC-002, GAP-002 |
| RANK-001..005 | AT-RANK-001..004; timezone boundary cases | unit/integration basics; текущие period boundaries UTC | `broken` | BUG-014, GAP-004 |
| HISTORY-001..004 | AT-VIS-001..004; AT-VIS-003 filters/pagination | упрощённая global list, без dedicated API/E2E | `broken` | BUG-001, GAP-003 |
| MATCH-001..017 | AT-MATCH-001..012, START/STOP, CANCEL-001..004, standalone VOID-001..003; tournament criteria after Q-MATCH-003 | strong engine/API slice; hosted PostgreSQL AT-MATCH-007/011 race + one-time stats green on run 34048623246; D23 cancel actor, D24 void и broader concurrency gaps remain | `broken` | DATA-001/002/005/007, BUG-002/003/010, GAP-005 |
| JUDGE-001..012 | AT-JUDGE-001..006; two-client browser lifecycle | API integration + limited JudgePage tests | `broken` | BUG-003/004/005, GAP-005 |
| TOURNAMENT-001..019 | AT-TRN-001..015; deterministic V2 SE/DE E2E; bounded V1 DE rejection; void criteria after Q-MATCH-003 | 455 bracket property scenarios + API/UI slices; hosted PostgreSQL AT-TRN-010 final + third-place materialization green on run 34048623246; V1 DE known hang path, tournament void outcome unresolved и нет full browser lifecycle | `broken` | SEC-006/007, DATA-002/006/007, GAP-006 |
| TEAM-001..009 | AT-TEAM-001..006; captain/invite/leave/archive E2E | service/API basics, sparse page coverage | `partial` | DATA-004, GAP-007 |
| NOTIF-001..006 | AT-NOTIF-001..004; expiry/read/popup lifecycle | list/read + limited integration/UI | `partial` | BUG-013, GAP-008 |
| ONB-001..005 | AT-ONB-001/002; first-login/resume/restart E2E | static page; guided state not covered | `broken` | BUG-012, GAP-009 |
| HELP-001..003 | FAQ/feedback categories and validation | endpoints/basic page only | `partial` | GAP-009 |
| EMPTY | AT-EMPTY-001 across all zero states | isolated smoke/components, not route matrix | `partial` | GAP-001..010 |
| NFR performance/cold start | load SLO; AT-OPS-COLD-001/002 | in-process PGlite load only; live cold start observed | `partial` | OPS-005, TECH-002 |
| NFR security | negative authz/schema/secret/dependency tests | uneven; multiple P0 findings | `broken` | SEC-001..007, DATA-001 |
| NFR a11y/compatibility | axe, browser/viewport/keyboard/safe-area matrix | jsdom smoke only | `broken` | GAP-011, TECH-002 |
| AUDIT | immutable ledger + D24 void actor/prior-state/optional-reason/compensation integration tests | generic audit rows, no immutable enforcement | `broken` | DATA-005 |
| NFR backup/observability | safe restore rehearsal; readiness/log assertions | unsafe rehearsal script; no readiness/structured logs | `unknown` | OPS-002/003 |

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
