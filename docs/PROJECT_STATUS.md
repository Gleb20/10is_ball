# Tab-10 Project Status

Last updated: 2026-07-20  
**Product version:** 1.3.0  
Current phase: 10 (UI-0…UI-4 done)  
Next step: Phase 10 UI-5 — Auth + Admin polish

## Progress

| Phase | Status | Steps done |
|-------|--------|------------|
| 0 Foundation | done | 5/5 |
| 1 Auth & Admin | done | 8/8 |
| 2 Shell & Profiles | done | 4/4 |
| 3 Match domain | done | 6/6 |
| 4 Judge concurrency | done | 5/5 |
| 5 Stats / Rankings | done | 4/4 |
| 6 Tournaments | done | 9/9 (core bracket; match wiring partial) |
| 7 Teams & Notifications | done | 4/4 |
| 8 Onboarding / Help | done | 4/4 |
| 9 Hardening | partial | CI + OpenAPI; load test; backup rehearsal; optional: security / mutation / observability |
| 10 UI polish (mobile-first) | partial | UI-0…UI-4 done; UI-5…UI-6 pending |

## Phase 10 plan (summary)

| Slice | Фокус | Status | Version digit |
|-------|--------|--------|---------------|
| UI-0 | Layout primitives, ic-kit exports, safe-area | done | b (с UI-1) |
| UI-1 | Bottom bar + Start hub + History (D5) | done | b → 1.1.0 |
| UI-2 | ListRow, StatusChip, AsyncState, FilterBar | done | c → 1.1.1 |
| UI-3 | Home, Matches flow, Rankings, Profile polish | done | b → 1.2.0 |
| UI-4 | Judge immersive + landscape | done | b → 1.3.0 |
| UI-5 | Auth + Admin polish | next | c / b |
| UI-6 | Visual/a11y QA | pending | c |

## Step log (latest)

### Phase 10 UI-4 — Judge immersive — done (v1.3.0)
- Immersive shell, landscape hint, serve badge, touch ≥ 44px
- Toolbar Undo / Ещё (confirm, revert, release); heartbeat 30s
- Tests: judgeUi, JudgePage (REQ_ui__judge_*)
- `pnpm run ci` — green (56 tests)

### Phase 10 UI-3 — key screens — done (v1.2.0)
### Phase 10 UI-2 — shared patterns — done (v1.1.1)
### Phase 10 UI-0 + UI-1 — done (v1.1.0)

## Manual smoke

```bash
pnpm dev
# admin@tab10.local / AdminPass1!
# Матч → Стать судьёй: landscape hint в portrait; «Подача» на стороне сервера
```
