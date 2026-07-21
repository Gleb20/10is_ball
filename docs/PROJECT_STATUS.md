# Tab-10 Project Status

Last updated: 2026-07-21  
**Product version:** 1.6.3  
Current phase: Swap ↔ between panels + mercy after undo (v1.6.3) on branch `cursor/p0-p1-bugfix-058e`  
Next step: merge P0+P1 + judge UX → ветка `cursor/tournament-*` для Phase 6 match wiring

## Progress

| Phase | Status | Steps done |
|-------|--------|------------|
| 0 Foundation | done | 5/5 |
| 1 Auth & Admin | done | 8/8 (+ role PATCH / UI) |
| 2 Shell & Profiles | done | 4/4 |
| 3 Match domain | done | 6/6 |
| 4 Judge concurrency | done | 5/5 |
| 5 Stats / Rankings | done | 4/4 |
| 6 Tournaments | done | 9/9 (core bracket; match wiring partial) |
| 7 Teams & Notifications | done | 4/4 |
| 8 Onboarding / Help | done | 4/4 |
| 9 Hardening | partial | CI + OpenAPI; load test; backup rehearsal; optional: security / mutation / observability |
| 10 UI polish (mobile-first) | done | UI-0…UI-6 |

## Phase 10 plan (summary)

| Slice | Фокус | Status | Version digit |
|-------|--------|--------|---------------|
| UI-0 | Layout primitives, ic-kit exports, safe-area | done | b (с UI-1) |
| UI-1 | Bottom bar + Start hub + History (D5) | done | b → 1.1.0 |
| UI-2 | ListRow, StatusChip, AsyncState, FilterBar | done | c → 1.1.1 |
| UI-3 | Home, Matches flow, Rankings, Profile polish | done | b → 1.2.0 |
| UI-4 | Judge immersive + landscape | done | b → 1.3.0 |
| UI-5 | Auth + Admin polish | done | c → 1.3.1 |
| UI-6 | Visual/a11y QA | done | c → 1.3.2 |

## Step log (latest)

### Swap ↔ + mercy after undo — done (v1.6.3)
- Setup: ↔ снова между плашками счёта (`judge-board--setup`)
- Mercy: лидер ≥ N и соперник 0 (D8); AT-MATCH-004c — Undo случайного очка → 5:0 finish

### Mercy + setup board — done (v1.6.2)
- Mercy только N:0 / 0:N (ADR D8); create default «Игрок»; setup = board; serve badge + ракетка

### Judge UX polish — done (v1.6.1)
- Undo replay только `point_awarded` (ровно −1 очко)
- Setup: стрелка ↔ вместо чекбоксов; `startedAt` при judge/setup
- Acquire: любой active user (ADR D7); +1 внутри ячеек; выход после confirmFinish

### Judge UX slice — done (v1.6.0)
- **P0:** fix зависания «Подключение судьи» при ошибке acquire; `activeJudge` в GET match; idempotent re-acquire; AT-JUDGE-003
- **P1:** mercy 5:0 в создании матча; live-таймер; кнопки «+1» вместо клика по всей панели
- **P2:** pre-game setup (первый подающий, swap сторон, flip экрана); readonly счёт; Match detail — статус судьи

### P0+P1 bugfix — done (v1.5.0, branch `cursor/p0-p1-bugfix-058e`)
- **P0 API:** atomic score version, idempotency key required, CSRF on mutations, judge/stop authz, RANK-001 sort + calendar week/month, participant displayName in match API, 2v2 serve order
- **P1 Web:** `/notifications`, challenge prefill, stop match UI, 404, AsyncState form errors, auth polish, history sort

### Admin role management — done (v1.4.0)
- Create with role `user`/`admin`; PATCH role for others (not self)
- Confirm dialog; revoke sessions on role change; last-admin guard
- Deploy: API (Render) first, then Web (Vercel)

### Phase 10 UI-6 — Visual/a11y QA — done (v1.3.2)
### Phase 10 UI-5 — Auth + Admin polish — done (v1.3.1)
### Phase 10 UI-4 — Judge immersive — done (v1.3.0)
### Phase 10 UI-0…UI-3 — done

## Manual smoke

```bash
pnpm dev
# 360×640: tabs + Tab focus; /login skip→main; judge immersive
# /admin: создать с ролью admin; promote существующего user → confirm → re-login
```
