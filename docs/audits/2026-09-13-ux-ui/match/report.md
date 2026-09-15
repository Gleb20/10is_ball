# MATCH — UX/UI аудит

## Итог

Пакет готов к независимому review. Production-build replay на локальном disposable PostgreSQL прошёл все шесть прогонов M01–M06 и подтвердил основные возможности MATCH: ручной 1v1/2v2 setup, registered/guest roster, команды/недавние/частые соперники, voluntary player и judge invitations, edit до старта, cancel, challenge/revenge и матрицу действий по роли/статусу. Приложение и канонические документы не изменялись.

Зафиксированы четыре пакетные находки: быстрые выборы не сообщают, какой слот они перезапишут; после замены игрока нет явного действия пригласить нового зарегистрированного участника; cancel UI смешивает терминологию cancel/void и не даёт опциональную причину; active admin не может открыть чужой active match, хотя MATCH-017/D23 дают ему cancel. Последний пункт одновременно выявляет конфликт с D17 и поэтому требует решения до реализации.

Повторно подтверждены, но не задублированы: GAP-013/F-PILOT-001 (состав ниже редких правил), F-PILOT-002 (иерархия waiting detail), F-PILOT-003 (нет прямого «Новый матч» после результата), BUG-018/BUG-023, BUG-025, BUG-026 и BUG-024. Смысловая привязка shared-находок: directory async → BUG-025; editable controls during pending → BUG-026; popup ownership/focus → BUG-018; dark judge contrast → BUG-024.

## Baseline и метод

- Frozen export: `/private/tmp/tab10-ux-audit-dispatch-v1`; `manifest.json` SHA-256 `c39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6`.
- Base HEAD: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`; accepted GAP012r6 gate: 1257/1257.
- Candidate application fingerprint: `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3` (из frozen `candidate-source.json`; 323 file hashes перепроверяются перед freeze).
- Runtime: production API/web build, `release.environment=test`, web 4817, API 4818, PostgreSQL 33018, runtime role `tab10_runtime_test`; identity in `evidence/runtime-identity.json`.
- Browser: Chromium 153.0.8010.12; 360×800, 390×844 and 1440×900; touch emulation where noted.
- Actors and data: synthetic only; credentials were generated in memory and not persisted. Fixture shape is in `evidence/fixture-index.json`.
- Method: expert browser replay plus source/contract reconciliation. Это не пользовательское исследование и не доказывает время выполнения, частоту ошибок у людей или предпочтение target-схемы.

## Что фактически проверено

| Run | Result | Наблюдаемая задача | Ключевое доказательство |
|---|---|---|---|
| M01 | FAIL | loading/error/retry create-options; manual create entry; name-order regression | `evidence/m01-directory-loading-390.png`, `evidence/m01-directory-error-390.png`, `evidence/m01-create-before-top-390.json` |
| M02 | PASS_WITH_FINDING | 2v2, guest + registered, team/recent/frequent, custom rules, judge, submit | `evidence/m02-ready-submit-390.png`, `evidence/m03-main-match-created.json` |
| M03 | PASS_WITH_FINDING | player accept/decline, judge accept, roster replacement | `evidence/m03-player-invite-accept-390.png`, `evidence/m04-roster-invitation-lifecycle.json` |
| M04 | PASS_WITH_FINDING | pre-start edit, explicit invite via supported API, cancel no-op/confirm/persist | `evidence/m04-after-roster-edit-1440.png`, `evidence/m04-cancel-confirm-390.png`, `evidence/m04-cancel-persisted.json` |
| M05 | PASS_WITH_REFERENCE | challenge/revenge prefill and persisted purposeful invitations; pending snapshot | `evidence/m05-challenge-persisted.json`, `evidence/m05-revenge-persisted.json`, `evidence/m05-create-pending-1440.png` |
| M06 | FAIL | waiting/in-progress action matrix for creator, participant, judge, outsider/admin | `evidence/m06-role-action-matrix.json`, `evidence/m06-waiting-active-admin-outside-context-1440.png` |

Полные строки — в `runs.csv`; requirement delta — в `requirement-coverage-delta.csv`.

## Находки

### F-MATCH-001 — быстрый выбор меняет не обозначенный слот

`P2`, expert hypothesis, confidence medium. На 2v2 блок «Частые / Недавние / Команды» расположен до roster и выглядит как набор самостоятельных кнопок. Нажатие соперника всегда пишет в `opponent1`; команда без выбора назначения молча заполняет `opponent1/opponent2` первыми допустимыми участниками и может перезаписать уже введённую сторону B. Пользователь не видит destination до нажатия. Runtime подтверждает результат, source подтверждает правило мутации. Это не потеря persisted data, но риск скрытой замены состава перед submit. Наименьшее исправление входит в GAP-013: переместить быстрый выбор внутрь roster и явно показать destination/preview.

Evidence: `evidence/m02-quick-choices-390.png`, `evidence/m02-ready-submit-390.json`; target `T-MATCH-CREATE`.

### F-MATCH-002 — после замены игрока нет явного действия приглашения

`P2`, runtime defect, confidence high. После замены pending Бориса на Глеба старое приглашение корректно отменено, а новое автоматически не создаётся — это соответствует D35: `invitePlayers` является одноразовым явным действием create-flow, не сохранённой policy. Проблема уже: на detail нет row-scoped действия «Пригласить» для нового зарегистрированного участника. Авторизованный creator API-вызов такое приглашение поддерживает; после него UI показывает pending row. Спортивный flow продолжим и invitation не блокирует старт, но для предусмотренного повторного приглашения нет пользовательского пути.

Evidence: `evidence/m04-roster-invitation-lifecycle.json`, `evidence/m04-after-roster-edit-1440.png`, `evidence/m04-explicit-replacement-invite-1440.png`; target `T-MATCH-EDIT-INVITE`.

### F-MATCH-003 — cancel не полностью представляет отдельный lifecycle

`P2`, runtime defect, confidence high. Подтверждение корректно называет матч, первое закрытие dialog не мутирует запись, confirm даёт `cancelled`, отменяет pending invitation и запрещает новые invitations. Но текст говорит «будет аннулирован», хотя каноника разделяет `cancelled` и `voided`; опциональной причины из MATCH-017/D23 в UI нет, хотя контракт её допускает. Это затрудняет предсказание эффекта и лишает оператора предусмотренного audit-контекста.

Evidence: `evidence/m04-cancel-confirm-390.png`, `evidence/m04-cancel-persisted.json`; target `T-MATCH-CANCEL`.

### F-MATCH-004 — active admin не имеет UI-маршрута к cancel чужого active match

`P2`, runtime defect with blocked decision, confidence high. Creator, participant и current judge получают ожидаемые action sets. Outsider и active admin вне контекста оба получают 403 «Недостаточно прав» на detail. Это делает UI-право admin cancel из MATCH-017/D23/AT-MATCH-CANCEL-002 недостижимым через данный surface. Одновременно D17 запрещает global admin видеть active event, поэтому нельзя просто расширить detail visibility: сначала нужно канонически определить узкий admin recovery path и его disclosure boundary.

Evidence: `evidence/m06-role-action-matrix.json`, `evidence/m06-waiting-active-admin-outside-context-1440.png`; target `T-MATCH-ADMIN-RECOVERY` помечен blocked_decision.

## Сохранённые функции и границы

- Creator и participant остаются разными ролями; manual creator по умолчанию не играет.
- Выбор registered participant сам по себе не создаёт invitation; общий invite toggle остаётся добровольным и по умолчанию выключенным.
- Pending/declined invitations не становятся start gate; edit не отправляет replacement invite автоматически.
- Challenge/revenge сохраняют creator-in-roster и purposeful invite.
- Guest, 1v1/2v2, team/recent/frequent, custom rules, judge, edit, start, judge/read-only, stop, no-show, cancel, void/back остаются доступны по текущим правам.
- Target не меняет API, схемы данных, визуальный язык или authorization без отдельной реализации/решения.

## Ограничения

- Не проводились human usability session, physical device/virtual keyboard, WebKit, spoken AT, 200% zoom и network loss во время score mutation.
- Scoring использовался только для синтетической истории; JUDGE владеет scoring UX и MATCH-006/007/010/012/013.
- Finished/result target переиспользует принятые evidence F-PILOT-003; пакет не повторял полный scoring journey.
- Loading/error create-options относятся к BUG-025; pending controls — к BUG-026; keyboard popup/focus — к BUG-018; они не считаются новыми MATCH findings.

## Рекомендованная последовательность

1. Реализовать GAP-013 вместе с `T-MATCH-CREATE`, включая контекст быстрых выборов.
2. Исправить replacement invitation lifecycle по `T-MATCH-EDIT-INVITE`.
3. Привести cancel dialog к `T-MATCH-CANCEL`.
4. Сначала разрешить конфликт D17 ↔ D23/MATCH-017, затем создавать implementation task для `T-MATCH-ADMIN-RECOVERY`.
5. В общей detail-задаче учесть принятые F-PILOT-002/F-PILOT-003 без дублирования backlog IDs.
