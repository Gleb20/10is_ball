# Capability matrix

Снимок на **2026-09-13**. Это оценка end-to-end способности, а не наличия файла
или зелёного unit test.

Статусы: `verified` — целевой сценарий подтверждён на достаточном уровне;
`partial` — полезная часть работает, покрытие неполно; `broken` — реализация есть,
но существенный дефект нарушает сценарий/безопасность; `missing` — требуемой
возможности нет; `unknown` — данных для вывода недостаточно.

| Capability | Target | Status | Evidence / ограничение | Backlog |
|---|---|---|---|---|
| Production web/API reachability | Web → Vercel rewrite → Render API | `verified` | [OPS-004 release evidence](audit/evidence/ops-004-public-release.json): web/API/proxy exact SHA/version и read-only smoke green | OPS-004, OPS-005 |
| Local account login | Active user входит по email/password | `partial` | temporary-password gate uses exact method+router path; broader rate/session hardening remains | TECH-003 |
| Admin account lifecycle | create/role/block/unblock/reset | `partial` | Disposable stand имеет explicit `SEED_ADMIN=1`; atomic bootstrap создал одного active admin, browser login green; unblock/self safety UI incomplete | SEC-004, BUG-011, GAP-010 |
| Session management | sliding session, list/revoke/change password | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-002 |
| Own profile | view/edit/stats/avatar/sessions | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-002 |
| Public player profile | privacy-safe card + challenge | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-002 |
| Home dashboard | hero, active/recent events, stats/rival | `verified` | Wave A local 965-check gate passed and 1.11.0 exact SHA released; see wave-a-local evidence | GAP-001 |
| Rankings | all/week/month and team ranking | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-004 |
| Event visibility | Active scoped; completed visible active club-wide | `partial` | API list/detail/home enforce organizer/participant/current-judge active scope and club-wide terminal visibility; full history UX remains | GAP-003 |
| Match creation | Valid 1v1/2v2 roster and rules | `verified` | Wave C1056/1056 local gate; desktop/390 creation, no-show and revenge plus DB invariants | BUG-010, GAP-005 |
| Match start | Only creator/organizer starts valid match | `verified` | server actor matrix rejects participant/judge/outsider/admin without ownership | — |
| Judge acquire/score/undo/finish | One live judge; reliable score lifecycle | `verified` | Wave C1056/1056 local gate; two-client handover/creator start, PostgreSQL races and technical undo history | BUG-004, BUG-005, GAP-005 |
| Early stop | Organizer or active judge chooses winner/reason | `verified` | participant rejected; creator/current active judge accepted by API matrix | — |
| Cancel | Active admin or creator; optional reason; explicit confirmation | `verified` | server CAS/idempotency/actor matrix and named confirmation covered | — |
| Finished-result correction | Admin/creator void + confirmation + immutable audit + stats compensation | `partial` | standalone and D33 tournament policy implemented with one-time compensation and downstream-preservation tests | GAP-005 |
| Match history | visible feed, filters/search/pagination | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-003 |
| Bracket generation algorithms | V2 SE/DE compact/Po2; bounded rejection of V1 DE | `partial` | 455 property scenarios pass; legacy V1 DE fails closed under D25; complete V2 tournament browser lifecycle remains GAP-006 | DATA-006, GAP-006 |
| Tournament organizer lifecycle | create/roster/generate/start/play/stop | `partial` | ownership/IDOR and atomic advancement fixed; busy participant with bye and full journey remain | BUG-015, GAP-006 |
| Tournament visibility/history | То же правило event visibility | `verified` | active scope and club-wide terminal API matrix implemented | — |
| Teams | captain/invite/member/leave/archive/use-in-event | `partial` | backend/UI реализуют только часть, race conditions | DATA-004, GAP-007 |
| Notifications | actionable current items/read/expiry/popup | `partial` | list/read есть, semantics/types/UI incomplete | BUG-013, GAP-008 |
| Onboarding | once/resume/skip/restart/tutorial isolation | `in_progress` | Wave A UI covers persisted resume, explicit completion, restart and tutorial return; API/browser acceptance pending | BUG-012, GAP-009 |
| Help/feedback | FAQ, categories, context help | `partial` | FAQ/feedback endpoints есть; UI/категории неполны | GAP-009 |
| Accessibility/responsive | 360px+, keyboard, WCAG AA, judge landscape | `broken` | public production и synthetic local viewport baseline сохранён; touch/contrast/semantics/layout defects остаются, axe/keyboard/judge landscape не пройдены | GAP-011, TECH-002 |
| Audit trail | Immutable security/sporting ledger | `partial` | dedicated match void ledger is append-only; generic technical audit remains mutable | — |
| API contract | Complete current OpenAPI and target spec | `verified` | Wave B source/OpenAPI inventory 68 operations / 61 paths, 100%; future product gaps remain independently tracked | OPS-001 |
| Database evolution | Versioned safe PostgreSQL migrations | `verified` | Immutable `0000`, ledger/lock/timeouts, fresh/upgrade/race tests и full PG16 gate green; public apply-only startup подтвердил exact ledger | DATA-003, OPS-004 |
| Backup/restore | Safe rehearsed recovery | `partial` | manual Free snapshot и exact aggregate restore comparison выполнены; restore непреднамеренно сменил primary branch identity, независимые ежедневные backups/RPO/RTO отсутствуют | OPS-003, Q-OPS-003 |
| Observability/readiness | Diagnose API/DB/requests/incidents | `partial` | PR1 добавляет DB-aware `/ready` и release identity без raw URL logging; structured request/incident observability остаётся неполной | OPS-002, OPS-004 |
| Deterministic CI | Full repeatable green quality gate | `verified` | `pnpm ci`: 820 passed, 0 failed/skipped/todo/interrupted; hosted run `34195797553` green на том же release SHA | TECH-001, TECH-002, OPS-004 |
| Runtime/build portability | One Node version across local/CI/hosting | `verified` | Node 24.20.0/pnpm 9.15.0, doctor/full gate, Render build/start и одинаковая release identity подтверждены | TECH-004, OPS-004 |
| Exact-SHA release delivery | Direct `main` → native-Git public stand → manual read-only smoke | `verified` | Render/Vercel Git integrations публикуют `main`; SHA `6892d6e` и version `1.10.1` совпали у web/API/proxy, smoke green | OPS-004 |

Изменение статуса требует evidence по [Definition of done](WORKFLOW.md#3-definition-of-done),
а не только закрытия связанного backlog item.
