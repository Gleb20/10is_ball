# Decisions (ADR)

Этот файл — индекс и полные записи продуктовых/технических решений. При конфликте
более поздний ADR с явной ссылкой `supersedes` имеет приоритет. История не
удаляется.

## Индекс

| ADR | Тема | Статус |
|---|---|---|
| D1 | Stack | active |
| D2 | Test database without Docker | active, fidelity risk tracked |
| D3 | Initial open-question defaults | mixed / historical table |
| D4 | Versioning semantics | active; Git/release-note portion superseded by D16/D19 |
| D5 | Mobile shell IA | active |
| D6 | Admin role change | active |
| D7 | Who may acquire judge | active |
| D8 | Mercy rule | active |
| D9 | Tournament bracket storage | active for current implementation |
| D10 | Meme avatar presets | active; overrides upload/regenerate PRD |
| D11 | Compact SE bye | superseded for new generation by D12/D14 |
| D12 | Match-centric bracket V2 | active for V2; V1 DE preservation superseded by D25 |
| D13 | Result correction deferred | superseded by D19 target; implementation pending |
| D14 | Bracket construction algorithm choice | active for V2; V1 DE legacy clause superseded by D25 |
| D15 | Admin standalone match operations | cancel actor superseded by D23; finished hard delete superseded by D19/D24 |
| D16 | Documentation governance | active |
| D17 | Event visibility | active |
| D18 | Match start and early stop rights | active |
| D19 | Void instead of hard delete | active invariant; actor/reason/safeguard resolved by D24 |
| D20 | Europe/Moscow calendar convention | active |
| D21 | Render Free cold-start UX | active |
| D22 | Visual regression baseline | active; Figma non-authoritative |
| D23 | Standalone cancel rights and safeguard | active |
| D24 | Finished-match void authorization | active |
| D25 | Legacy V1 DE retirement and data-operation boundary | active |
| D26 | Full PRD v2 remains the product target | active |

## D16 — Documentation governance (2026-09-06)

**Decision:** ADR → PRD/acceptance → implementation contracts is the precedence
order for target behaviour. As-built documents describe current code without
turning defects into requirements. [`BACKLOG.md`](BACKLOG.md) is live;
[`audits/2026-09-06-baseline.md`](audits/2026-09-06-baseline.md) is immutable;
[`CHANGELOG_DEV.md`](CHANGELOG_DEV.md) is append-only reverse chronology. Every
product/code change follows [`WORKFLOW.md`](WORKFLOW.md).

**Why:** previous status/roadmap mixed implemented, verified and deployed states,
which made a `done` label unreliable.

## D17 — Event visibility (2026-09-06)

**Decision:** an active match or tournament is visible only to its organizer,
participants and **current active judge**. A completed event is visible to every
active (`status != blocked`) club user. Tutorial events never enter shared lists or
history.

**Why:** closed-club history may be shared after completion, while live events need
contextual access and tutorial isolation.

## D18 — Match start and early stop rights (2026-09-06)

**Decision:** only match creator/organizer may start a match. Early stop may be
performed by creator/organizer or the current active judge. Being a participant by
itself is insufficient.

Cancellation is a separate operation with its own actor/state rules in D23; its
rights are not inferred from early stop.

## D19 — Void instead of hard delete (2026-09-06)

**Decision:** an erroneously finished match is corrected only through `void`.
Original facts remain in an immutable audit trail; already applied statistics are
compensated; dependent tournament state must be invalidated/reconciled. Hard delete
of finished sporting data is forbidden.

D24 resolves who can initiate void, makes a second approval unnecessary and sets
the confirmation safeguard. This ADR still supersedes the finished-match
hard-delete part of D15 and turns the preferred model in D13 into a required
target invariant.

## D20 — Europe/Moscow calendar convention (2026-09-06)

**Decision:** user-facing time and calendar day/week/month boundaries use
`Europe/Moscow`. Absolute instants are stored and transported in UTC; that storage
rule is a technical convention derived from the product timezone, not a separate
user-facing timezone choice.

**Why:** calendar rankings and labels must not depend on host/browser timezone.

## D21 — Render Free cold-start UX (2026-09-06)

**Decision:** up to 60 seconds may be tolerated only while a sleeping Render Free
service wakes. During that interval the UI explicitly says the service is waking/
loading, applies a bounded timeout and offers Retry. Once awake, ordinary request
SLO applies and must not be hidden by the cold-start allowance.

## D22 — Visual regression baseline; Figma is reference only (2026-09-06)

**Decision:** current production UI is the interim visual regression baseline while
bugs are stabilized. The Figma file created 2026-07-25 is non-authoritative
historical reference; it cannot justify code changes by itself. Any future redesign
or replacement reference requires a separate explicit decision.

**Why:** no approved evidence establishes Figma as the intended current product,
while a stable regression baseline is necessary for repair work.

Evidence capture: [`audit/evidence/visual-baseline/README.md`](audit/evidence/visual-baseline/README.md).

## D23 — Standalone cancel rights and safeguard (2026-09-06)

**Decision:** an active standalone match in `waiting`, `in_progress` or
`pending_confirmation` may be cancelled only by an active `admin` or by the
match creator (`created_by_user_id`). A participant or current active judge who
is neither creator nor admin cannot cancel it. Early stop remains a separate
sporting action under D18: it records a winner and affects statistics; cancel
invalidates the unconfirmed event without a winner or statistics.

A reason is optional. The UI must not submit cancel/force-close/delete from the
first click: it shows an explicit confirmation step naming the match and the
effect. Server-side actor, state, idempotency and version checks remain mandatory;
the dialog is a mistake-prevention safeguard, not an authorization boundary.

The admin force-close path from D15 may remain an admin-only way to reach the same
soft `cancelled` outcome. D15's admin-only purge of a **non-finished** standalone
record is not expanded to creators and, while it exists, uses the same explicit
confirmation safeguard. This decision does not authorize bulk deletion, database
reset or any production mutation.

**Resolution:** This resolves Q-MATCH-001. Cancel must free a stuck player without
letting participant/judge erase it; destructive controls need a deliberate action.

## D24 — Finished-match void authorization (2026-09-06)

**Decision:** only an active `admin` or the match creator
(`created_by_user_id`) may void a finished/stopped match. A second approver is not
required. The reason is optional; when supplied it is preserved in the audit.
Before the request, the UI requires an explicit confirmation step that explains
the soft invalidation and statistics impact.

Void never hard-deletes or rewrites the original match/event facts. It appends an
immutable audit record with actor, timestamp, prior result/version and optional
reason, compensates already applied statistics idempotently and reconciles or
invalidates dependent tournament state in the same consistent operation. Repeated
void is idempotent. Unauthorized or stale requests leave all state unchanged.

This resolves Q-MATCH-002, supersedes D19's open actor/approval clause and the
finished-result delete/"ops purge" parts of D15. It does not grant admins direct
score editing.

**Why:** creator/admin authority is sufficient for the closed club, while soft
invalidation, audit, compensation and confirmation protect sporting history.

## D25 — Legacy V1 DE retirement and data-operation boundary (2026-09-06)

**Decision:** legacy schemaVersion 1 double-elimination brackets do not require
migration, read/play compatibility or preservation. Supported tournament play is
V2; V1 DE input must fail closed in bounded time instead of entering the known
hang path. The legacy V1 DE clauses in D12 and D14 are superseded. V1 single
elimination is outside this decision.

The current production installation has no valuable data that needs a V1 DE
preservation programme. This fact is **not** permission to mutate it: reset,
recreate, truncate, purge or any other production data operation still requires a
separate explicit user authorization with an exact target and verification plan.

**Resolution:** This resolves Q-DATA-001. Maintaining a defective unused legacy
path adds risk without product value; the operational permission boundary remains
independent from data value.

## D26 — Full PRD v2 remains the product target (2026-09-06)

**Decision:** the complete current `requirements/04_PRD.md` is the functional
target. A declared but unimplemented capability remains an in-scope product gap
until a later explicit ADR moves it to future scope and updates PRD, acceptance
and traceability in the same change. P0/P1 risk work controls delivery order but
does not silently reduce the target.

**Resolution:** This closes Q-PRODUCT-001 and preserves the audit-plan scope.
Backlog priority may change as evidence changes; omission from the current sprint
does not mean removal from the product.

## D1 — Stack (2026-07-20)

**Decision:** TypeScript monorepo with pnpm workspaces; Fastify + Drizzle API; Vite + React 19 + ic-kit web; Vitest; Playwright later for E2E.

**Why:** Single language, ic-kit compatibility, strong TDD tooling.

## D2 — Test database without Docker (2026-07-20)

**Decision:** Use PGlite (`@electric-sql/pglite`) for local/CI integration tests when Docker is unavailable. Production/dev with Docker uses real PostgreSQL 16 via `docker-compose.yml` and `DATABASE_URL`.

**Why:** NFR forbids SQLite substitutes; PGlite is Postgres-compatible WASM. Document fidelity risk: rare PG features may differ — CI with real Postgres service is preferred when available.

## D3 — Open questions defaults

| ID | Decision (provisional) | Revisit |
|----|------------------------|---------|
| Q1 Third-place match | Always create for single-elim size ≥ 4; wired via `third_place` slots + loserTo (v1.7.0) | polish UX |
| Q2 Team ranking | Sum of current members' all-time wins | Phase 5 |
| Q3 Double elimination | Challonge-style WB+LB+GF with **bracket reset** when LB wins GF1 (v1.9.0); Split Participants out of scope | done |
| Q4 Stop reasons | Codes: `injury`, `time`, `other` (+ optional text) | Phase 3.6 |
| Q5 Default judge | Tournament organizer by default; any active user can acquire (D7) | done |
| Q6 Cookie SameSite | `Lax` for MVP | Phase 9 |

## D4 — Product versioning & commits (2026-07-20)

**Decision:** Версия продукта `a.b.c` ([`VERSIONING.md`](VERSIONING.md)):

- **a** — новый флоу (экраны, сценарии, крупные модули)
- **b** — функционал в существующих экранах / переписывание под новую задачу
- **c** — баги, UX-полировка, мелкие правки
- Увеличение **a** или **b** сбрасывает цифры справа в 0 (1.1.1 + b → 1.2.0; + a → 2.0.0)

**Git (updated by D16):** commit/push/tag/version bump требуют явного разрешения
задачи. Формат handoff и журнал определяет [`WORKFLOW.md`](WORKFLOW.md), а
[`.cursor/rules/git-commits.mdc`](../.cursor/rules/git-commits.mdc) остаётся thin
permission pointer, не отдельным шаблоном commit message.

**Current recorded release:** 1.10.1. Следующая версия не назначается автоматически.
План hard-delete из прежней release note отменён для finished results D19.

## D11 — Compact SE bye vs Challonge DE (2026-07-21)

**Decision:** Single elimination uses **successive odd-bye** (one bye when remaining count is odd; prefer seats that have not yet received a bye, else last in order). Bracket `size` = participant count (not next power of 2). Double elimination keeps **Challonge pad-to-Po2** WB via `generatePowerOf2SingleEliminationBracket`.

**Why:** PRD TOURNAMENT-009 (≤1 bye per player when possible) and product feedback that N=5 must not show three free passes; bye recipient must face a prior-round winner next. DE topology still needs a fixed Po2 WB.

**Superseded for new generates by D12** (V2 Challonge-inspired Po2 SE). V1 compact graphs remain readable. Further superseded by **D14** (user-selectable compact vs power_of_two).

## D14 — Bracket construction algorithm choice (2026-07-21, compact DE 2026-07-22)

**Decision:**

- Product algorithms: `compact` (default) and `power_of_two` (classic Challonge-inspired pad).
- Both emit match-centric **schemaVersion 2**; new compact never uses V1 JSON.
- Supported combos: SE+compact, SE+Po2, DE+Po2, **DE+compact**.
- Compact DE: WB = compact SE (no TP); LB = generate-time phased CompactEntry pairing of competitive WB loser drops only (auto-advance losers excluded); GF1/GF2 as Po2.
- `tournaments.bracket_construction_algorithm` = setting for next generate; `bracketJson.constructionAlgorithm` = stored graph. Unstarted live bracket: must match or `BRACKET_ALGORITHM_MISMATCH`.
- API default-preservation: explicit request wins; regenerate without body keeps existing; first generate → `compact`.
- Compact: no `bracketSize`; Po2: required `bracketSize = nextPowerOfTwo(N)`.
- Legacy historical mapping: V1 SE → compact; the former V1 DE read-only clause is superseded by D25; V2 without field → power_of_two.
- After tournament start, algorithm cannot change.

**Why:** Amateur-friendly compact and classic Po2 for both SE and DE; static LB topology avoids runtime “available path” graphs.

## D12 — Challonge-inspired match-centric brackets V2 (2026-07-21)

**Decision:**

- New tournament bracket generates use **schemaVersion 2** match-centric graphs (`packages/shared/src/bracket-v2/`).
- Topology name in docs/product: **Challonge-inspired canonical double-elimination topology** (not “exact Challonge” without export/API parity).
- **DE has no placement / third-place matches** (product diff from Challonge).
- SE V2 pads to next power of 2 with Challonge seed order; `tournaments.third_place_enabled` is `NULL` for legacy, `true` for new SE, `false` for DE.
- Sources (`sourceA`/`sourceB`) are canonical; destinations are derived via `buildDestinationIndex`.
- No cached resolved participants; always `resolveSource`. Concurrency: DB column `tournaments.bracket_state_version` only (not in JSON).
- Legacy V1 `bracket_json` (slots) was originally read/playable; D25 supersedes
  this compatibility promise for V1 DE. New generate always V2.
- GF2: `winner(GF1)` × `loser(GF1)` with `activationCondition` when LB champ wins GF1; derived state `inactive` otherwise.

**Why:** Fixes confirmed V1 hangs (BYE/empty LB), rematch wiring, and UI topology assumptions; keeps old tournaments working.

## D13 — Bracket result correction deferred (2026-07-21)

**Decision:** Do **not** ship half-correction (delete/rewrite finished tournament matches without compensate).

**Audit:** `MatchService.applyStats` increments `userStats` on finish/stop; there is no reverse/compensate path. Notifications and downstream bracket nodes also depend on applied results.

**Preferred future model:** `voided`/`cancelled` actual match + audit (actor/reason) + stats compensate + invalidate/cascade dependents + new `actualMatchId` materialization.

**Until compensate exists:** organizer may only stop the tournament or leave results as-is; no in-bracket “edit past result” API.

**Why:** Plan Stage 4 stop-gate — correction without compensate corrupts rankings.

## D15 — Admin force-close / delete standalone matches (2026-07-22)

**Superseded scope:** D23 replaces the cancel actor/safeguard policy. D19/D24
forbid hard delete of finished/stopped results and replace it with creator/admin
void. The historical bullets below remain as implementation history, not the
target where they conflict with those ADRs.

**Decision:**

- Role `admin` may **force-close** and **hard-delete** only matches with `kind === "standalone"`.
- Tournament (`kind=tournament`) and tutorial matches are rejected (`TOURNAMENT_MATCH_FORBIDDEN` for non-standalone).
- Force-close: active statuses `waiting` | `in_progress` | `pending_confirmation` → `cancelled`, no `winnerSide`, no `applyStats`, judge session released. Clears MATCH-009 / `PLAYER_BUSY` / `PLAYER_ALREADY_IN_ACTIVE_MATCH` without removing the concurrency rule.
- Parallel user path: organizer/participant/active judge may **`POST /matches/:id/cancel`** with the same void semantics (`finishReason: cancelled`) for standalone matches.
- Delete: hard purge (`judge_sessions` → `match_participants` → `matches`); if the match was `finished`/`stopped` with a winner, **reverse** `userStats` (floor at 0).
- Exception to PRD “admin does not change finished sports results”: this is ops void/purge, not score editing.

**Why:** Stuck standalone matches blocked players indefinitely; organizers/judges could not always stop them; tournament bracket correction remains deferred (D13). Waiting matches also had no user cancel UI — cancel endpoint closes that gap.

## D9 — Tournament bracket storage (2026-07-21)

**Decision:** MVP хранит сетку в `tournaments.bracket_json`; игровые матчи — в `matches` с `kind=tournament`, `tournament_id`, `tournament_slot_id` (пара slot id). Advancement обновляет JSON и создаёт следующие матчи. Отдельные таблицы `tournament_match` / slot rows не вводим в v1.7.0.

**Why:** Совместимо с уже существующим generate; быстрее довести e2e play loop.

## D10 — Meme avatar presets (2026-07-21)

**Decision:** 10 статических пресетов `avatar_1`…`avatar_10` в `apps/web/public/avatars/`. Ключ назначается один раз при создании user (`generated_avatar_key`) или guest (`guest_avatar_key`). Редактирование / upload / regenerate — вне MVP.

**Why:** Быстрый узнаваемый UI в сетке и матче без storage pipeline.

## D5 — Mobile shell IA (2026-07-20)

**Decision:** Bottom navigation = вариант **A** (полный UX-spec из [`05_UX_FLOWS.md`](requirements/05_UX_FLOWS.md) §1), не вариант B (текущие табы прототипа Матчи/Турниры).

### Primary tabs (ровно 5)

| Tab | Назначение | Типовой route |
|-----|------------|---------------|
| Главная | Home, hero, активные события, топ-3, вход в уведомления | `/` |
| История | Лента матчей/турниров, поиск и фильтры | `/history` |
| «Начать» | Hub создания: Матч · Турнир · Challenge | `/start` |
| Рейтинг | All-time / неделя / месяц | `/rankings` |
| Профиль | Профиль, сессии, команды, помощь, выход | `/profile` |

### Secondary (не в bottom bar)

| Destination | Откуда |
|-------------|--------|
| Матчи (список/детали/создание) | «Начать» → Матч; История; карточки Home |
| Турниры | «Начать» → Турнир; История; Home |
| Команды, Help, Onboarding | Профиль (и онбординг после first password) |
| Админка | только `role=admin`, пункт в Профиле (или CTA на Home), **не** в main tabs |
| Judge mode | из карточки матча; **без** bottom nav (immersive) |
| Auth (login / first password) | вне authenticated shell |

### Related UI defaults (закрыты вместе с A)

| ID | Decision | Why |
|----|----------|-----|
| Q-UI-2 Create match | Отдельный route `/matches/new` (wizard), не modal поверх списка | Согласовано с «Начать» → «Матч» (`05_UX_FLOWS` §5) |
| Q-UI-3 Desktop | База — колонка ~360–480px; ≥768px шире контент, **тот же** порядок табов и действий | `05_UX_FLOWS` §15 |
| Q-UI-4 Design source | **Superseded by D22.** Current production = interim visual regression baseline. Figma `10is` = non-authoritative historical reference; Handjet rollout не одобрен. | Baseline-аудит не нашёл подтверждения, что Figma была принята как целевой продукт |

### Explicit non-goals (чтобы не противоречить прототипу)

- Табы «Матчи» и «Турниры» в bottom bar — **устаревший прототип** (`apps/web` до Phase 10); целевое состояние — таблица выше.
- Не добавлять 6-й tab для уведомлений: вход с Home и Profile (`HOME-001`, `NOTIF-005`).

### Versioning for Phase 10

- Выравнивание shell под IA выше + Start/History как primary → **b** (переписывание shell под уже заявленный MVP-флоу, без нового продуктового домена).
- Чистая визуальная полировка / отступы / тексты без смены IA → **c**.
- Новый продуктовый сценарий вне `05_UX_FLOWS` → **a** (см. [`VERSIONING.md`](VERSIONING.md)).

**Why:** Канон UX и PRD (`HOME-001`, `ONB-002`) уже описывают Главная / История / «Начать» / Рейтинг / Профиль. Вариант B закреплял бы drift прототипа.

## D6 — Admin role change (2026-07-20)

**Decision:**

- Админ может создавать пользователей с ролью `admin` или `user`.
- Админ может менять роль **других** пользователей через `PATCH /admin/users/:id` (`role` only).
- **Нельзя** менять собственную роль (`SELF_ROLE_CHANGE_FORBIDDEN`).
- При смене роли все сессии целевого пользователя отзываются (`role_changed`) — нужен повторный вход.
- Нельзя понизить/заблокировать последнего активного admin (`LAST_ADMIN` / AT-AUTH-008).

**Why:** Закрывает gap UX/PRD (выбор роли при создании + назначение админа в production) без self-escalation и без «тихой» смены прав в живой сессии.

## D7 — Who may acquire judge (2026-07-21)

**Decision:** Любой **активный** (не blocked) зарегистрированный пользователь клуба может захватить свободный judge-слот матча в статусах `waiting` | `in_progress` | `pending_confirmation`. Участие в составе матча не требуется.

**Why:** Закрытый клуб; часто судит сосед у стола, не обязательно игрок. JUDGE-001 (один судья) и JUDGE-005 (занятый слот) без изменений.

## D8 — Mercy / сухая победа = лидер ≥ N при сопернике 0 (2026-07-21)

**Decision:** При `mercyEnabled` сухая победа, когда у лидера `score >= mercyPoints` и у соперника **ровно 0**. Отрыв при ненулевом счёте соперника (5:1, 6:1…) **не** является сухой победой. Считается **текущий** счёт: отменённые (Undo) очки не «портят» сухую победу.

**Why:** «В сухую» = ни одного очка у соперника на табло в момент достижения порога.
