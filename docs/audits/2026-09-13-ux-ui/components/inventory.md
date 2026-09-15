# Инвентарь общих компонентов и состояний

## Рамка аудита

- Пакет: `COMPONENTS`, сценарии `SC-C01`–`SC-C04`.
- Замороженная версия: `3.0.0`, SHA `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.
- Runtime: production build на `http://localhost:4517`, API на `4518`, одноразовый PostgreSQL на loopback `32996`; только synthetic fixtures.
- Браузер: Chromium `153.0.8010.12`, desktop `1440×900`, viewport emulation `390×844`, `768×1024`, `360×640`; CSS `zoom: 2` отдельно помечен как прокси.
- Метод: source review + реальный headless browser + computed styles/ARIA/геометрия. Это не пользовательское исследование и не доказательство Safari, физического touch, virtual keyboard или spoken AT.

## Матрица

| Семейство | Светлая оболочка | Тёмная judge-оболочка | 390 / 768 / 1440 | Статус и evidence |
|---|---|---|---|---|
| TextField | placeholder, filled, selection, pointer/keyboard focus, error+focus, pending form, disabled, readonly | readonly page context | 390, 360+CSS zoom, 1440 | Проверено; `F-CMP-004`. См. `auth-*`, `admin-*`, `light-filled-*` |
| Autocomplete | open, keyboard active option, long names, chosen value, focus after Enter | N/A: в проверенной judge-поверхности autocomplete нет | 1440 | Проверено с дефектами `F-CMP-001`–`003`; touch, empty/error не проверены |
| Button / ButtonGroup | selected, focus, hover+active, pending+disabled | hover, active | 390, 768, 1440 | Базовые состояния различимы; `aria-pressed` у сегментов подтверждён |
| Checkbox | checked+focus | N/A: нет в выбранной judge-поверхности | 1440 | Частично: unchecked/indeterminate/disabled не проверены |
| Radio | скрытый radio внутри selectable card: selected+focus | native selected+focus | 390, 1440 | Проверено; `F-CMP-004`, `F-CMP-005` |
| Native select | default/chosen+focus в dialog | focus в actions panel | 390, 768, 1440 | Поле и ring проверены; native popup не попал в headless screenshot |
| Dialog | open, select focus, radio cards, wrapping/clipping | N/A для выбранной judge-поверхности | 390, 768, 1440 | Geometry PASS; trap/return/Escape в этом прогоне не повторялись |
| Card / list link | keyboard focus | score cards в readonly/interactive контексте | 390, 1440 | Проверено репрезентативно; универсальное покрытие всех карточек не заявляется |
| Bottom navigation | active, active+focus | N/A: скрыта в immersive judge route | 1440 | Визуально различима; участвует в `F-CMP-002`. Гипотеза об отсутствующем `aria-current` снята после проверки React Router DOM 6.30.4 |
| Loading / pending | submit held pending, filled input retained, disabled dependent field | readonly judge state | 390, 1440 | Проверено репрезентативно; duplicate-write contract вне этого component-аудита |
| Alert / snackbar / tooltip / skeleton | Попадали в контекст, но отдельная state matrix не выполнялась | Alert виден | — | `NOT_TESTED`: вне ограниченного набора `SC-C01`–`SC-C04` |
| Autofill | — | — | — | `NOT_TESTED`: нет доверенного browser/OS autofill profile |

## Прогоны сценариев

| Run | Сценарий | Роль / поверхность | Ввод | Результат | Наблюдение |
|---|---|---|---|---|---|
| `CMP-20260913-01` | `SC-C01` | guest login, user match, admin profile | mouse + keyboard | FAIL | Значение/selection/error/disabled/readonly сохранены, но TextField получает двойную и геометрически несогласованную рамку (`F-CMP-004`) |
| `CMP-20260913-02` | `SC-C02` | active user, `/matches/new` | keyboard | FAIL | `aria-activedescendant` не разрешается, активная опция скрывается нижней nav, после Enter фокус уходит в `body` (`F-CMP-001`–`003`) |
| `CMP-20260913-03` | `SC-C03` | active user + active judge | keyboard + mouse | FAIL | Сегменты/checkbox/button/select работают, но radio/focus geometry непоследовательна и radio-card имеет три контура (`F-CMP-004`, `F-CMP-005`) |
| `CMP-20260913-04` | `SC-C04`, geometry slice | active user dialog | keyboard, viewport emulation | PASS | На 390/768/1440 horizontal overflow нет; native select видим и сфокусирован. Trap/return/Escape — `NOT_TESTED` в этом прогоне |

## Сохранить как есть

- Минимальные размеры проверенных button/select/text controls — не меньше `44px`; radio/checkbox label также резервирует `44px` по source rule.
- Selected segment имеет отдельное состояние `aria-pressed=true`; focus, selected и hover наблюдаемы.
- Dark judge shell задаёт светлый focus token и не даёт горизонтального overflow на 390/768/1440; readonly режим остаётся читаемым.
- Disabled TextField визуально ослаблен, недоступен фокусу и сохраняет заполненное значение при pending.
- Long labels переносятся; диалоги и action rows не выходят за ширину проверенных viewport.

Полные browser-данные: [runtime-states.json](evidence/runtime-states.json). Сопоставление runtime/source: [source-comparison.json](evidence/source-comparison.json).
