# MATCH handoff

Статус пакета: `READY_FOR_REVIEW`. Это аудит и готовые формулировки для последующего канонического backlog synthesis; приложение, requirements, backlog и release state не изменялись. Не назначать новые canonical IDs до coordinator review/dedupe.

## Что читать

1. `report.md` — выводы, границы и dedupe.
2. `runs.csv` + `evidence/driver-log.json` — фактические прогоны.
3. `findings.json` — четыре пакетные находки.
4. `target-spec.md` + `wireframes.html` — точный target без redesign.
5. `requirement-coverage-delta.csv` — MATCH-001…017.
6. `flow-report.html` — автономная карта as-is/proposed.

Baseline: frozen export `/private/tmp/tab10-ux-audit-dispatch-v1`, `manifest.json` SHA-256 `c39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6`, base HEAD `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`, accepted GAP012r6 1257/1257, application fingerprint из frozen `candidate-source.json` `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.

## Dedupe map

- F-MATCH-001 объединять с GAP-013/F-PILOT-001, не создавать отдельный fix для каждого shortcut.
- F-MATCH-002 — новая MATCH finding; автоинвайт после edit запрещён. Target только explicit creator-only row action.
- F-MATCH-003 — новая MATCH finding по cancel lifecycle.
- F-MATCH-004 — pending ADMIN/decision; D17 нельзя расширять молча.
- F-PILOT-002/F-PILOT-003 — принятые pilot findings для detail/result hierarchy; пакет уточняет target, но не создаёт дубль.
- BUG-025 — async directory; BUG-026 — editable payload controls during pending; BUG-018 — popup ownership/focus; BUG-023 — name-order search; BUG-024 — dark judge contrast. Новые MATCH IDs для них не нужны.

## Backlog-ready candidate 1 — дополнить GAP-013 target создания

### TASK-CANDIDATE-MATCH-01 — состав и scoped shortcuts предшествуют редким правилам

**Type:** GAP refinement / UX structure
**Priority:** P2
**Status:** ready_for_synthesis
**Evidence:** F-MATCH-001; F-PILOT-001; `evidence/m01-create-before-top-390.json`; `evidence/m02-quick-choices-390.png`
**Expected:** На 390px пользователь видит начало `Состав` сразу после контекста/формата; быстрый выбор явно называет изменяемый slot и не перезаписывает непустой slot без confirmation/preview; rules остаются полностью доступны после состава.
**Actual:** Первый roster начинается на y=956.5 при viewport 844; rules/help и shortcuts идут раньше; person/team shortcut не называет destination и пишет Side B.
**Repro:** M01/M02 из `runs.csv`.
**Risk:** Изменение DOM/focus order может задеть challenge/revenge prefill, autocomplete и 1v1↔2v2 reset.
**Verification:** Focused component tests + browser 390/1440 для manual/challenge/revenge, registered/guest, team/person shortcut, populated-slot confirmation, loading/error/retry; затем пакетный web gate.
**Dependencies:** Existing GAP-013; BUG-018/023/025/026 должны быть учтены как shared contracts, не обязательно реализованы в одной задаче.

Scenario / Epic / Story / Sprint: SC-M01/SC-M02; MATCH create.
User outcome / Non-goals: Оператор сначала собирает стороны и понимает эффект shortcut. Не менять фирменный стиль, API, invitation semantics или server draft policy.
Inputs: MATCH-001…005/014/015; AT-MATCH-013/015/016/017; D35; `target-spec.md#t-match-create`; candidate fingerprint.
Roles and permissions: active creator; manual creator may remain outside roster; challenge/revenge creator is participant.
States and edge cases: 1v1/2v2, empty/populated slots, duplicate/self/inactive/busy, guest, long names, no teams/recent/frequent, directory loading/error/retry, pending submit, narrow/desktop.
API/types/data: none expected; preserve create-options and create payload.
Constraints and forbidden shortcuts: no hidden retained 2v2 values after switch to 1v1; no auto-invite; no CSS-only reorder that leaves wrong keyboard order; no shared component fork.
Subtasks:
1. Reorder create blocks and tests; output DOM order; check accessible heading/focus sequence.
2. Scope person/team shortcuts to active destination with preview/overwrite confirmation; output deterministic slot mutation tests.
3. Preserve challenge/revenge/manual defaults and error/pending states; output browser evidence at 390/1440.
Acceptance:
- Given manual 2v2 on 390, when create loads, then context/format and beginning of Side A precede advanced rules.
- Given a focused empty Side B slot, when a recent opponent is chosen, then only that named slot changes.
- Given a team and two target slots, when preview is confirmed, then displayed members match persisted participants.
- Given any destination is populated, when shortcut is activated, then no overwrite occurs before explicit confirmation.
- Given challenge/revenge, when page loads, then creator and purposeful invitation defaults remain unchanged.
Evidence required: before/after 390+1440 screenshots, accessibility/focus assertions, create payload and persisted participant state.
Documentation updates / rollback: GAP-013, traceability if tests change, CHANGELOG_DEV; rollback is isolated structural/component revert.
Risks / open decisions: none.

## Backlog-ready candidate 2 — явное post-edit invitation action

### TASK-CANDIDATE-MATCH-02 — создатель явно приглашает добавленного registered participant

**Type:** UX defect / lifecycle affordance
**Priority:** P2
**Status:** ready_for_synthesis
**Evidence:** F-MATCH-002; `evidence/m04-roster-invitation-lifecycle.json`; `evidence/m04-explicit-replacement-invite-1440.png`
**Expected:** После roster edit creator видит у eligible registered participant без actionable invitation row-scoped `Пригласить`; action создаёт pending invitation и показывает success/error state. Никакой edit/create history не включает автоматическую отправку.
**Actual:** Replacement корректно добавляется без auto-invite, но UI не даёт creator вызвать существующий authorized `POST /matches/:id/invitations` для новой строки.
**Repro:** M04: заменить pending participant, сохранить, проверить detail actions; затем сравнить с API-created invitation.
**Risk:** Дублирование pending invite, неверная видимость для guest/не-creator/terminal match, гонка со start/cancel.
**Verification:** Service/API authorization and lifecycle tests; component actor/state matrix; PostgreSQL integration for duplicate/concurrent action; browser pending/success/error/retry and start/cancel transition.
**Dependencies:** MATCH; notification lifecycle; D35/AT-MATCH-017.

Scenario / Epic / Story / Sprint: SC-M03/SC-M04; invitation after roster edit.
User outcome / Non-goals: Creator может осознанно уведомить нового игрока. Не сохранять `invitePlayers` как policy, не отправлять автоматически, не gate start.
Inputs: MATCH-003/008; AT-MATCH-017; D35; current invitation endpoint/auth; `target-spec.md#t-match-edit-invite`.
Roles and permissions: только creator на waiting standalone; active registered target in roster; guest не eligible; participant/judge/admin без creator role не получают action автоматически.
States and edge cases: no invitation, pending, accepted, declined/expired, removed participant, start/cancel during request, duplicate click, stale version/session, API error.
API/types/data: использовать существующий endpoint/contract; если contract не покрывает idempotent duplicate/concurrency, расширение должно быть отдельно доказано, без schema speculation.
Constraints and forbidden shortcuts: no auto-send; no start gate; no invitation for guest; no client-only fake pending row.
Subtasks:
1. Подтвердить current authorization/lifecycle endpoint тестом; output actor/state contract.
2. Добавить creator-only row action и pending/error state; output component tests.
3. Проверить persisted invitation + notification и start/cancel cleanup на PostgreSQL.
4. Провести browser replay at 390/1440.
Acceptance:
- Given waiting match and creator adds registered D without invitation, when detail opens, then D row offers `Пригласить` and no request has yet been sent.
- When creator activates once, then exactly one pending player invitation linked to D participant persists and UI shows it.
- Given guest, non-creator, terminal match or existing pending/accepted invitation, then generic Invite is absent/disabled according to contract.
- Given start/cancel wins concurrently, then no actionable orphan remains and UI refreshes canonical state.
Evidence required: API/integration receipts, role screenshots, persisted invitation/notification record, duplicate/concurrency result.
Documentation updates / rollback: API as-built only if contract changes; traceability; CHANGELOG_DEV. Rollback row action/UI and any separately accepted contract delta.
Risks / open decisions: none.

## Backlog-ready candidate 3 — точный cancel dialog

### TASK-CANDIDATE-MATCH-03 — cancel отличается от void и сохраняет optional reason

**Type:** UX defect / destructive safeguard
**Priority:** P2
**Status:** ready_for_synthesis
**Evidence:** F-MATCH-003; `evidence/m04-cancel-confirm-390.png`; `evidence/m04-cancel-persisted.json`
**Expected:** Confirmation использует `отменить/отменён`, объясняет no winner/stats и release, принимает optional reason; close не мутирует; confirm использует expectedVersion/idempotency и обрабатывает stale.
**Actual:** Mutation безопасна, но body говорит `аннулирован`, reason control отсутствует.
**Repro:** M04 из `runs.csv`.
**Risk:** Ошибочное изменение void copy/shared dialog, двойной submit, потеря focus, причина не доходит до audit.
**Verification:** Dialog component tests, API contract absent/supplied reason, PostgreSQL cancel atomicity/replay, browser creator success/no-op/stale/unauthorized at 390 and desktop.
**Dependencies:** MATCH-017; AT-MATCH-CANCEL-001…004; D23.

Scenario / Epic / Story / Sprint: SC-M04; standalone cancel.
User outcome / Non-goals: Оператор понимает именно cancel и может добавить контекст. Не менять actor rights, tournament restriction, void/stop semantics.
Inputs: `target-spec.md#t-match-cancel`; current cancel endpoint; shared dialog behavior.
Roles and permissions: creator and, после отдельного решения recovery path, active admin; others 403/no action.
States and edge cases: waiting/in_progress/pending_confirmation, absent/long reason, X/Escape/secondary close, pending, stale, duplicate key, concurrent different key, tournament.
API/types/data: передать optional reason через существующий contract; сохранить expectedVersion + Idempotency-Key.
Constraints and forbidden shortcuts: no `аннулировать`; no request on first click/close; no optimistic terminal state before server success.
Subtasks:
1. Исправить copy/field/focus and component tests.
2. Проверить reason mapping and idempotency/atomic release integration.
3. Browser actor/state/no-op/stale replay.
Acceptance:
- Given eligible creator, first Cancel opens exact dialog and sends zero mutation requests.
- Given close/X/Escape, match/version remain unchanged and focus returns.
- Given supplied or absent reason, confirm persists exactly one cancelled outcome without winner/stats and releases judge/player occupancy.
- Given stale/unauthorized/tournament, no mutation occurs and UI gives correct recovery/error without leaking rights.
Evidence required: request count, persisted state/audit, screenshots 390/1440, focus assertion.
Documentation updates / rollback: requirements only if approved accepted behavior changes; traceability; CHANGELOG_DEV.
Risks / open decisions: none for creator path; admin discovery belongs candidate 5.

## Backlog-ready candidate 4 — role-aware detail hierarchy

### TASK-CANDIDATE-MATCH-04 — primary action precedes agreements/log and terminal next step is reachable

**Type:** UX hierarchy
**Priority:** P2
**Status:** ready_for_synthesis
**Evidence:** accepted F-PILOT-002/F-PILOT-003; `evidence/m03-waiting-creator-390.png`; `evidence/m06-role-action-matrix.json`; `../pilot/evidence/p24-finished-390.png`
**Expected:** Score/context → one role/state primary action → secondary/destructive actions → agreements → log; finished eligible participant sees Revenge, nonplaying creator sees New match, navigation is secondary.
**Actual:** Agreements and empty log precede actions; waiting creator sees several similar-weight actions; nonplaying creator terminal next-game path is only global navigation.
**Repro:** M03/M06 plus accepted pilot.
**Risk:** Accidental authorization changes or hiding rare actions.
**Verification:** Role/status component matrix, keyboard order, 390/1440 browser states, no capability loss.
**Dependencies:** MATCH; JUDGE/RESULTS shared surfaces; no scoring redesign.

Scenario / Epic / Story / Sprint: SC-M01/SC-M04; waiting and terminal detail.
User outcome / Non-goals: Следующее допустимое действие видно без поиска. Не менять rights, status machine, scoring, result data or visual brand.
Inputs: `target-spec.md#t-match-detail`; role matrix JSON; pilot PASS.
Roles and permissions: creator playing/nonplaying, participant, current judge, outsider; admin excluded pending decision.
States and edge cases: waiting with no/many invites, occupied/free judge slot, in_progress, pending_confirmation, finished/stopped/cancelled/voided, empty/long log.
API/types/data: none expected.
Constraints and forbidden shortcuts: no CSS-only visual reorder against DOM; no hidden actions; no enabled judge takeover when occupied.
Subtasks:
1. Encode role/state presentation matrix in view model/tests.
2. Reorder semantic DOM and action variants.
3. Add terminal `Новый матч` for eligible nonplaying creator while preserving Revenge rules.
4. Browser/keyboard regression 390/1440.
Acceptance:
- Given waiting creator, then Start is the first primary action; occupied judge state exposes read-only score without a competing enabled Judge CTA.
- Given current judge, then Judge/score is primary and only permitted stop/no-show actions appear.
- Given participant, then creator-only actions are absent.
- Given finished participant, Revenge is primary; given nonplaying creator, New match is present; void remains separated and role-gated.
- All current invitation/log/refresh/back capabilities remain reachable and focus order matches visual order.
Evidence required: per-role screenshots/action inventory, DOM/focus assertion, pilot comparison.
Documentation updates / rollback: traceability if tests change; CHANGELOG_DEV; rollback view structure only.
Risks / open decisions: none; exact cross-package ownership must be scheduled by coordinator.

## Candidate 5 — blocked decision, не implementation-ready

### TASK-CANDIDATE-MATCH-05 — узкий admin recovery path к active standalone

**Type:** Product/authorization reconciliation
**Priority:** P2
**Status:** blocked_decision
**Evidence:** F-MATCH-004; `evidence/m06-waiting-active-admin-outside-context-1440.png`; D17; D23; MATCH-017; AT-MATCH-CANCEL-002.
**Expected:** После отдельного принятого решения active admin может достичь cancel, не получая несанкционированную глобальную видимость active events.
**Actual:** Detail 403 для admin и outsider; никакого проверенного UI recovery path нет.
**Repro:** M06.
**Risk:** Раскрытие live-event данных или невыполнимое admin-право.
**Verification:** До решения — только source/decision review. После — authorization integration + disclosure review + browser actor matrix.
**Dependencies:** Решить D17 ↔ D23/MATCH-017; owner ADMIN + MATCH.

Scenario / Epic / Story / Sprint: admin incident recovery.
User outcome / Non-goals: Admin выполняет предусмотренный cancel. Не добавлять active matches в общие списки без явного решения.
Inputs: `target-spec.md#t-match-admin-recovery`; current visibility and cancel contracts.
Roles and permissions: active admin versus blocked admin/outsider/participant/judge.
States and edge cases: exact ID not found/forbidden, eligible standalone states, tournament forbidden, stale/version race.
API/types/data: unknown до решения; не изобретать.
Constraints and forbidden shortcuts: не расширять D17 молча; не обходить GET authorization client-side; не показывать roster/title до принятой disclosure policy.
Subtasks: 1) принять decision; 2) только затем сформировать bounded implementation task с exact API/UI seam; 3) независимый security/UX review.
Acceptance: blocked до принятого ADR/decision; implementation criteria формируются после него.
Evidence required: accepted decision, negative disclosure tests, actor matrix.
Documentation updates / rollback: DECISIONS, OPEN_QUESTIONS, PRD/AT/UX reconciliation, API as-built if changed, CHANGELOG_DEV.
Risks / open decisions: единственный blocker — способ discovery/disclosure при сохранении D17.

## Verification и cleanup

Фактически выполнено: production build; disposable PostgreSQL migration foundation 9/9; replay driver exit 0; M01–M06 artifacts; JSON/CSV/HTML/link/source-hash checks будут перечислены в финальном receipt после freeze. Human usability, physical device, WebKit, spoken AT и 200% zoom не выполнены.

Runtime credentials не записаны. API/web процессы остановлены, Docker `tab10-ux-match-4817` удалён, порты 4817/4818/33018 свободны; receipt: `evidence/cleanup.json`.
