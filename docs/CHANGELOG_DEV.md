# Dev Changelog

## 2026-07-21 — Challonge-like SE/DE + meme avatars (v1.9.0)

### Domain
- Rewrite `generateDoubleEliminationBracket`: WB + LB drop-ins + `final` / `final_reset`
- `applyMatchResult`: WB wins GF → champion; LB wins → fill reset slots
- ADR Q3 closed (Challonge DE + reset)

### Avatars
- Presets `apps/web/public/avatars/avatar_1.png`…`10`
- `randomAvatarKey` in shared; users 1..10; `guest_avatar_key` on match/tournament participants
- Enrich me/directory/rankings/match/tournament with `avatarKey`

### Web
- Challonge-lite bands + avatars/seeds on bracket cards; Profile/Home/Rankings/Match/Judge

### How to verify
```bash
pnpm --filter @tab10/shared build && PGLITE_DATA_DIR= pnpm --filter @tab10/api test && pnpm --filter @tab10/web test
```

## 2026-07-21 — Tournament playable UX (v1.8.0)

### API
- `create` + `organizerParticipates` → insert organizer as active participant
- `GET /tournaments/:id`: participant `displayName`; one-shot heal organizer on roster
- Duplicate user add → `ALREADY_IN_TOURNAMENT`; `INVALID_STATUS` message

### Web
- `UserPicker` Autocomplete; TournamentDetail add/invite by name
- loadError vs actionError; status-aware withdraw/lifecycle
- `TournamentBracket` + `buildBracketViewModel` (CSS columns)
- Judge: finished → readonly; confirmFinish/release → tournament; MatchDetail «К турниру»

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm --filter @tab10/api test && pnpm --filter @tab10/web test
# Create with organizer participates → self in list → Autocomplete add → generate → Судить → back to tournament
```

## 2026-07-21 — Working tournaments Phase 6 (v1.7.0)

### API / domain
- Tournament lifecycle: PATCH, invitations, dissolve, withdraw, PATCH bracket
- `start` → create matches from ready pairs; `onMatchFinished` advances bracket
- `stop` cancels unplayed; DE losers/final materialization
- Schema: organizerParticipates, rules, tournament_slot_id, tournament_invitations

### Web
- Tournament detail: start/stop/dissolve/withdraw, match links, invites
- Notifications: tournament_invitation + match_ready

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm test
pnpm dev
# Create SE → 4 players → generate → start → judge match → stop
```

## 2026-07-21 — Swap ↔ between panels + mercy after undo (v1.6.3)

### Web
- Judge setup: ↔ снова между плашками счёта (`judge-board--setup`), не в toolbar

### Rules
- `checkVictory` mercy: лидер ≥ `mercyPoints` и соперник 0 (D8); отменённые очки не блокируют
- AT-MATCH-004c: accidental B → Undo → 5×A → `pending_confirmation`

### How to verify
```bash
pnpm run ci
pnpm dev
# Judge setup: ↔ между плашками
# +1 сопернику → Undo → 5 очков лидеру → подтверждение сухой победы
```

## 2026-07-21 — Mercy N:0 + setup board + serve racket (v1.6.2)

### Rules
- `checkVictory` mercy: только exact `mercyPoints:0` / `0:mercyPoints` (ADR D8)
- AT-MATCH-004b: 5:1 не завершает матч

### Web
- MatchCreate: дефолт «Игрок»; copy «сухая победа при счёте N:0»
- Judge setup = тот же board (0:0); тап стороны = первый подающий; ↔; «Начать матч»
- Бейдж «Подача» + `TableTennisRacketIcon`

### How to verify
```bash
pnpm run ci
pnpm dev
# /matches/new — режим Игрок; mercy 5:0 copy
# Judge setup: board layout, tap serve, Начать матч → timer
# 5:1 при mercy не finish
```

## 2026-07-21 — Judge UX polish (v1.6.1)

### Fixes
- Undo: rebuild только из `point_awarded` (AT-MATCH-005b) — всегда −1 очко
- `startedAt` ставится в `judge/setup`, не в `startMatch` — таймер после выбора подачи
- Setup UI: кликабельная ↔ между половинами; чекбоксы смены сторон убраны
- +1 внутри ячеек счёта (стабильная высота); spacer в readonly
- После «Подтвердить результат» → navigate на карточку матча
- Undo: `undoPending` + reload при ошибке

### Authz
- ADR D7: любой active user может acquire свободный judge-слот (не только участник)

### How to verify
```bash
pnpm run ci
pnpm dev
# Setup: ↔ меняет стороны; таймер стартует после «Начать судейство»
# Undo после серии award/undo — ровно −1
# Не-участник может «Судить» свободный матч
# Confirm finish → /matches/:id
```

## 2026-07-21 — Judge UX slice (v1.6.0)

### API
- `GET /matches/:id` → `activeJudge: { userId, displayName } | null`
- `POST /matches/:id/judge/setup` — first server, swap sides, display flip (`judge_display_flipped`)
- `acquireJudge` idempotent для той же сессии; `JUDGE_TAKEN` с `details.currentJudge`
- Integration: AT-JUDGE-003, AT-MATCH-004 mercy, setup swap/server

### Web
- JudgePage: фазы loading / blocked / setup / scoring / readonly (`?mode=readonly`)
- MatchCreatePage: сухая победа (default on, порог 5/10)
- MatchDetailPage: длительность, активный судья, «Открыть счёт»
- Таймер матча; кнопки «+1»; контраст loading-текста

### How to verify
```bash
pnpm run ci
pnpm dev
# Создать матч с mercy → 5:0 → pending_confirmation
# Release судьи → другой участник acquire без зависания
# /matches/:id/judge?mode=readonly — просмотр счёта
```

## 2026-07-21 — P0+P1 bugfix slice (v1.5.0)

### P0 — корректность API
- Atomic `UPDATE … WHERE version = expected` на очках / undo
- Обязательный `Idempotency-Key`; повтор ключа — idempotent 200
- CSRF: cookie + `X-CSRF-Token` на мутациях (кроме login; в тестах отключено)
- Authz: stop — только участник/судья; acquire judge — только участник; release — активный судья
- RANK-001 comparator + calendar week/month из `finishedAt` матчей
- `getMatch` обогащает participants полем `displayName`

### P1 — тупиковые UX-сценарии
- `/notifications` — список, read, accept/decline team invite
- Challenge: `/matches/new?opponentId&opponentName` из рейтинга
- Stop match UI на детали матча
- 404 страница, «Назад» / «Отмена» на формах
- Rankings sticky error fix; history sort by time
- Login: show password, текст про админа; first password confirm

### How to verify
```bash
pnpm --filter @tab10/shared build && pnpm --filter @tab10/test-utils build
pnpm run ci
pnpm dev
```

## 2026-07-20 — Admin role create / promote / demote (v1.4.0)

### Added
- `AuthService.updateUserRole` — self-forbid, last-admin, revoke sessions, audit `user.role_changed`
- `PATCH /api/v1/admin/users/:userId` body `{ role }`
- Admin UI: role select on create; «Сделать админом» / «Снять админа» + confirm
- Tests: `INT_admin__role_create_promote_demote_guards`; AdminPage role UI

### Changed
- Product version **1.3.2 → 1.4.0** (b)
- ADR D6 — no self role change; revoke sessions on role change

### How to verify
```bash
pnpm --filter @tab10/api test
pnpm --filter @tab10/web test
pnpm run ci
```

## 2026-07-20 — Deploy readiness (Neon / Render / Vercel)

### Added
- `docs/DEPLOY.md` — пошаговый бесплатный хостинг
- `render.yaml`, `apps/web/vercel.json`, `vercel.rewrites.example.json`
- `.env.example` для api/web
- API: `WEB_ORIGIN` CORS, `COOKIE_SAME_SITE`, schema on Postgres boot
- Web: `VITE_API_BASE_URL` prefix

### How to verify
```bash
pnpm run ci
# follow docs/DEPLOY.md
```

## 2026-07-20 — Phase 10 UI-6 Visual/a11y QA (v1.3.2)

### Added
- `docs/A11Y_CHECKLIST.md`
- `a11y.smoke.test.tsx` — 360px nav, skip-link, AT-EMPTY-001, auth width, CSS floors
- Skip-link в AppShell; global `:focus-visible`; `prefers-reduced-motion`

### Changed
- Product version **1.3.1 → 1.3.2** (c)
- Phase 10 UI polish marked **done**

### How to verify
```bash
pnpm --filter @tab10/web test
pnpm run ci
```

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
