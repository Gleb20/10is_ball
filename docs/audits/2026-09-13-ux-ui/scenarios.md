# Каталог исследовательских заданий

Этот каталог задаёт задания, а не их статус. Факт и объём проверки — coverage.csv и отчёты прогонов; основа уже принята locally: GAP-012 r6. Основные экраны 390×844 и1440×900; дополнительно360,768, увеличение масштаба/длинный текст; judge640×360 и844×390. Mouse/keyboard/touch emulation различать; реальные устройства отмечать отдельно.

| ID | Пакет | Нейтральное задание | Ветви / проверяемый выход |
|---|---|---|---|
| SC-A01 | AUTH | Получили аккаунт; начните пользоваться сервисом | временный пароль, обязательная смена, ошибки, onboarding пропуск/возврат; понятный следующий шаг |
| SC-A02 | AUTH | Вернитесь к незавершённому действию после перерыва | session revoke/expiry, return route, допустимые drafts; без replay mutation |
| SC-A03 | AUTH | Узнайте, что здесь можно делать, и найдите помощь | first-run и returning, empty/populated Home, help/tutorial isolation |
| SC-M01 | MATCH | Вы у телефона; двое коллег готовы сыграть — запустите их матч | creator не игрок; 1v1; без согласий; поля не заставляют играть создателя |
| SC-M02 | MATCH | Настройте парную игру и нестандартные правила | 2v2, registered/guest/team, validation/distinct/busy; все возможности обнаружимы |
| SC-M03 | MATCH | Позовите коллегу сыграть, затем организуйте реванш | voluntary invitation, accept/decline/expiry, no hidden start gate, rematch roster/rules |
| SC-M04 | MATCH | До старта поменяйте состав; отмените ненужный матч | permissions, stale data, pending action, named confirmation, no duplicate writes |
| SC-J01 | JUDGE | Ведите счёт и исправьте случайное очко | rapid intentional taps, Undo, score correction discovery, server feedback; результат точен |
| SC-J02 | JUDGE | Передайте ведение другому человеку | physical phone same account vs separate-device handover; lock conflict, release/reacquire |
| SC-J03 | JUDGE | Игра закончилась — убедитесь, что результат сохранён | pending confirmation, undo finish, final result, stats; next match entry |
| SC-J04 | JUDGE | Во время игры пропала сеть или возникла ошибка | context retained, version conflict, no hidden loss/duplicate/replay, recovery |
| SC-J05 | JUDGE | Игра не может завершиться обычным образом | early stop/no-show/cancel distinctions by actor; no accidental destructive action |
| SC-T01 | TOURNAMENT | Соберите турнир из стоящих рядом людей | consent off, manual roster, creator playing/nonplaying, guests, 3/5/8, SE/DE |
| SC-T02 | TOURNAMENT | Соберите турнир, заранее пригласив игроков | consent on; pending/accepted/declined/expired/left; only eligible roster to bracket |
| SC-T03 | TOURNAMENT | Включите опоздавшего до начала, когда сетка построена | org/admin explicit override, warning, updated seed/bracket, forbidden actor/start race |
| SC-T04 | TOURNAMENT | Узнайте, кто играет сейчас и кто следующий | participant vs organizer, BYE, bracket pan/zoom/keyboard/narrow landscape |
| SC-T05 | TOURNAMENT | Управляйте турниром до старта и завершите его | rules/seed/dissolve/regenerate/start, stop/cancel, final results vs stopped summary |
| SC-TE01 | TEAM | Создайте команду и пригласите коллегу | captain/member/invitee/outsider; invite/welcome and pending history |
| SC-TE02 | TEAM | Передайте капитанство или покиньте команду | remove/transfer/leave/last-member archive; archived read-only |
| SC-R01 | RESULTS | Найдите прошлую игру с конкретным человеком | history search/filter/pagination, empty query, return context, detail |
| SC-R02 | RESULTS | Посмотрите свой прогресс и сравните себя с коллегой | profile/stats/period/team filters/public card, challenge, no self challenge |
| SC-R03 | RESULTS | Разберите приглашения и узнайте, чего от вас ждут | notification badge/read vs pending, stale/actionable, expired/declined, destination access |
| SC-R04 | RESULTS | Измените сведения о себе и завершите лишнюю сессию | own vs public profile, validation, sessions/revocation, error recovery |
| SC-AD01 | ADMIN | Помогите новому коллеге получить доступ | create/temp password/reset, duplicate, privacy-safe rendering |
| SC-AD02 | ADMIN | Ограничьте доступ и затем восстановите его | role/block/unblock, self/last-admin guards, session revocation, confirmation |
| SC-AD03 | ADMIN | Включите участника в чужой ещё не начатый турнир | scoped visibility/action; no unintended organizer permissions; audit and rebuilt bracket |
| SC-AD04 | ADMIN | Найдите нужный аккаунт в каталоге | search/status/list hierarchy, contextual actions, create as secondary entry |
| SC-AD05 | ADMIN | Проверьте, кто менял доступ к аккаунту | account context, required lightweight audit history, privacy |
| SC-AD06 | ADMIN | Выдайте новый пароль и разберитесь с потерянным ответом | reset one-time secret, session revocation, honest unknown outcome |
| SC-AD07 | ADMIN | Найдите разрешённый способ освободить зависший матч | D17/D23 exact-ID seam pending decision, no global live access |
| SC-AD08 | ADMIN | Дождитесь каталога или восстановитесь после ошибки загрузки | loading/retry/error/empty feedback adjacent to results |
| SC-C01 | COMPONENTS | Введите, выделите и исправьте значение в поле | focus vs focus-visible vs selection, error+focus, filled/readonly/disabled/autofill |
| SC-C02 | COMPONENTS | Найдите и выберите человека с клавиатуры и касанием | autocomplete open/selected/active option, scroll, long names, empty/error, focus return |
| SC-C03 | COMPONENTS | Выберите режим и подтвердите действие | radio/checkbox/segments/tabs/button/menus; selected+focus, pending, duplicate guards |
| SC-C04 | COMPONENTS | Откройте диалог и вернитесь к исходному действию | focus trap/return, Esc, error/pending/disabled, clipping, zoom, touch target |

Для каждого run брать новые synthetic fixture с детерминированными IDs/данными. Технические failures не маскировать sleeps/retries. Все критические mutations подтверждать persisted state. Обычная фиксация UX не требует заново запускать все технические тесты каждого модуля.

## Поперечные критерии

Что первое привлекает внимание? Совпадает ли с задачей? Различимы ли сущность, статус, роль и действие? Можно ли обнаружить дополнительную возможность без знания внутренних терминов? Сохраняется ли контекст после ошибки/возврата? Что повторяется и должно иметь один паттерн? Где одинаковое оформление скрывает разный смысл? Ответы сопровождать evidence, а не только оценкой.
