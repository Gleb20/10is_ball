# Accessibility и visual QA checklist

Источник: [NFR§§9–10](requirements/06_NFR_CONSTRAINTS.md),
[UX§14–15](requirements/05_UX_FLOWS.md). Current production остаётся interim
visual baseline D22; его подтверждённые дефекты не считаются нормой.

## Исторический baseline 2026-09-06

Аудит зафиксировал controls меньше44px, selected contrast около1.73:1,
auth nested100dvh/double safe-area и пробелы menu/live/avatar/bracket semantics.
Прежний jsdom smoke не доказывал geometry/safe-area/contrast. Исходные captures
сохранены в [visual baseline](audit/evidence/visual-baseline/README.md).
Следующие checkmarks относятся только к явно перечисленным текущим проверкам.

## Проверено локально 2026-09-13

- [x] Свежий `verify:all`1249/1249:48 Chromium journeys desktop/390, включая
  primary role/state journeys B–E и5 F journeys в обоих проектах.
- [x] Размеры controls/link/group на проверенных auth/admin/rankings/judge/
  bracket/dialog surfaces, отсутствие horizontal clipping; реальные browser boxes.
- [x] Selected group и dark judge contrast исправлены; color-contrast больше
  не исключён из critical E2E.22 Chromium axe reports без violations.
- [x] Auth360 помещается по высоте; CSS устраняет двойного владельца viewport/inset.
- [x] Bracket named scroll regions, keyboard Home/End/arrows, pinned labels,
 100–150% enlargement и Chromium emulated touch проверены. SE/DE3/5/8 и
 terminal/BYE journeys повторены общим gate; representative renders просмотрены.
- [x] Dialog Tab/Shift+Tab/restore/Escape, новые/скрытые/удалённые controls и
 real keyboard submit с удержанным busy response проверены. Busy Escape не закрывает.
- [x] Judge disclosure Escape/focus и единый score/server live-region DOM;
 decorative avatars, в том числе непустые строки рейтинга, проверены.
- [x] Onboarding heading/skip focus и notification error/retry объявление проверены.
- [x] F viewport matrix360/390/440/768/1440, judge640×360/844×390, reduced motion
 и увеличение вычисленных font sizes200% проверены на соответствующих поверхностях.
- [x] Playwright Firefox155.0:7/7 critical+F journeys,11 axe reports без violations,
31 captures; это desktop engine resized viewports, не physical mobile.
- [x] Before/after Red/Green, independent review и scoped rollback сохранены.

## Открытая часть полной приёмки

- [ ] WebKit app acceptance:7/7 native runtime crashes при создании страницы
  на этом macOS до app assertions. Ни один WebKit сценарий не объявляется PASS.
- [ ] Последние2 выпущенные версии Chrome/Safari/Firefox/Edge. Один закреплённый
 Playwright engine не доказывает эту матрицу или Safari release parity.
- [ ] Реальные iOS/Android или device farm: nonzero notch safe areas, virtual
 keyboard, rotation/native gestures и реальные Safari/Android Chrome.
- [ ] VoiceOver/TalkBack spoken output, порядок и отсутствие дублирования речи.
- [ ] Все поля/ошибки/роли и WCAG AA во всех состояниях приложения; выполненные
scenarios не равны универсальному conformance declaration.
- [ ] Axe incomplete: generic aria labels и contrast unresolved backgrounds/
arrow labels сохранены (Chromium31 incomplete nodes, Firefox15); они не PASS.
- [ ] Полная ручная contrast/safe-area проверка. Full-page D/E captures сами по
себе не подтверждают положение fixed navigation на реальном viewport.

[Локальное evidence](audit/evidence/wave-f-local.json),
[частичная compatibility lane](audit/evidence/wave-f-compatibility.json).
GAP-011 и TECH-002 остаются in_progress до закрытия полной матрицы.
