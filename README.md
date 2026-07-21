# Tab-10 (10is_ball)

Закрытый mobile-first веб-сервис для матчей и турниров по **настольному теннису**.

## Документация

| Раздел | Путь |
|--------|------|
| Требования (PRD, API, TDD) | [`docs/requirements/`](docs/requirements/) |
| Статус разработки | [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) |
| Версионирование `a.b.c` | [`docs/VERSIONING.md`](docs/VERSIONING.md) |
| Changelog релизов | [`CHANGELOG.md`](CHANGELOG.md) |
| Решения (ADR) | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| **Деплой (Neon + Render + Vercel)** | [`docs/DEPLOY.md`](docs/DEPLOY.md) |

## Стек

- **Monorepo:** pnpm workspaces, Node.js ≥ 20
- **API:** Fastify + Drizzle + PostgreSQL (PGlite в тестах)
- **Web:** Vite + React 19 + [ic-kit](https://github.com/icdesign-bt/ic-kit)
- **Tests:** Vitest (50 тестов)

## Быстрый старт

```bash
# Node 20+ обязателен (ic-kit)
corepack enable && corepack prepare pnpm@9.15.0 --activate

pnpm install
pnpm test        # или pnpm run ci
pnpm dev
```

**Локальная БД (по конфигам репозитория):**

| Режим | Когда | Команда |
|-------|--------|---------|
| **PGlite (по умолчанию)** | `DATABASE_URL` не задан | просто `pnpm dev` — API поднимает in-memory Postgres (WASM), seed admin автоматически |
| **PostgreSQL 16** | нужна персистентная БД / ближе к prod | `docker compose up -d` затем `cp apps/api/.env.example apps/api/.env` и задайте `DATABASE_URL=postgres://tab10:tab10@localhost:5432/tab10` |

| Сервис | URL |
|--------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:3001/health |

**Seed admin:** `admin@tab10.local` / `AdminPass1!`

## Структура репозитория

```
├── apps/
│   ├── api/          # REST API /api/v1
│   └── web/          # React UI (ic-kit)
├── packages/
│   ├── shared/       # domain logic, Zod
│   └── test-utils/   # FakeClock, SeededRng
├── docs/
│   ├── requirements/ # пакет требований 00–14
│   └── …             # статус, ADR, versioning
├── .cursor/rules/    # правила для Cursor
└── .github/          # CI
```

## TDD

Red → Green → Refactor. Подробнее: [`docs/requirements/10_TDD_STRATEGY.md`](docs/requirements/10_TDD_STRATEGY.md).
