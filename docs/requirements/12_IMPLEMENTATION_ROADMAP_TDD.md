# Implementation Roadmap — TDD-first

Оценки не являются календарным обещанием. Порядок важнее длительности.

## Phase 0 — Repository and quality foundation

### Результат
- monorepo или согласованная структура frontend/backend;
- local dev через один command;
- PostgreSQL test container;
- lint, typecheck, unit, integration, E2E в CI;
- factories/builders;
- injected clock/RNG/ID generator;
- OpenAPI validation;
- baseline migration.

### Первые тесты
- test environment поднимает БД;
- миграции применяются с нуля;
- health endpoint;
- CI намеренно ловит падающий sample test, затем sample удаляется.

## Phase 1 — Local auth and tennis admin

### Test-first order
1. password policy pure tests;
2. user lifecycle tests;
3. repository integration tests;
4. session lifecycle;
5. admin authorization;
6. API tests;
7. E2E admin create → first login.

### Deliverable
Админ может создать пользователя, а пользователь — сменить временный пароль и войти.

## Phase 2 — Profiles, avatar, shell, empty states

- current user/profile;
- generated avatars;
- navigation;
- onboarding state;
- zero-data home;
- active sessions.

## Phase 3 — Match domain core

### Сначала pure tests
- winner rules;
- mercy;
- serve rotation;
- deuce;
- 2v2 simplified rotation;
- event reducer;
- Undo;
- immutable finish.

### Затем persistence/API/UI
- create match;
- participants/guests;
- start;
- active details;
- finish/stop/no-show.

## Phase 4 — Judge concurrency and resilience

- DB constraints for judge lock;
- acquire race integration test;
- heartbeat/expiry;
- handover;
- idempotent point API;
- version conflict;
- reload/resume E2E.

## Phase 5 — Statistics, history and ranking

- stats projection tests;
- all-time/calendar queries;
- tie-break;
- guest impact;
- blocked user exclusion;
- history visibility and filters;
- home last five and hero.

## Phase 6 — Tournament engine

### Split into vertical increments
1. collecting and minimum/maximum;
2. single elimination bracket generation;
3. manual bracket edit and lock;
4. match progression;
5. third-place match;
6. odd participants/bye;
7. stop/withdraw/no-show;
8. double elimination;
9. final summary.

Double elimination начинается только после полного зелёного single elimination suite.

## Phase 7 — Teams and notifications

- team lifecycle;
- captain invariants;
- invitation TTL;
- auto-add;
- notification center;
- active popup;
- stop/handover notifications.

## Phase 8 — Onboarding, FAQ, feedback, polish

- tutorial isolation tests;
- ghost opponent flow;
- FAQ/feedback;
- empty states coverage;
- responsive and accessibility checks;
- visual regression for judge/bracket.

## Phase 9 — Hardening and release

- load test 10 parallel matches;
- backup/restore rehearsal;
- security review;
- mutation tests critical domain;
- observability dashboard;
- production seed admin;
- smoke tests after deploy.

## Phase 10 — Mobile-first UI polish (IA = ADR D5)

Цель: привести web shell и ключевые экраны к канону [`05_UX_FLOWS.md`](05_UX_FLOWS.md) §1 и ic-kit; устранить drift прототипа (табы «Матчи»/«Турниры» в bottom bar).

Порядок slices (не менять IA без обновления ADR D5):

1. **UI-0 Foundation** — `PageLayout` / `PageHeader`; re-export ic-kit (`EmptyState`, `Skeleton`, `Alert`, `Chip`, `Avatar`, `ButtonGroup`, `Text`); safe-area / `viewport-fit=cover`; убрать `<Link><Button>` и `window.location`.
2. **UI-1 Shell** — bottom tabs: Главная · История · «Начать» · Рейтинг · Профиль; Start hub; History route; admin только из профиля.
3. **UI-2 Patterns** — `ListRow`, локализованные статусы, `AsyncState` (skeleton / empty / error), фильтры через `ButtonGroup`.
4. **UI-3 Key screens** — Home, match create via `/matches/new`, Rankings, Profile.
5. **UI-4 Judge** — immersive (без bottom nav), landscape, serve indicator, touch ≥ 44px.
6. **UI-5 Auth & Admin** — auth layout; temp password copy CTA; admin dialogs.
7. **UI-6 QA** — 360px smoke, a11y checklist, optional visual baselines.

TDD: для UI-1+ — component/RTL tests на shell и empty states (`AT-EMPTY-*`); judge — существующие AT-JUDGE + visual smoke.

Version digits: см. ADR D5 (IA alignment → **b**; pure polish → **c**).

## Story slicing rule

Каждый story должен быть вертикальным и demonstrable, но доменная логика реализуется раньше UI. Пример:
- ❌ «сделать все таблицы матчей»;
- ✅ «судья начисляет одно идемпотентное очко и видит сохранённое состояние».

## PR template

- Requirement IDs:
- Red tests added:
- Green implementation:
- Refactor performed:
- DB migration:
- API changes:
- UX states:
- Security/permissions:
- Traceability updated:
- Full CI result:
