# Accessibility и visual QA checklist

Источник требований: [`requirements/06_NFR_CONSTRAINTS.md`](requirements/06_NFR_CONSTRAINTS.md)
§9–10 и [`requirements/05_UX_FLOWS.md`](requirements/05_UX_FLOWS.md) §14–15.

Baseline-аудит 2026-09-06 отменил прежнюю трактовку checkmarks как доказательства:
`jsdom` smoke не измеряет реальную геометрию, safe-area или контраст. Current
production — interim visual regression baseline (D22), но подтверждённые дефекты
не считаются нормой. Пока пункт не проверен указанным способом, он остаётся `[ ]`.

## Known baseline failures

- [ ] Все interactive targets ≥ 44×44 CSS px; аудит обнаружил меньшие controls.
- [ ] Selected ButtonGroup соответствует WCAG AA; измеренный baseline contrast
  около 1.73:1 не проходит.
- [ ] Auth pages не создают постоянный vertical scroll из-за nested `100dvh`.
- [ ] Safe-area не применяется дважды в auth/judge layouts.
- [ ] Judge score имеет `aria-live`; menu semantics и avatar alt/decoration корректны.
- [ ] Tournament bracket usable с keyboard/touch, имеет навигацию/масштабирование
  или эквивалент для узкого viewport.

## Browser matrix

- [ ] Chrome, Safari, Firefox, Edge — последние 2 версии.
- [ ] 360×640 portrait: primary routes без горизонтального overflow.
- [ ] 440×956 portrait: auth/shell/forms, keyboard и text zoom.
- [ ] 768×1024 и 1440×900: focus order, max-width, secondary route navigation.
- [ ] Judge portrait + landscape с safe-area и rotate/resize.
- [ ] Mobile Safari и Android Chrome на реальном устройстве или device farm.

## Keyboard, semantics, announcements

- [ ] Skip link и `:focus-visible` проверены в реальном браузере.
- [ ] Все поля имеют accessible name; form errors связаны с полями и `role=alert`.
- [ ] Dialog focus trap/restore и Escape подтверждены.
- [ ] `role=menu` используется только с полной menu keyboard semantics либо заменён
  подходящим обычным navigation/list pattern.
- [ ] Score/status/server changes объявляются без дублирования.
- [ ] Images/avatars имеют ровно одну корректную semantic representation.
- [ ] Reduced motion и text zoom 200% не ломают действия/контент.

## Visual regression

- [ ] Before/after evidence привязано к backlog ID и viewport.
- [ ] Изменение не маскирует loading/empty/error/unauthorized state.
- [ ] Automated axe + Playwright geometry/keyboard checks проходят.
- [ ] Ручной review contrast, safe-area, judge и bracket выполнен.

Сохранённый исходный production capture:
[`audit/evidence/visual-baseline/README.md`](audit/evidence/visual-baseline/README.md).
Работа отслеживается как `GAP-011` и `TECH-002` в
[`BACKLOG.md`](BACKLOG.md).
