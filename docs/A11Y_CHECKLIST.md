# Accessibility & visual QA checklist (UI-6)

Источник: [`06_NFR_CONSTRAINTS.md`](requirements/06_NFR_CONSTRAINTS.md) §9–10, [`05_UX_FLOWS.md`](requirements/05_UX_FLOWS.md) §14–15.

Автоматизировано частично: `apps/web/src/a11y.smoke.test.tsx`.

## Touch & layout

- [x] Bottom nav items ≥ 44×44 / min-height 48px
- [x] List rows ≥ 44px (min-height 56px)
- [x] Judge side zones / toolbar touch targets ≥ 44px
- [x] Shell usable at **360px** width (no primary horizontal scroll)
- [x] Safe-area insets on shell / nav / auth / judge

## Keyboard & focus

- [x] Skip link «К содержимому» в `AppShell`
- [x] Visible `:focus-visible` на ссылках, кнопках, полях, nav, list-row
- [x] Login / first-password: поля с label, form `aria-label`

## Content & errors

- [x] Empty states с текстом + CTA где уместно (AT-EMPTY-001) — Matches, History, Rankings, …
- [x] Ошибки через текст / Alert, не только цветом (`role="alert"`)
- [x] `lang="ru"` на `<html>`

## Judge

- [x] Immersive без bottom nav
- [x] Landscape hint + serve indicator (UI-4)
- [x] Кнопки сторон с `aria-label` (имя стороны)

## Manual smoke (перед релизом)

```bash
pnpm dev
# DevTools → 360×640: Главная / История / Начать / Рейтинг / Профиль
# Tab через bottom nav и формы; focus ring виден
# /matches/:id/judge — portrait hint, landscape board
```

## Optional (не в MVP CI)

- Visual baselines (Percy / Playwright screenshots) — отложено
- axe-core full crawl — отложено; smoke покрывает критичные инварианты
