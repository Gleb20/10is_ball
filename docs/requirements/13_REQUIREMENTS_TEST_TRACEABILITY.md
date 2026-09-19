# Requirements ↔ Tests Traceability

## Stage 3 WO4 — общий StatusChip sample, независимая приёмка ожидается

| Backlog / requirement | Existing regression | Browser evidence and limit |
|---|---|---|
| GAP-034; AT-UI-STATUS-001; U01-DETAIL-002/a01, U01-JUDGE-003/a03 | [patterns.test.tsx](../../apps/web/src/patterns.test.tsx): доменные labels/tone и неинтерактивный render; [HomePage.test.tsx](../../apps/web/src/pages/HomePage.test.tsx): карточки/ссылки, фильтры, pending/empty/error, D37 preview и `winnerSide` при совпадающих именах | [WO4 evidence](../audit/evidence/stage3-wo4/README.md): все 7 прямых consumers на 360/390/1440; 108 chip без caret/tab stop/own hover, с сохранёнными label/tone/height, cursor/action родителя и составным контрастом ≥4.90:1. Synthetic API не подтверждает права/persistence; локальные Judge/Team/Profile/bracket и доменные consumer этапы остаются открыты. |

Нового unit test только на prop/class не добавлено: существующие тесты проверяют
смысл, а фактический DOM/CSS/hover/cursor/contrast — browser evidence. Full Stage
3 gate, physical device/WebKit/spoken AT и независимое WO4 review ожидаются.

## Stage 3 WO3 R2 — адресный readback regression

| Backlog / requirement | Focused regression | Limit |
|---|---|---|
| BUG-021; TOURNAMENT-007, AT-TRN-004 | [TournamentDetailPage.algorithm.test.tsx](../../apps/web/src/pages/TournamentDetailPage.algorithm.test.tsx): POST v5 + GET без версии/с `invalid`/v4 сохраняет Dialog и запрет повторного POST; последующий явный GET v5 завершает обновление; unknown POST остаётся отдельной заблокированной веткой | [R2 Red/Green](../audit/evidence/stage3-wo3-r2/README.md). Визуальный R1 browser probe не перезаписан; PG и общий Stage 3 CI не проводились. |

## Stage 3 WO3 — локальный кандидат для независимой приёмки

| Backlog / requirement | Focused regression | Browser evidence and limit |
|---|---|---|
| BUG-026; MATCH-001/008, AT-MATCH-017 | [MatchCreatePage.test.tsx](../../apps/web/src/pages/MatchCreatePage.test.tsx): payload fields disabled при held POST и сохранены после известного отказа; [JudgePage.test.tsx](../../apps/web/src/pages/JudgePage.test.tsx): frozen two-step setup, confirmed start once, known setup rejection, unknown start/setup без повтора | [WO3 browser probe](../audit/evidence/stage3-wo3/README.md): 390 px captured payload и held controls; API ответа синтетический, PostgreSQL не проверялась. |
| BUG-026; TOURNAMENT-005/007, AT-TRN-004 | [TournamentDetailPage.algorithm.test.tsx](../../apps/web/src/pages/TournamentDetailPage.algorithm.test.tsx): выбранный участник удержан при held add и известном отказе | [WO3 browser probe](../audit/evidence/stage3-wo3/README.md): 390 px, клиентское чтение из синтетического in-memory store после явной повторной отправки. |
| BUG-021; TOURNAMENT-007, AT-TRN-004, AT-UI-001 | [TournamentDetailPage.algorithm.test.tsx](../../apps/web/src/pages/TournamentDetailPage.algorithm.test.tsx): ошибка внутри Dialog; unknown POST остаётся заблокированным после GET, confirmed POST с failed readback разблокируется только после актуального GET; поздний ответ старого route игнорируется | [WO3 browser probe](../audit/evidence/stage3-wo3/README.md): production preview 360/390/1440, Tab/ShiftTab/Escape/focus и прокрутка footer; WebKit, spoken AT и backend receipt не проверялись. |
| BUG-024; JUDGE-011, AT-UI-001 | [JudgePage.test.tsx](../../apps/web/src/pages/JudgePage.test.tsx): две native label связаны с разными correction input | [WO3 browser probe](../audit/evidence/stage3-wo3/README.md): actual immersive shell 360/390/1440, ошибка 7.50:1 и подписи 15.47:1. |

WO3 focused tests, web suite, typecheck и build прошли локально; совокупный Stage 3 CI и независимое review ожидаются. BUG-041 записан как отдельный открытый dev StrictMode debt без утверждения о production-дефекте.

## Stage 3 WO2 R2 — review correction Red/Green

| Backlog / requirement | Focused regression | Browser evidence and limit |
|---|---|---|
| BUG-028; AUTH-004/005; AT-AUTH-003/009 | [AuthFocus.wo2r2.test.tsx](../../apps/web/src/pages/AuthFocus.wo2r2.test.tsx): repeated unchanged mismatch Red→Green; one Alert per explicit submit, same DOM inputs/values/associations, edit without focus theft, Tab/ShiftTab; repeated generic login refusal | [R2 focus/font](../audit/evidence/stage3-wo2-r2/README.md): Chromium 360 repeated focus false→true and four input fonts 14/16/16/16→16/16/16/16. R1 password-only font statement superseded; physical iPhone/OS autofill/WebKit/AT remain unverified. |
| BUG-040 AUTH-003 portion | Browser per-input computed-style probe | Scoped AuthLayout minimum 16 px verified locally; persistent iPhone zoom and Judge landscape remain open device gates. |

WO2 R1 and WO1 evidence remain immutable; aggregate Stage 3 CI and independent
R2 review are pending.

## Stage 3 WO2 — локальный auth Green, независимая приёмка ожидается

| Backlog / требование | Focused regression | Browser/API evidence and limit |
|---|---|---|
| BUG-027; AUTH-003/006; AT-AUTH-001/009 | [AuthPages.wo2.test.tsx](../../apps/web/src/pages/AuthPages.wo2.test.tsx): один logout, 401 как завершённая сессия, общая защита Save/Logout, известный отказ с сохранением полей | [Real API Red/Green](../audit/evidence/stage3-wo2/README.md): in-memory PGlite, старый 0 POST + `/me` 200, новый 1 POST + текущий `/me` 401, другая сессия 200, Back показывает Login. Публичный стенд не мутировался. |
| BUG-028; AUTH-004/005; AT-AUTH-003/009 | [AuthPages.wo2.test.tsx](../../apps/web/src/pages/AuthPages.wo2.test.tsx): Alert/focus, mismatch/policy associations, перевод reasons, generic credentials, независимое раскрытие, held Login; [auth-recovery.test.tsx](../../apps/web/src/auth-recovery.test.tsx): route/query/hash, same-actor draft, other-actor clean tree, no mutation replay | [Chromium state matrix](../audit/evidence/stage3-wo2/auth-states.json): 10 form cases и [pending](../audit/evidence/stage3-wo2/pending-states.json) 2 cases; 360/390/1440 и CSS zoom200. Autofill/physical iPhone/WebKit/spoken AT не проверены. |
| BUG-040 AUTH-003 portion | [AuthPages.wo2.test.tsx](../../apps/web/src/pages/AuthPages.wo2.test.tsx): touch target/reveal semantics | 360/390 и CSS zoom200 показали достижимую карточку и отсутствие горизонтального overflow; persistent zoom и Judge landscape остаются открытым device gate. |

Совокупный Stage 3 CI и независимое WO2 review ожидаются; локальный Green не
повышает статусы до `verified_local` или `verified_prod`.

## Stage 3 WO1 — локальный Green, независимая приёмка ожидается

| Backlog / требование | Focused regression | Браузерная проверка / предел |
|---|---|---|
| BUG-018; MATCH-001/003, AT-MATCH-013/016 | [ui.a11y.test.tsx](../../apps/web/src/ui.a11y.test.tsx): уникальный active IDREF, hidden Enter, disabled и Tab; [MatchCreatePage.test.tsx](../../apps/web/src/pages/MatchCreatePage.test.tsx) и [MatchDetailPage.test.tsx](../../apps/web/src/pages/MatchDetailPage.test.tsx): тот же DOM input и фокус после Enter; существующий GAP-008 test сохраняет prefill | [Dialog geometry](../audit/evidence/stage3-wo1/geometry.json): keyboard/touch 360/390/desktop. Spoken AT не проверена. |
| BUG-019; AT-MATCH-016 | [R2 real-component Red/Green](../audit/evidence/stage3-wo1-r2/README.md): короткий 120 px clip, скрытая 20-я option и повторный scrollIntoView → fixed fallback, hit test, `u20`, без scroll trap | Page 360/390/1280 и 390×500 height approximation, Dialog 360/390/1280, empty status и manual scroll в [R2 measurements](../audit/evidence/stage3-wo1-r2/full-regression.json). Физическая клавиатура/safe area и WebKit не проверены. |
| BUG-020, AUTH-004/a01; NFR §9–10 | [BracketAlgorithmDialog.test.tsx](../../apps/web/src/components/BracketAlgorithmDialog.test.tsx) сохраняет checked/disabled semantic regression | [R1 state matrix](../audit/evidence/stage3-wo1/matrix.json) и [R2 360/reflow](../audit/evidence/stage3-wo1-r2/states-360.json): focus+error, selected picker/radio-card, CSS zoom 200% при effective width 360. Mixed-theme diagnostic не устанавливает production defect или cause; приложение фиксирует light theme. Browser UI zoom/WebKit/device/AT не проверены. |
| BUG-023; TOURNAMENT-003/004, MATCH-001/002 | [ui.a11y.test.tsx](../../apps/web/src/ui.a11y.test.tsx): order/case, duplicate IDs и non-option zero status; [UserPicker.test.tsx](../../apps/web/src/components/UserPicker.test.tsx): reversed name с прежними exclusions | [Tournament/team picker](../audit/evidence/stage3-wo1/picker.json): 390/desktop, correct ID and focus. |
| BUG-025; TOURNAMENT-005/007, TEAM-003/004, AT-TRN-004, AT-TEAM-001/002 | [UserPicker.test.tsx](../../apps/web/src/components/UserPicker.test.tsx): held GET, empty/error/retry, obsolete actor/exclusion response, focus success/failure/moved elsewhere; [JudgePage.test.tsx](../../apps/web/src/pages/JudgePage.test.tsx): native handover loading/error/retry | [Picker](../audit/evidence/stage3-wo1/picker.json) 390/desktop и [judge](../audit/evidence/stage3-wo1/judge.json) landscape/desktop; public mutation не выполнялась. |

Полный web unit suite 261/261, typecheck и build прошли на WO1 delta; это
локальное implementation evidence, не отдельная приёмка всего stage 3.

## Интерфейсная программа D36/D37 — stage 2 accepted locally

| Новый target | Acceptance | Текущее свидетельство | Coverage / backlog |
|---|---|---|---|
| HOME-007 и обновлённые HOME-001/002/004 | AT-HOME-001..003 | [Stage 2 final receipt](../audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json): R2 Red→Green `HomePage.test.tsx` 10/10 проверяет pending/error ссылки, стороны/счёт, winnerSide при одинаковых именах, 2×2 и особые исходы; `home.integration.test.ts` 9/9 проверяет 55 личных результатов, крупную чужую admin сетку с bounded projection и legacy topThree без full-detail fanout, guest/registered names и active/expired judge. `stage2-home.spec.ts` прошёл в compiled desktop/390 CI 1291/1291; Terra/root PASS. HOME-004/a01 связан с AT-HOME-001. Browser Back Judge и HOME-003 Maps/iPhone остаются явными остатками. | 23 user atoms `verified_local`; current GAP-015 target verified_local, GAP-030/031 in_progress по остаткам |
| UI-001 статусные чипы и иконки всех поверхностей | AT-UI-STATUS-001 | [WO4 inventory/target и common sample](../audit/evidence/stage3-wo4/README.md): inventory/target приняты, общий `StatusChip` реализован и проверен во всех семи прямых consumers; доменные Judge/Team/Profile/bracket/notifications, device и spoken-AT проверки остаются последующим этапам | `partial`; common sample готов к aggregate review, GAP-034 и соответствующие GAP-017/032 и экранные work orders сохраняют явные остатки |
| TOURNAMENT-020 phase composition | AT-TRN-024 | T01/T02 rules/roster и T03/T04 generated/active source review; runtime ещё не выполнен | `partial`; один GAP-019 scope A stage 7, scope B stage 8 |
| UI-доступность D37 поверх MATCH-003/014, TOURNAMENT-001, NOTIF-005 | AT-UI-INV-001/002 | GAP-029 PGlite `gap-008-notifications`9/9, FAQ4/4, PG `gap-008` в общем PG72/72, component web235/235 и desktop/390 browser50/50 в fresh `ci`1264/1264. Mixed hidden/visible count/first five, legacy/opt-in read-visible, pending/readAt и deep links проверены; Terra PASS и coordinator visual acceptance. | Шесть GAP-029 stage-1 atoms `verified_local` через evidence overlay; серверной пагинации нет, subsequent-page target AT-UI-INV-002 остаётся `partial`; GAP-018 blocked_decision |
| Onboarding после удаления tabs | AT-ONB-004 | `onboarding-resume.test.tsx` и `wave-e-user.spec.ts` прошли в stage 2 compiled desktop/390 CI 1291/1291; [receipt](../audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json). | `verified_local` для stage 2 anchors; broader GAP-030 Browser Back residual |

Полная [программа](../test-plans/TECH-008-interface-programme.md) и
[coverage](../audits/2026-09-13-ux-ui/implementation/coverage.csv) являются
планом и трассировкой источников. Stage 1 подтверждён только локальным
[receipt](../audit/evidence/gap029-stage1-final.json) и
[implementation-results.json](../audits/2026-09-13-ux-ui/implementation/implementation-results.json);
stage 2 — локальным [receipt](../audits/2026-09-13-ux-ui/implementation/stage2-final-evidence/stage2-final-receipt.json).
Остальные новые targets не подтверждены этими результатами.

Обновлено **2026-09-15**. Таблица показывает существующий
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
| MATCH-001..017 | AT-MATCH-001..017, START/STOP, CANCEL-001..004, VOID-001..004 | Wave C baseline remains. GAP-012 focused service/API/component tests cover C-owned A-vs-B, default no-invite, voluntary nonblocking invitations, start terminalization, challenge/revenge defaults and nonplaying-owner edit. Final local gate passed 1257/1257, including the desktop/390 browser journey; public verification and the user research session remain pending. | `partial` | GAP-005, GAP-012 (`verified_local`) |
| JUDGE-001..012 | AT-JUDGE-001..010; two-client browser lifecycle | Wave C full gate1056/1056: quality980, PostgreSQL47, browser25 (16 compiled journeys +9 foundation). GAP-005 service12/12, real-PG concurrency5/5, options/OpenAPI6/6, shared13/13. `tests/e2e/wave-c.spec.ts` covers grouped 2v2/no-show/revenge, correction/undo/handover and separate creator/club-judge start at desktop/390; persisted state and rendered captures checked. | `verified` | GAP-005 (`verified_local`) |
| TOURNAMENT-001..019 | AT-TRN-001..023 and AT-MATCH-VOID-004; deterministic V2 SE/DE E2E | Wave D baseline remains. GAP-012 focused API/PGlite plus PostgreSQL5/5 cover immutable policy, scoped admin, provenance/audit, rollback, idempotency, both invite/add orders, start/add and concurrent add/add with seed preservation. Final local gate passed 1257/1257, including the desktop/390 browser journey; public verification and the user research session remain pending. | `partial` | GAP-006, GAP-012 (`verified_local`) |
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
starts. This sentence records the historical Wave E fixture. D35/GAP-012 supersedes
the start gate: current fixtures use direct selection by default and create/accept an
invitation only when that invitation lifecycle is the subject under test.

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

### GAP-012 operator-first evidence checkpoint

`gap-012.integration.test.ts` covers service and HTTP contracts, minimal admin DTO,
409 confirmations, provenance/audit, exact replay/key reuse, new-post-start zero
writes and PGlite fault rollback. `gap-012.postgres.integration.test.ts` contains5
deterministic PostgreSQL cases for both invitation/manual-add orders, start/add,
real regeneration/replay and concurrent add/add. Component coverage is in
`MatchCreatePage.test.tsx`, `MatchDetailPage.gap008.test.tsx` and
`TournamentSetup.gap012.test.tsx`; compiled desktop/390 journeys are in
`gap-012.spec.ts` and the updated `wave-e-user.spec.ts`. Migration coverage includes
fresh/current/pre-0006/adoption/idempotent apply and disposable rollback. Final
coverage/status is updated only after the full gate.

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

### Stage 3 aggregate and delayed-directory correction — 2026-09-19

The Stage 3 UI work maps BUG-018/019/020/023/025 to MATCH-001/003 and AT-MATCH-013/016, BUG-021/022/026 to the bracket and async-mutation contracts, BUG-024 to JUDGE accessibility, BUG-027/028 to AUTH-001/002/004, and the bounded GAP-034 sample to AT-UI-STATUS-001. Exact work-order mappings remain in their backlog entries and evidence READMEs.

`MatchCreatePage.test.tsx` and `MatchDetailPage.test.tsx` add deterministic late-directory coverage for a typed query, untouched selected labels, explicit selection, clear and external slot identity changes. The final focused result is 32/32 and final quality is 1193/1193. The aggregate PostgreSQL result is 72/72; the subsequent correction changed frontend code and tests only.

Browser evidence must be read in order. The first 60/60 + 9 foundation result belongs to the pre-correction frontend tree. The first corrected-tree run had 59/60 + 9 foundation: one desktop GAP-012 first-option timeout had no proven source cause. The final authorized original-order corrected-tree run passed 60/60 + 9 foundation on fresh disposable PostgreSQL; passive desktop/mobile captures retained query, input identity and normal selection. That green run does not establish the earlier timeout's cause or prove it harmless, pre-existing or fixed. The separate four-phase filled-suggestion matrix passed 4/4 + 9 foundation with a 476 px synthetic UI region as supporting discrimination. Its `vendorDOMShapeMatches` flag is invalid for editable ic-kit fields; raw geometry and event ordering retain that explicit limitation. See [`stage3-final-regression`](../audit/evidence/stage3-final-regression/README.md).

The final full-browser run is green. This checkpoint does not claim a successful single-command `pnpm run ci`, physical iPhone, WebKit or spoken-AT coverage. Canonical local statuses and the four residual rows are recorded in the backlog and project status.
