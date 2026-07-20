# Dev Changelog

## 2026-07-20 — Phase 10 UI-5 Auth + Admin polish (v1.3.1)

### Added
- `authUi.tsx` — AuthLayout, TempPasswordPanel
- `copyText.ts` — clipboard helper
- ic-kit `Dialog` re-export; admin confirm + temp password dialogs
- Tests: AdminPage.test.tsx, copyText.test.ts

### Changed
- Login / FirstPassword на AuthLayout
- Product version **1.3.0 → 1.3.1** (c)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev
```

## 2026-07-20 — Phase 10 UI-4 Judge immersive (v1.3.0)

### Added
- `judgeUi.ts` — side labels, servingSide, landscape hint
- JudgePage: immersive layout, serve badge, rotate hint, more-menu (confirm/revert/release)
- API client: heartbeatJudge, releaseJudge, revertFinish
- Tests: `judgeUi.test.ts`, `JudgePage.test.tsx`

### Changed
- Immersive shell CSS + landscape compact board
- Product version **1.2.0 → 1.3.0** (b)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev
# open /matches/:id/judge
```

## 2026-07-20 — Phase 10 UI-3 key screens (v1.2.0)

### Added
- `GET /api/v1/users/directory` — active users for Autocomplete (no email)
- Home `myStats` in `/api/v1/home`
- `rankingUi.ts` — podium split + initials
- MatchCreate guest/player modes + ic-kit Autocomplete

### Changed
- Home / Rankings / Profile visual polish (Avatar, podium, ListRow sections)
- Product version **1.1.1 → 1.2.0** (b)

### How to verify
```bash
pnpm run ci
pnpm dev
```

## 2026-07-20 — Phase 10 UI-2 patterns (v1.1.1)

### Added
- `apps/web/src/patterns.tsx` — ListRow, StatusChip, AsyncState, FilterBar
- `apps/web/src/statusLabels.ts` — RU status/format labels + tone
- `patterns.test.tsx` — REQ_ui__* coverage

### Changed
- Data screens use AsyncState (skeleton / empty / Alert)
- Match/tournament/user statuses via StatusChip (no raw enums)
- Rankings + tournament format via FilterBar
- Product version **1.1.0 → 1.1.1** (c)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev
```

## 2026-07-20 — Phase 10 UI-0 + UI-1 (v1.1.0)

### Added
- `layout.tsx`: `AppShell`, `BottomNav`, `PageLayout`, `shouldShowBottomNav`
- Pages: `HistoryPage`, `StartPage`, `MatchCreatePage` (`/matches/new`)
- Shell tests: `layout.test.tsx`

### Changed
- Bottom nav → ADR D5 tabs (removed Матчи/Турниры from primary bar)
- Home / Profile / Matches / Rankings / Tournaments / Match detail use PageLayout
- Admin only from Profile; judge hides bottom nav
- `viewport-fit=cover` + safe-area padding
- Product version **1.0.0 → 1.1.0** (b)

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
pnpm dev   # bottom nav: Главная · История · Начать · Рейтинг · Профиль
```

## 2026-07-20 — Phase 10 planning: IA variant A (docs)

### Decided
- ADR **D5**: bottom nav = Главная / История / «Начать» / Рейтинг / Профиль
- Q-UI-2 `/matches/new`, Q-UI-3 desktop column, Q-UI-4 ic-kit-only — в D5
- Устаревший прототип (табы Матчи/Турниры) явно помечен как drift до UI-1

### Docs updated
- `docs/DECISIONS.md` — D5
- `docs/PROJECT_STATUS.md` — Phase 10 planned; next = UI-0
- `docs/requirements/05_UX_FLOWS.md` §1, §10, §15
- `docs/requirements/12_IMPLEMENTATION_ROADMAP_TDD.md` — Phase 10 slices
- Traceability: HOME / ONB shell notes

### Not in this change
- Код `apps/web` ещё на старых табах — реализация с Phase 10 UI-0

## 2026-07-20 — Phase 9.1 load test & backup rehearsal

### Added
- `apps/api/src/load.integration.test.ts` — `INT_load__ten_parallel_matches_meet_slo`
- `scripts/backup-rehearsal.sh` — pg_dump/restore rehearsal (NFR §7)
- `percentile()` helper in `@tab10/test-utils`
- Scripts: `pnpm test:load`, `pnpm backup:rehearsal`

### How to verify
```bash
pnpm test:load                    # 10 parallel matches + SLO assertions
docker compose up -d && pnpm backup:rehearsal   # requires pg_dump/psql
pnpm run ci                       # full suite (36 tests)
```

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
