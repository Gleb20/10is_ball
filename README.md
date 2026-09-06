# Tab-10 (10is_ball)

Закрытый mobile-first веб-сервис для матчей и турниров по **настольному теннису**.

## Документация

| Раздел | Путь |
|--------|------|
| Карта документации и источники истины | [`docs/README.md`](docs/README.md) |
| Baseline-аудит | [`docs/audits/2026-09-06-baseline.md`](docs/audits/2026-09-06-baseline.md) |
| Backlog исправлений | [`docs/BACKLOG.md`](docs/BACKLOG.md) |
| Требования (PRD, API, TDD) | [`docs/requirements/`](docs/requirements/) |
| Статус разработки | [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) |
| Версионирование `a.b.c` | [`docs/VERSIONING.md`](docs/VERSIONING.md) |
| Changelog релизов | [`CHANGELOG.md`](CHANGELOG.md) |
| Решения (ADR) | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| **Деплой (Neon + Render + Vercel)** | [`docs/DEPLOY.md`](docs/DEPLOY.md) |

## Стек

- **Monorepo:** pnpm workspaces, Node.js 24.x
- **API:** Fastify + Drizzle + PostgreSQL (PGlite в тестах)
- **Web:** Vite + React 19 + [ic-kit](https://github.com/icdesign-bt/ic-kit)
- **Tests:** Vitest; фактический результат последнего полного прогона — в
  [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)

## Быстрый старт

```bash
# Node 24.x обязателен; точная версия в .node-version
corepack enable && corepack prepare pnpm@9.15.0 --activate

pnpm install --frozen-lockfile
pnpm test        # или pnpm run ci
pnpm dev
```

**Локальная БД (по конфигам репозитория):**

| Режим | Когда | Команда |
|-------|--------|---------|
| **PGlite persistent (по умолчанию)** | `DATABASE_URL` не задан | `pnpm dev` — данные в `.data/pglite` |
| **PGlite ephemeral** | чистая временная локальная БД | `pnpm dev:ephemeral` |
| **PostgreSQL 16** | нужна персистентная БД / ближе к prod | `cp .env.example .env` и `cp apps/api/.env.example apps/api/.env`, задайте один и тот же local-only пароль в обоих файлах, затем `docker compose up -d` |

| Сервис | URL |
|--------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:3001/health |

Автоматического default-admin нет. Для одноразового bootstrap явно задайте
`SEED_ADMIN=1`, уникальные `SEED_ADMIN_EMAIL` и `SEED_ADMIN_PASSWORD` по инструкции
в [`apps/api/.env.example`](apps/api/.env.example), затем верните
`SEED_ADMIN=0`. Не используйте credentials из документации.

Compose требует root `.env`, публикует PostgreSQL только на loopback и передаёт
те же user/password/database, которые должны стоять в `apps/api/.env`. Если volume
уже существовал, его первоначальные credentials не изменятся от редактирования
`.env`; сначала сверяйте конфигурацию и не удаляйте volume без отдельного backup.

PostgreSQL integration lane уничтожает и заново создаёт только schema явно
указанной loopback test-БД. Для запуска нужны одновременно `NODE_ENV=test`,
`TEST_DATABASE_URL` с отдельным именем, содержащим сегмент `test`, пустой
`DATABASE_URL` и `ALLOW_TEST_DATABASE_RESET=1`; без любого guard команда
fail-closed.

Перед изменением security/deploy-конфигурации используйте `pnpm audit:secrets`
для commit surface (worktree, index, all refs). Отдельная команда
`pnpm audit:secrets:local` дополнительно проверяет ignored `.env*` и предназначена
для локальной incident-проверки, а не обычного CI.

## Структура репозитория

```
├── apps/
│   ├── api/          # REST API /api/v1
│   └── web/          # React UI (ic-kit)
├── packages/
│   ├── shared/       # domain logic, Zod
│   └── test-utils/   # FakeClock, SeededRng
├── docs/
│   ├── requirements/ # целевые требования и acceptance
│   ├── architecture/ # фактические API/DB/архитектура
│   ├── audits/       # immutable baseline-аудиты
│   └── …             # backlog, status, ADR, workflow
├── AGENTS.md         # канонические правила Codex/agents
├── .cursor/rules/    # thin compatibility pointers
└── .github/          # CI
```

## TDD

Red → Green → Refactor. Подробнее: [`docs/requirements/10_TDD_STRATEGY.md`](docs/requirements/10_TDD_STRATEGY.md).
