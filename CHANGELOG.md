# Changelog — Tab-10

Формат версий: [docs/VERSIONING.md](docs/VERSIONING.md).

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
