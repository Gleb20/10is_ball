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
| **Local → public-stand delivery** | [`docs/DELIVERY.md`](docs/DELIVERY.md) |
| Исторический manual deploy runbook (superseded) | [`docs/DEPLOY.md`](docs/DEPLOY.md) |

## Стек

- **Monorepo:** pnpm workspaces, Node.js 24.20.0, pnpm 9.15.0
- **API:** Fastify + Drizzle + PostgreSQL 16.15 (PGlite только в explicit fast mode/tests)
- **Web:** Vite + React 19 + [ic-kit](https://github.com/icdesign-bt/ic-kit)
- **Tests:** Vitest; фактический результат последнего полного прогона — в
  [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)

## Быстрый старт

```bash
# Точные версии заданы в .mise.toml/.node-version и packageManager.
mise trust && mise install
corepack enable && corepack prepare pnpm@9.15.0 --activate

pnpm install --frozen-lockfile
pnpm exec playwright install chromium
mise exec -- pnpm doctor      # Node/pnpm/Docker/Compose/Chromium
mise exec -- pnpm verify:all  # полный локальный release gate
mise exec -- pnpm dev         # PostgreSQL 16.15 + migrations + API/web
```

В pnpm 9.15.0 имена `doctor` и `ci` заняты встроенными командами. В окружении
`mise exec --` repository-local dispatcher направляет только эти два имени в
package scripts, поэтому `mise exec -- pnpm doctor` запускает полную проверку
toolchain, а `mise exec -- pnpm ci` — полный `verify:all`. Остальные команды
без изменений делегируются закреплённому Corepack pnpm `9.15.0`. Вне mise
используйте явные `pnpm run doctor` и `pnpm run ci`.

**Локальная БД (по конфигам репозитория):**

| Режим | Когда | Команда |
|-------|--------|---------|
| **PostgreSQL 16.15 (по умолчанию)** | обычная разработка, production-like | `pnpm dev`; compose запускается автоматически, volume сохраняется |
| **PGlite persistent** | явно упрощённая работа без Docker | `pnpm dev:pglite`; данные в `.data/pglite` |
| **PGlite ephemeral** | audit-only disposable fixture | `pnpm dev:ephemeral` |

| Сервис | URL |
|--------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:3001/health |

Автоматического default-admin нет. Для одноразового bootstrap явно задайте
`SEED_ADMIN=1`, уникальные `SEED_ADMIN_EMAIL` и `SEED_ADMIN_PASSWORD` по инструкции
в [`apps/api/.env.example`](apps/api/.env.example), затем верните
`SEED_ADMIN=0`. Не используйте credentials из документации.

Compose не требует `.env`, публикует PostgreSQL только на loopback и использует
фиксированные non-secret local credentials. Migration owner и ограниченная runtime
role разделены; hosted credentials никогда не берутся из compose. Остановка
`pnpm dev` сохраняет `tab10_pg16_15`; volume не удаляется без отдельного запроса.

`pnpm verify:all` сам создаёт отдельный tmpfs PostgreSQL project, выполняет fast,
migration/concurrency и compiled browser lanes, а затем удаляет контейнеры,
volumes и процессы в `finally`. Низкоуровневый PostgreSQL runner по-прежнему
требует `NODE_ENV=test`, loopback `TEST_DATABASE_URL` с сегментом `test`, пустой
`DATABASE_URL` и `ALLOW_TEST_DATABASE_RESET=1`; без любого guard он fail-closed.

Сам API не выполняет DDL. Local runner и Render start command до запуска API
явно выполняют `pnpm db:migrate -- --mode=apply`. Для первого OPS-004 release
старая disposable public schema пересоздаётся пустой по D31; historical adoption
не входит в active public path.

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
