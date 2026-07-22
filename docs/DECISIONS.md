# Decisions (ADR)

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

**Git:** каждый коммит — детальное тело по [`.cursor/rules/git-commits.mdc`](../.cursor/rules/git-commits.mdc).

**Current release:** 1.10.1

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
- Legacy: V1 SE → compact; V1 DE → read-only `legacy` / NULL column; V2 without field → power_of_two.
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
- Legacy V1 `bracket_json` (slots) remains **read/playable**; new generate always V2.
- GF2: `winner(GF1)` × `loser(GF1)` with `activationCondition` when LB champ wins GF1; derived state `inactive` otherwise.

**Why:** Fixes confirmed V1 hangs (BYE/empty LB), rematch wiring, and UI topology assumptions; keeps old tournaments working.

## D13 — Bracket result correction deferred (2026-07-21)

**Decision:** Do **not** ship half-correction (delete/rewrite finished tournament matches without compensate).

**Audit:** `MatchService.applyStats` increments `userStats` on finish/stop; there is no reverse/compensate path. Notifications and downstream bracket nodes also depend on applied results.

**Preferred future model:** `voided`/`cancelled` actual match + audit (actor/reason) + stats compensate + invalidate/cascade dependents + new `actualMatchId` materialization.

**Until compensate exists:** organizer may only stop the tournament or leave results as-is; no in-bracket “edit past result” API.

**Why:** Plan Stage 4 stop-gate — correction without compensate corrupts rankings.

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
| Q-UI-4 Design source | Нет отдельного Figma MVP; визуал = ic-kit (`data-brand=ic`) + токены | D1 stack |

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
