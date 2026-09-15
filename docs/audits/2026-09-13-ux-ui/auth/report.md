# AUTH — вход, первый запуск и возвращение

Статус: `READY_FOR_REVIEW`. Это экспертный runtime-аудит на локальном disposable стенде; пользовательская сессия не проводилась, приложение и канонические документы не изменялись. База: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`, SHA-256 frozen `manifest.json` `c39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6`, application fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.

Метод: анализ исходников + production build + PostgreSQL 16.15 + Chromium 153.0.8010.12, окна 390×844, 360×800 и 1440×900. Применены `flow-auth`, `flow-onboarding`, `flow-navigation`, `flow-errors`; `interface-design` использован для иерархии, `impeccable/review` — для проверяемой критики. Это не доказывает поведение WebKit, настоящей экранной клавиатуры, речевого скринридера, масштаба 200%, физическую передачу телефона или ошибки и ожидания реального человека.

## Итог

Основной первый вход работает: безопасный login, обязательная смена пароля, persisted onboarding, optional tutorial с явным завершением, повторный запуск из профиля и корректные empty-state пути. Runtime reauth также соответствует принятому контракту: на 401 login появляется на том же безопасном route, Email получает focus, тот же пользователь получает сохранённый смонтированный черновик, другой пользователь — чистую форму; отклонённый POST не повторяется.

Найдены два фактических auth-дефекта и три экспертные UX-гипотезы:

| Finding | Вид | Последствие | Приоритет |
|---|---|---|---|
| F-AUTH-001 | runtime_defect | «Выйти» на обязательной смене пароля не завершает ограниченную сессию | P2 |
| F-AUTH-002 | runtime_defect | Ошибка смены пароля не связана с полями; API-коды показаны пользователю; focus теряется | P2 |
| F-AUTH-003 | expert_hypothesis | «Далее» и «Пропустить шаг» выполняют одно действие и создают лишний выбор | P3 |
| F-AUTH-004 | expert_hypothesis, уточнение F-PILOT-007 | На Home действие начинается после 300–386 px личной статистики | P2 |
| F-AUTH-005 | expert_hypothesis | Feedback до 4000 символов и ссылка редактируются в однострочном input | P3 |

`F-AUTH-004` не создаёт второй backlog-дубликат: это AUTH-уточнение принятой пилотной гипотезы `F-PILOT-007`. Находки общего focus/Autocomplete/Dialog слоя `BUG-018–023` не переобъявлялись. Axe sample на фактически загруженных Home и Help дал 0 violations, но это не заменяет ручную проверку screen reader/zoom.

## SC-A01 — новый пользователь

Синтетический active пользователь с `mustChangePassword=true` прошёл неверный login, временный пароль, смену пароля, семь шагов onboarding, tutorial entry/cancel, явное завершение и restart из Profile.

- Неверная пара показала безопасное общее сообщение «Неверный email или пароль» и сохранила Email; после ошибки active element был `body`.
- Первый password screen доступен и на 390, и в desktop shell. Нажатие «Выйти» открыло `/login`, однако `GET /api/v1/auth/me` ответил 200: сессия не была отозвана. Независимый минимальный fresh-context repro подтвердил: logout POST = 0, session cookie остаётся; отдельный чистый context получает ожидаемый 401.
- При несовпадении паролей alert есть, но оба input не имеют `aria-invalid` и `aria-describedby`; focus остаётся на submit. При нарушении политики пользователю показаны `TOO_SHORT; MISSING_UPPERCASE; MISSING_DIGIT; MISSING_SPECIAL`, focus — `body`.
- Заголовок каждого onboarding step получает программный focus, step переживает reload. Tutorial открыл `/matches/:id/judge?tutorial=1`; отмена вернула на шаг 7, completion остался `null`, затем явное завершение открыло Home — поведение D34.

Доказательство: [run-sc-a01.json](evidence/run-sc-a01.json), [login error](evidence/a01-login-error-390.png), [first-password exit](evidence/a01-first-password-exit-still-authenticated-390.png), [mismatch](evidence/a01-first-password-mismatch-390.png), [tutorial](evidence/a01-onboarding-tutorial-390.png).

## SC-A02 — возвращение и runtime reauth

Возвращающийся active пользователь заполнил `/matches/new?source=manual#form`; другая его сессия отозвала browser session. Первый POST create получил 401 и не был автоматически повторён. Login сохранил route/query/hash и focus в Email. Вход тем же actor восстановил название и guest; вход другим actor создал чистую страницу без старого guest.

Точный контракт, который должен быть сохранён в любых последующих изменениях:

1. MATCH-015 запрещает сохранять незавершённый create flow между обычными посещениями или после размонтирования.
2. AT-AUTH-009 разрешает краткоживущий in-memory черновик только потому, что защищённая страница остаётся смонтированной и скрытой на reauth.
3. При том же user id восстанавливаются безопасный внутренний route/query/hash и локальные поля; отклонённая mutation не повторяется.
4. При другом user id защищённое дерево размонтируется: старые поля, teams/selections и данные не видны и не отправляются.

Это не новый persistent draft и не расширение GAP-013. Доказательство: [run-sc-a02.json](evidence/run-sc-a02.json), [expired login](evidence/a02-session-expired-login-390.png), [restored draft](evidence/a02-session-restored-draft-390.png), `05_UX_FLOWS.md` §3.1 и AT-AUTH-009.

## SC-A03 — Home, Profile, Help

На новом account Home 390 имеет: heading y16–98.5, personal stats y118.5–418.5, «Начать» y434.5, active events y494.5–746.5. На 360 stats растёт до 386 px и CTA начинается ниже y504.5. Desktop сохраняет тот же узкий 560 px shell и порядок, stats y82–382, CTA y398. Это измерение, не доказательство более низкой конверсии; приоритетная гипотеза следует из заданного контекста «человек у стола создаёт и судит игру для других».

Profile показал active session и restart onboarding. Help загрузил FAQ, восстановился после 503, сохранил feedback draft после 503 и успешно повторил submit. Поле сообщения — `<input maxlength=4000>`, не multiline. Контраст sampled muted text 5.01:1, основного текста 17.69:1, active nav 16.34:1.

Доказательство: [run-sc-a03.json](evidence/run-sc-a03.json), [Home 390](evidence/a03-home-empty-390.png), [Home desktop](evidence/a03-home-empty-1440.png), [Help](evidence/a03-help-390.png), [Help error](evidence/a03-help-load-error-390.png).

## Негативные проверки

Unknown login вернул 401 с общим сообщением; blocked login — 403 с предусмотренным UX-flow сообщением «Аккаунт заблокирован». Одиннадцатая ошибка одного normalized key получила 429 «Слишком много попыток». Это process-local runtime probe, не временная boundary-проверка с injected clock. Тест не объединяет `neverLogged` и `inactive`: fixture index хранит статус, must-change и onboarding отдельно. См. [negative-auth-probes.json](evidence/negative-auth-probes.json) и [fixture-index.json](evidence/fixture-index.json).

## Ограничения и невыданные PASS

- AUTH-001 restricted allowlist, временный пароль после ротации, sliding expiry, admin reset, password-change revocation остальных sessions и unblock lifecycle не проходились полностью; они отмечены partial/not tested в coverage delta.
- Active session показана, а revoke browser session выполнялся через API-контроль, не через Profile UI.
- Home прошёл в empty/new-user состоянии; populated recent/rival, simultaneous active match+tournament и month race не перепроверялись.
- Tutorial isolation от history/statistics/ranking не проверялась после результата, только entry/cancel и explicit completion.
- HELP-002 context tips вне Help source только просмотрены; отдельный runtime-проход setup/judge/ranking принадлежит другим пакетам.
- Инструментальные падения `selector is not defined` и неверный locator были исправлены в audit harness до успешного прогона; это не дефекты приложения. Sandbox Chromium launch отдельно потребовал разрешённый unsandboxed локальный запуск.

## Предлагаемый результат

[Target spec](target-spec.md) сохраняет все текущие права, session guards, server-persisted onboarding, optional tutorial, Help categories/retry, Home sections и D5 navigation. Он не добавляет регистрацию, self-service recovery, persistent match drafts, новую вкладку, auto-replay mutation или новый визуальный стиль. [Structural wireframes](wireframes.html) показывают только порядок и states для 390/desktop. Кандидаты задач имеют testable acceptance, но canonical `AREA-NNN` назначает координатор после синтеза.

Cleanup завершён: порты 4717/4718/33017 закрыты, compose project/volume/network удалены, временные runtime/credential files удалены. См. [cleanup](evidence/cleanup.json).
