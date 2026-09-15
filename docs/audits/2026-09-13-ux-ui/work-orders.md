# Границы рабочих пакетов

Перед dispatch координатор подставляет проверенный runtime baseline, source manifest и принятый пилот. Без этих inputs основной аудит не запускается. Метод и обязательные поля — [templates](templates.md). Модель Sol High; максимум три дочерние работы вместе с подготовкой/review.

Каждый пакет пишет только свой подкаталог: report.md, runs.csv, findings.json, target-spec.md, flow-report.html, evidence/ и handoff.md. Изменять приложение, canonical docs, чужие fixtures/стенд запрещено. Это исследование, а не реализация UI. Findings F-PACKAGE-NNN; canonical AREA-NNN назначает координатор при синтезе.

| Пакет | Задания | Исходники внутри apps/web/src | Особый критерий |
|---|---|---|---|
| AUTH | SC-A01–03 | App, auth, layout, Login/FirstPassword/Onboarding/Home/Help pages | returning vs first-run, optional training, route recovery без replay |
| MATCH | SC-M01–04 | Start/MatchCreate/MatchDetail pages | новая GAP-012 база; nonplaying creator primary; все настройки доступны |
| JUDGE | SC-J01–05 | Judge/MatchDetail pages | rapid intentional input; authoritative score; phone vs device handover |
| TOURNAMENT | SC-T01–05 | Tournaments/TournamentDetail pages, bracket components | policy/override/regeneration/seed; organizer и participant видят нужные задачи |
| TEAM | SC-TE01–02 | Teams/TeamDetail pages | captain/member/invitee/outsider; archive и invitation lifecycle |
| RESULTS | SC-R01–04 | History/Rankings/Profile/Notifications pages, InvitationNotice | поиск, возврат контекста, unread не равно требующему действия |
| ADMIN | SC-AD01–03 | Admin/TournamentDetail pages | user lifecycle, last-admin/self guards; scoped tournament override |
| COMPONENTS | SC-C01–04 | ui, patterns, styles, layout, UserPicker | полный state inventory, interaction method, все отличающиеся shells |

## Последовательность пакета

1. Прочитать applicable AGENTS и relevant current REQ/AT/ADR. Проверить frozen source, known debt и задачи, уже покрывающие проблему.
2. Выбрать relevant userflow modules (обычно1–2, максимум4); interface-design — иерархия, impeccable review — конкретная критика. Стилистические упражнения не входят в scope.
3. Прочитать [правила fixtures](fixtures.md), проверить независимые account/consent/judge состояния. Взять детерминированные synthetic fixtures; зафиксировать владельца портов/DB/browser и не использовать production для mutations.
4. Пройти SC и ветви, desktop/mobile, нужные состояния/роли; заполнить runs.csv с доказательствами. Для своих строк из requirement-coverage.csv передать requirement-coverage-delta.csv: REQ → фактический run/evidence либо конкретное ограничение, предлагаемый доступ к функции. Широкая связь с группой SC — только исходное распределение: уточнить конкретную ветвь, не объявлять всё требование PASS по одному экрану. Общую таблицу меняет координатор. Проверить EMPTY-001–006 и AUDIT-001–003 как cross-cutting constraints, не терять их из-за исключения из capability inventory.
5. Для каждого вывода отделить runtime defect, expert hypothesis и user observation. Не выводить психологию из DOM. Общую причину компонента направить COMPONENTS со ссылкой вместо дублирования.
6. Создать target spec: аннотированная схема существенно меняемого экрана, контрольные состояния, расположение/названия действий, обнаружение второстепенных функций. Не оставлять выбор поведения в ready-кандидате.
7. Заполнить автономный userflow HTML report из установленного template; as-is и proposed различимы; нет placeholders. Anti-pattern verdict без evidence = NOT TESTED.
8. Остановить собственные writers, передать manifest, результаты и limitations. README пакета должен позволять другому агенту повторить проверки без истории чата.

## Приёмка

Координатор проверяет source/runtime совпадение, достоверность, отсутствие дублей, сохранение функций и согласованность target между пакетами. Reviewer проверяет все findings/задачи. P0/P1 и спорные критические переходы координатор воспроизводит лично. Непроверенный state получает конкретную причину, а не PASS. Выполнение пакета не объявляется выполнением всего исследования.
