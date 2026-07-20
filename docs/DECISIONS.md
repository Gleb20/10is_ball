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
| Q1 Third-place match | Always create for single-elim size ≥ 4 (shell only until match wiring) | Phase 6.5 |
| Q2 Team ranking | Sum of current members' all-time wins | Phase 5 |
| Q3 Double elimination | Simplified DE with losers bracket shell | Phase 6.8 |
| Q4 Stop reasons | Codes: `injury`, `time`, `other` (+ optional text) | Phase 3.6 |
| Q5 Default judge | Tournament organizer by default | Phase 6 |
| Q6 Cookie SameSite | `Lax` for MVP | Phase 9 |

## D4 — Product versioning & commits (2026-07-20)

**Decision:** Версия продукта `a.b.c` ([`VERSIONING.md`](VERSIONING.md)):

- **a** — новый флоу (экраны, сценарии, крупные модули)
- **b** — функционал в существующих экранах / переписывание под новую задачу
- **c** — баги, UX-полировка, мелкие правки
- Увеличение **a** или **b** сбрасывает цифры справа в 0 (1.1.1 + b → 1.2.0; + a → 2.0.0)

**Git:** каждый коммит — детальное тело по [`.cursor/rules/git-commits.mdc`](../.cursor/rules/git-commits.mdc).

**Current release:** 1.4.0

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
