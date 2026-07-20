# Dev Changelog

## 2026-07-20 — Repo layout cleanup

### Changed
- Удалены дубликаты требований из корня (`00–14`, `MANIFEST.json`) — канон: `docs/requirements/`
- Добавлен [`docs/README.md`](README.md), обновлён корневой [`README.md`](../README.md)
- `.gitignore`: `.DS_Store`, `apps/api/dist`, `.pnpm-store`

## 2026-07-20 — Versioning & commit conventions

### Added
- [`docs/VERSIONING.md`](VERSIONING.md) — правила `a.b.c`
- [`CHANGELOG.md`](../CHANGELOG.md) — продуктовый changelog
- [`.cursor/rules/git-commits.mdc`](../.cursor/rules/git-commits.mdc) — шаблон детальных коммитов
- Версия продукта **1.0.0** в root `package.json`

### How to bump version
| Change type | Digit | Example |
|-------------|-------|---------|
| Новый экран/флоу | a | 1.0.0 → 2.0.0 |
| Функционал в существующем UI | b | 1.1.1 → 1.2.0 |
| Баг / UX fix | c | 1.2.0 → 1.2.1 |

## 2026-07-20 — Bootstrap Tab-10 monorepo

### Done
- pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`, `packages/test-utils`
- Requirements copied to `docs/requirements/`
- Domain pure logic: password policy, match engine, brackets, rankings, teams
- Fastify API: auth, admin, matches, judge, tournaments, teams, notifications, FAQ, home/rankings
- React + ic-kit UI: login, admin, matches, judge, tournaments, teams, profile, help, onboarding
- Integration tests on PGlite; unit tests for shared domain
- CI workflow, docker-compose for PostgreSQL, cursor project-plan rule

### How to test
```bash
corepack enable && pnpm install && pnpm run ci && pnpm dev
```

### Manual smoke
1. Login as admin
2. Create user in /admin, copy temp password
3. Login as user → set password → home
4. Create match with guest → judge → score → confirm
5. Create tournament with 3 guests → generate bracket
