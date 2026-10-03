# Capability matrix

Снимок на **2026-10-03**. Это оценка end-to-end способности, а не наличия файла
или зелёного unit test.

GAP-029/D37 версия 4.0.0 опубликована и подтверждена [public receipt](audit/evidence/gap029-stage1-public.json).
GAP-015 и реализованная часть GAP-030/031/D36 версии 4.1.0 приняты локально:
[stage 2 final receipt](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json)
содержит CI 1291/1291, Terra и root PASS. GAP-030 остаётся partial из-за
Browser Back Judge, GAP-031 — из-за невоспроизведённого HOME-003 Maps/iPhone;
версия 4.1.0 опубликована с exact-SHA read-only smoke на web/API/proxy и
готовой БД: [public receipt](audit/evidence/stage2-public.json). Это не
публичная пользовательская приёмка. Исторические release-свидетельства ниже
относятся к соответствующим прежним версиям.
Первый hosted CI на application SHA завершился `failure` в browser lane из-за
строгого тестового локатора; [локальная коррекция](audit/evidence/stage2-ci-correction.json)
прошла 69/69, новый hosted release gate ожидается после review.

Статусы: `verified` — целевой сценарий подтверждён на достаточном уровне;
`partial` — полезная часть работает, покрытие неполно; `broken` — реализация есть,
но существенный дефект нарушает сценарий/безопасность; `missing` — требуемой
возможности нет; `unknown` — данных для вывода недостаточно.

| Capability | Target | Status | Evidence / ограничение | Backlog |
|---|---|---|---|---|
| Production web/API reachability | Web → Vercel rewrite → Render API | `verified` | [OPS-004 release evidence](audit/evidence/ops-004-public-release.json): web/API/proxy exact SHA/version и read-only smoke green | OPS-004, OPS-005 |
| Local account login | Active user входит по email/password | `partial` | temporary-password gate uses exact method+router path; broader rate/session hardening remains | TECH-003 |
| Admin account lifecycle | create/role/block/unblock/reset, safe detail/audit | `verified` | Stage 14 adds admin-only account card, allowlisted 20-row audit cursor, catalog-first hierarchy and actor/route/reauth fences. Focused web88/88, PostgreSQL90/90 and compiled 1440/390/360 browser pass; [candidate receipt](audit/evidence/stage14-final-candidate/receipt.json) keeps the exact lane history. Public parity/device/AT remain separate. | SEC-004, BUG-011, GAP-010, GAP-026, GAP-027 |
| Session management | sliding session, list/revoke/change password | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-002 |
| Own profile | view/edit/stats/avatar/sessions | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-002 |
| Public player profile | privacy-safe card; challenge temporarily hidden by D37 | `verified` | Historical Wave B local/release evidence for card; GAP-029 local 1264/1264 and public 4.0.0 receipt verify hidden challenge. | GAP-002, GAP-029 |
| Home dashboard | compact identity, direct actions, all current role tasks, recent/ranking | `partial` | D36 stage 2 implementation accepted locally: [1291/1291 aggregate and review](audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json); 23 user atoms verified_local, including loading/error links, bounded tournament projection and server-side winner mark. Version 4.1.0 release identity is [publicly verified](audit/evidence/stage2-public.json); GAP-015 remains verified_local and broader GAP-031 remains open for HOME-003 Maps/iPhone reproduction. | GAP-001, GAP-015, GAP-031 |
| Global navigation and contextual return | Home entry and source-aware History/team/admin/bracket return with safe Judge exit | `partial` | Stage 14 locally verifies fresh-read scroll/focus return and direct-target invalidation for History, Teams and Admin. Stage 2 bracket return remains; native Browser Back from Judge leaves active judge slot and its remaining recovery belongs to stage 6. | GAP-030, GAP-017, GAP-022, GAP-024, GAP-027 |
| Rankings | all/week/month and team ranking | `verified` | Wave B local 1010/1010 gate and strengthened browser 19/19 passed; desktop/390 rendered review accepted. Released 2.0.0 at 8f36941; read-only exact-SHA smoke and CI34728440590 passed. | GAP-004 |
| Event visibility | Active scoped; completed visible active club-wide | `partial` | API list/detail/home enforce organizer/participant/current-judge active scope and club-wide terminal visibility; full history UX remains | GAP-003 |
| Match creation | Operator-owned valid 1v1/2v2 roster and rules; invitations temporarily hidden by D37 | `partial` | GAP-029 local 1264/1264: browser manual setup without UI invitations, legacy API and rows preserved; broader match completion scope remains. | BUG-010, GAP-005, GAP-012, GAP-029 |
| Match start | Only creator/organizer starts valid match | `verified` | server actor matrix rejects participant/judge/outsider/admin without ownership | — |
| Judge acquire/score/undo/finish | One live judge; reliable score lifecycle | `verified` | Wave C1056/1056 local gate; two-client handover/creator start, PostgreSQL races and technical undo history | BUG-004, BUG-005, GAP-005 |
| Early stop | Organizer or active judge chooses winner/reason | `verified` | participant rejected; creator/current active judge accepted by API matrix | — |
| Cancel | Active admin or creator; optional reason; explicit confirmation | `verified` | server CAS/idempotency/actor matrix and named confirmation covered | — |
| Finished-result correction | Admin/creator void + confirmation + immutable audit + stats compensation | `partial` | standalone and D33 tournament policy implemented with one-time compensation and downstream-preservation tests | GAP-005 |
| Match history | visible feed, participant context, filters/search/pagination | `verified` | Stage 14 adds both 1×1/2×2 side snapshots, search over all participants before limit, literal wildcard handling, calendar and PostgreSQL offset cursor validation, and readable per-side scores. PGlite8/8, PostgreSQL90/90 and compiled 1440/390/360 plus CSS zoom 200% pass; [candidate receipt](audit/evidence/stage14-final-candidate/receipt.json). Published parity pending. | GAP-003, GAP-024 |
| Bracket generation algorithms | V2 SE/DE compact/Po2; bounded rejection of V1 DE | `verified` | Wave D final local gate 1135/1135 and rendered desktop/390/landscape review cover V2 SE/DE 3/5/8, seed/BYE swaps, invalidation/regeneration, terminal auto-BYE suppression and D25 fail-closed legacy V1 DE. Public Wave D release remains pending. | DATA-006, GAP-006 |
| Tournament organizer lifecycle | create/policy/roster/settings/generate/start/play/stop/cancel/dissolve | `partial` | Wave D lifecycle remains; GAP-012 adds immutable consent policy, audited/idempotent confirmed add and atomic post-bracket regeneration. Focused PGlite and PostgreSQL races pass; fresh browser/full gate pending. | BUG-015, GAP-006, GAP-012 |
| Tournament scoped admin add | Minimal catalog/roster view and confirmed registered-user add only | `partial` | GAP-012 API/service tests prove minimal DTO, actor matrix, confirmation and audit; desktop/390 journey/full gate pending. | GAP-012 |
| Tournament visibility/history | То же правило event visibility | `verified` | active scope and club-wide terminal API matrix implemented | — |
| Teams | captain/invite/member/leave/archive/use-in-event | `verified` | Stage 14 preserves Wave D lifecycle and adds list-first creation, named remove/transfer confirmation, local unknown-outcome GET-only review and token-bound return. Focused web88/88 and compiled 1440/390/360 pass; public parity pending. | DATA-004, GAP-007, GAP-022, BUG-034, BUG-035 |
| Notifications | actionable available items/read/expiry/popup under D37 | `partial` | GAP-029 local 1264/1264 and public 4.0.0 receipt cover mixed hidden/visible count and first five, legacy/opt-in reads, PG persisted rows and desktop/390 recovery. Future server pagination/subsequent-page AT-UI-INV-002 remains open. | BUG-013, GAP-008, GAP-029 |
| Onboarding | once/resume/skip/restart/tutorial isolation | `verified` | Wave E functional local acceptance1229/1229 successful lanes, including38 desktop/390 browser journeys; fresh F gate1249/1249 also passes; public release and full compatibility/device acceptance remain separate | BUG-012, GAP-009 |
| Help/feedback | FAQ, categories, context help | `verified` | Wave E functional local acceptance1229/1229 successful lanes, including38 desktop/390 browser journeys; fresh F gate1249/1249 also passes; public release and full compatibility/device acceptance remain separate | GAP-009 |
| Accessibility/responsive | 360px+, keyboard, WCAG AA, judge landscape | `partial` | F shared geometry/contrast/focus/judge/bracket fixes pass fresh1249/1249 and Firefox7/7; WebKit native page creation fails7 cases, latest-two/device/AT and axe incomplete checks remain. [Evidence](audit/evidence/wave-f-local.json) | GAP-011, TECH-002 |
| Audit trail | Immutable security/sporting ledger | `partial` | dedicated match void ledger is append-only; generic technical audit remains mutable | — |
| API contract | Complete current OpenAPI and target spec | `verified` | Fresh Stage 14 route inventory: 86 operations /76 paths, full match to current OpenAPI; BUG-017409 mapping included | OPS-001, BUG-017 |
| Database evolution | Versioned safe PostgreSQL migrations | `verified` | Immutable `0000`, ledger/lock/timeouts, fresh/upgrade/race tests и full PG16 gate green; public apply-only startup подтвердил exact ledger | DATA-003, OPS-004 |
| Backup/restore | Safe rehearsed recovery | `partial` | manual Free snapshot и exact aggregate restore comparison выполнены; restore непреднамеренно сменил primary branch identity, независимые ежедневные backups/RPO/RTO отсутствуют | OPS-003, Q-OPS-003 |
| Observability/readiness | Diagnose API/DB/requests/incidents | `partial` | PR1 добавляет DB-aware `/ready` и release identity без raw URL logging; structured request/incident observability остаётся неполной | OPS-002, OPS-004 |
| Deterministic CI | Full repeatable green quality gate | `verified` | Final Stage 14 exact R2 `pnpm run ci` passed1531/1531: quality1323, PostgreSQL90, compiled browser114 and cleanup4, with no failed/skipped/todo/interrupted; Terra review PASS. The earlier aggregate failure remains in the [candidate receipt](audit/evidence/stage14-final-candidate/receipt.json). Hosted exact-tree CI awaits publication; historical released CI evidence remains separate. | TECH-001, TECH-002, OPS-004 |
| Runtime/build portability | One Node version across local/CI/hosting | `verified` | Node 24.20.0/pnpm 9.15.0, doctor/full gate, Render build/start и одинаковая release identity подтверждены | TECH-004, OPS-004 |
| Exact-SHA release delivery | Direct `main` → native-Git public stand → manual read-only smoke | `verified` | Render/Vercel Git integrations публикуют `main`; SHA `6892d6e` и version `1.10.1` совпали у web/API/proxy, smoke green | OPS-004 |

Изменение статуса требует evidence по [Definition of done](WORKFLOW.md#3-definition-of-done),
а не только закрытия связанного backlog item.
