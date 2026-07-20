# Tab-10 (10is_ball)

Закрытый mobile-first веб-сервис для матчей и турниров по **настольному теннису**.

Документация требований: [`docs/requirements/`](docs/requirements/)  
Статус разработки: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)  
Версионирование: [`docs/VERSIONING.md`](docs/VERSIONING.md)  
Changelog: [`CHANGELOG.md`](CHANGELOG.md)  
Решения: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Стек

- Monorepo: pnpm workspaces
- API: Fastify + Drizzle + PostgreSQL (PGlite в тестах)
- Web: Vite + React 19 + [ic-kit](https://github.com/icdesign-bt/ic-kit)
- Tests: Vitest (unit + integration)

## Быстрый старт

```bash
# если pnpm не установлен глобально:
npm install pnpm@9.15.0 --prefix ./.tools
export PATH="$PWD/.tools/node_modules/.bin:$PATH"

pnpm install
pnpm test
pnpm dev
```

- Web: http://localhost:5173  
- API: http://localhost:3001  
- Seed admin: `admin@tab10.local` / `AdminPass1!`

Опционально PostgreSQL:

```bash
docker compose up -d
DATABASE_URL=postgres://tab10:tab10@localhost:5432/tab10 pnpm --filter @tab10/api dev
```

## Структура

```
apps/api          — modular monolith REST /api/v1
apps/web          — React UI (ic-kit)
packages/shared   — domain pure logic + Zod
packages/test-utils — FakeClock, SeededRng, IDs
docs/             — status, decisions, requirements
```

## TDD

Каждое поведение: падающий тест → минимальный код → рефакторинг → обновление docs.
