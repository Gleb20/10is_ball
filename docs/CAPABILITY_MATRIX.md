# Capability matrix

Снимок на **2026-09-06**. Это оценка end-to-end способности, а не наличия файла
или зелёного unit test.

Статусы: `verified` — целевой сценарий подтверждён на достаточном уровне;
`partial` — полезная часть работает, покрытие неполно; `broken` — реализация есть,
но существенный дефект нарушает сценарий/безопасность; `missing` — требуемой
возможности нет; `unknown` — данных для вывода недостаточно.

| Capability | Target | Status | Evidence / ограничение | Backlog |
|---|---|---|---|---|
| Production web/API reachability | Web → Vercel rewrite → Render API | `verified` | [HTTP evidence](audit/evidence/production-http-baseline.json): оба URL и proxied health 200 после wake-up | OPS-005 |
| Local account login | Active user входит по email/password | `partial` | happy path и tests есть; temporary-password gate bypassable, rate limiter flawed | SEC-003, TECH-003 |
| Admin account lifecycle | create/role/block/unblock/reset | `partial` | API шире UI; live `SEED_ADMIN=0` подтверждён, bootstrap hardening explicit/atomic/audited локально, но foundation code ещё не deployed; unblock/self safety UI incomplete | SEC-004, BUG-011, GAP-010 |
| Session management | sliding session, list/revoke/change password | `partial` | API есть; runtime 401 не синхронизирует web auth state | BUG-007 |
| Own profile | view/edit/stats/avatar/sessions | `broken` | edit response локально защищён точным allowlist; значительная часть PRD отсутствует | GAP-002 |
| Public player profile | privacy-safe card + challenge | `missing` | отдельного полного route/экрана нет | GAP-002 |
| Home dashboard | hero, active/recent events, stats/rival | `partial` | сокращённый aggregate; нет полного HOME-001..006 | GAP-001 |
| Rankings | all/week/month ordered ranking | `broken` | базовые scopes есть, но UTC boundaries расходятся с Europe/Moscow; team/public-card gaps | BUG-014, GAP-004 |
| Event visibility | Active scoped; completed visible active club-wide | `broken` | list/detail возвращают глобальные данные | BUG-001 |
| Match creation | Valid 1v1/2v2 roster and rules | `broken` | 1v1 happy path есть; runtime validation/uniqueness/atomicity отсутствуют | DATA-001, BUG-010, GAP-005 |
| Match start | Only creator/organizer starts valid match | `broken` | actor ownership не проверяется | SEC-006, BUG-002 |
| Judge acquire/score/undo/finish | One live judge; reliable score lifecycle | `broken` | engine/tests есть; lock lifecycle/live sync/double-tap и atomic finish defects | BUG-003, BUG-004, BUG-005, DATA-002 |
| Early stop | Organizer or active judge chooses winner/reason | `broken` | обычный participant допускается | BUG-002 |
| Cancel | Active admin or creator; optional reason; explicit confirmation | `broken` | current service также допускает participant/current judge и отделяет admin force-close | BUG-002 |
| Finished-result correction | Admin/creator void + confirmation + immutable audit + stats compensation | `missing` | standalone flow отсутствует; tournament downstream outcome открыт отдельно | DATA-005, DATA-007 |
| Match history | visible feed, filters/search/pagination | `broken` | глобальные lists и упрощённый экран | BUG-001, GAP-003 |
| Bracket generation algorithms | V2 SE/DE compact/Po2; bounded rejection of V1 DE | `partial` | 455 property scenarios pass; unsupported legacy V1 DE всё ещё достигает known hang path, integration lifecycle не доказан | DATA-006, GAP-006 |
| Tournament organizer lifecycle | create/roster/generate/start/play/stop | `broken` | основные endpoints есть; authz/IDOR/concurrency defects критичны, busy participant с bye обходит start guard | SEC-006, SEC-007, DATA-002, BUG-015, GAP-006 |
| Tournament visibility/history | То же правило event visibility | `broken` | global list/detail | BUG-001 |
| Teams | captain/invite/member/leave/archive/use-in-event | `partial` | backend/UI реализуют только часть, race conditions | DATA-004, GAP-007 |
| Notifications | actionable current items/read/expiry/popup | `partial` | list/read есть, semantics/types/UI incomplete | BUG-013, GAP-008 |
| Onboarding | once/resume/skip/restart/tutorial isolation | `broken` | статический неполный flow; tutorial isolation не везде | BUG-012, GAP-009 |
| Help/feedback | FAQ, categories, context help | `partial` | FAQ/feedback endpoints есть; UI/категории неполны | GAP-009 |
| Accessibility/responsive | 360px+, keyboard, WCAG AA, judge landscape | `broken` | public production и synthetic local viewport baseline сохранён; touch/contrast/semantics/layout defects остаются, axe/keyboard/judge landscape не пройдены | GAP-011, TECH-002 |
| Audit trail | Immutable security/sporting ledger | `broken` | audit table есть, но технические события изменяемы/удаляемы | DATA-005 |
| API contract | Complete current OpenAPI and target spec | `broken` | source: 60 operations/54 paths; OpenAPI: 15 operations/12 paths | OPS-001 |
| Database evolution | Versioned safe PostgreSQL migrations | `broken` | boot-time DDL и drift risks | DATA-003 |
| Backup/restore | Safe rehearsed recovery | `unknown` | script есть, production policy/evidence отсутствуют и script опасен | OPS-003, Q-OPS-003 |
| Observability/readiness | Diagnose API/DB/requests/incidents | `missing` | logger disabled; health only liveness | OPS-002 |
| Deterministic CI | Full repeatable green quality gate | `verified` | RNG leak устранён; три последовательных full suite и final local Node 24 `pnpm run ci` зелёные; GitHub run 34048623246 green для Quality/PGlite и PostgreSQL 16 | TECH-001, TECH-002 |
| Runtime/build portability | One Node version across local/CI/hosting | `partial` | configs aligned; local Node 24.20.0 и hosted GitHub quality/PostgreSQL jobs green; Vercel/Render build/deploy этого snapshot не выполнялись | TECH-004, OPS-004 |

Изменение статуса требует evidence по [Definition of done](WORKFLOW.md#3-definition-of-done),
а не только закрытия связанного backlog item.
