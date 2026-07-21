# Changelog — Tab-10

Формат версий: [docs/VERSIONING.md](docs/VERSIONING.md).

## [1.6.3] — 2026-07-21

### Fixed (c — judge setup + mercy)

- Setup: стрелка ↔ снова между плашками счёта
- Сухая победа по текущему счёту (≥N:0); Undo случайного очка не блокирует 5:0

## [1.6.2] — 2026-07-21

### Changed (c — mercy + setup board)

- Сухая победа только при сопернике 0 (ADR D8); 5:1 не завершает
- Judge setup = board; дефолт создания матча «Игрок»; бейдж подачи с ракеткой

## [1.6.1] — 2026-07-21

### Fixed (c — judge polish)

- Undo ровно −1 очко; любой active user может судить; таймер после setup; ↔ / +1 в ячейках

## [1.6.0] — 2026-07-21

### Added (b — Judge UX)

- Pre-game setup (первый подающий, стороны, flip); mercy в создании матча; live-таймер; кнопки +1
- `activeJudge` в GET match; fix зависания «Подключение судьи»

## [1.5.0] — 2026-07-21

### Fixed (b — P0+P1 bugfix)

- Atomic score version, idempotency, CSRF, judge/stop authz, rankings, UX dead-ends

## [1.4.0] — 2026-07-20

### Added (b — admin roles)

- Создание пользователя с выбором роли `user` / `admin`
- Смена роли существующего пользователя (promote / demote) с confirm-диалогом
- `PATCH /api/v1/admin/users/:userId` — только `role`; нельзя менять свою роль; revoke сессий цели
- Защита последнего активного admin (AT-AUTH-008)

## [1.3.2] — 2026-07-20

### Changed (c — a11y / visual QA)

- Skip-link «К содержимому», `:focus-visible`, reduced-motion
- Touch floors на bottom nav; overflow-x clip
- `docs/A11Y_CHECKLIST.md` + `a11y.smoke.test.tsx` (360px, AT-EMPTY-001)

## [1.3.1] — 2026-07-20

### Changed (c — auth/admin polish)

- AuthLayout для login / first-password (бренд Tab-10)
- Временный пароль: Dialog + CTA «Скопировать»
- Admin: confirm Dialog для блок/сброс пароля

## [1.3.0] — 2026-07-20

### Changed (b — judge UI)

- Judge immersive full-bleed (без bottom nav, тёмный shell)
- Подсказка landscape на портретном телефоне
- Индикатор подачи на стороне текущего сервера
- Touch targets ≥ 44px; Undo / Ещё / release; heartbeat 30s
- Landscape CSS: крупные зоны счёта на низком viewport

## [1.2.0] — 2026-07-20

### Changed (b — key screens)

- Home: hero с моей статистикой, лидер, топ-3, индикатор уведомлений
- `/matches/new`: выбор Гость / Игрок + Autocomplete соперника
- `GET /api/v1/users/directory` — directory для picker’ов
- Rankings: пьедестал топ-3 + CTA «Вызов»
- Profile: avatar, chip роли, разделы через ListRow

## [1.1.1] — 2026-07-20

### Changed (c — UX patterns)

- `ListRow`, `StatusChip`, `AsyncState`, `FilterBar` — единые паттерны списков и состояний
- Статусы матчей/турниров/пользователей на русском (Chip)
- Применено на Home, History, Matches, Rankings, Tournaments, Admin, Teams, Help, Profile, Match/Tournament detail

## [1.1.0] — 2026-07-20

### Changed (b — shell IA)

- Bottom nav по ADR D5: Главная · История · «Начать» · Рейтинг · Профиль
- Hub `/start`, лента `/history`, создание матча `/matches/new`
- Админка только из профиля; judge без bottom nav
- PageLayout, ic-kit EmptyState/Skeleton/ButtonGroup, safe-area

## [1.0.0] — 2026-07-20

### Added (a — новые флоу)

- Monorepo `apps/api` + `apps/web` + `packages/shared` + `packages/test-utils`
- Локальный вход, смена временного пароля, сессии
- Админка пользователей (создание, блокировка, сброс пароля)
- Матчи 1v1 с гостями, судейство, Undo, подтверждение результата
- Турниры: сбор участников, генерация single/double elimination сетки
- Команды и приглашения (14 дней TTL)
- Рейтинг, главная, уведомления, FAQ, feedback
- Онбординг с учебным матчем «Призрачный Олег»
- UI на ic-kit (бренд `ic`, mobile-first)

### Infrastructure

- CI GitHub Actions, docker-compose PostgreSQL, PGlite для integration-тестов
- Документация требований в `docs/requirements/`
- TDD: Vitest unit + integration
