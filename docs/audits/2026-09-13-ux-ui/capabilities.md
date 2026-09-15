# Реестр возможностей Tab-10

Текущая база: GAP-012 r6,323 app paths, [candidate-source](candidate-source.json), принята локально1257/1257. Исходная инвентаризация выполнена на r3; r4–r6 меняли только проверочные fixtures, app bytes соответствуют принятой базе. Это локальная версия, не новый опубликованный release.

22 группы покрывают все 108 идентификаторов требований с заголовками PRD. Исходные входы сохраняют source-only статус: runtime покрытие задаётся отдельно матрицей. Предлагаемые входы AUTH/MATCH/JUDGE/TOURNAMENT приняты в указанном объёме; TEAM и RESULTS canonical targets также приняты, ADMIN принят с обязательной коррекцией; reset target принят; minimal read остаётся blocked Q-UX-003. Наличие route в исходниках не доказывает его обнаружимость или доступность для нужной роли.

[Машинный реестр](capabilities.json) содержит current/proposed для каждой CAP-записи, источники и владельца. [Матрица требований](requirement-coverage.csv) связывает каждое требование с будущими прогонами; широкую исходную связь с SC должен уточнить исполнитель.

| Возможность | Группа | Пакет-владелец | Текущие точки входа | Требования |
|---|---|---|---|---|
| CAP-AUTH-001 | access | AUTH | `/login`, `protected routes` | AUTH-001 |
| CAP-AUTH-002 | admin account creation | AUTH | `/admin` | AUTH-002, ADM-003 |
| CAP-AUTH-003 | first password | AUTH | `/first-password`, `/login` | AUTH-003, AUTH-004 |
| CAP-AUTH-004 | session | AUTH | `/login`, `/profile` | AUTH-005, AUTH-006, AUTH-007, AUTH-008 |
| CAP-ONB-001 | onboarding | AUTH | `/onboarding`, `/matches/:id/judge?tutorial=1`, `/profile` | ONB-001, ONB-002, ONB-003, ONB-004, ONB-005 |
| CAP-HOME-001 | home dashboard | AUTH | `/` | HOME-001, HOME-002, HOME-003, HOME-004, HOME-005, HOME-006 |
| CAP-MATCH-001 | create | MATCH | `/start`, `/matches/new`, `/matches/:id` | MATCH-001, MATCH-002, MATCH-003, MATCH-004, MATCH-005, MATCH-015 |
| CAP-MATCH-002 | lifecycle | MATCH | `/matches/:id` | MATCH-006, MATCH-007, MATCH-008, MATCH-009, MATCH-010, MATCH-011, MATCH-012, MATCH-013, MATCH-016, MATCH-017 |
| CAP-MATCH-003 | challenge/revenge | MATCH | `/players/:userId`, `/matches/:id`, `/rankings`, `/` | MATCH-014 |
| CAP-JUDGE-001 | live judge | JUDGE | `/matches/:id/judge`, `/matches/:id` | JUDGE-001, JUDGE-002, JUDGE-003, JUDGE-004, JUDGE-005, JUDGE-006, JUDGE-007, JUDGE-008, JUDGE-009, JUDGE-010, JUDGE-011, JUDGE-012 |
| CAP-TOURNAMENT-001 | collect | TOURNAMENT | `/start`, `/tournaments`, `/tournaments/:id` | TOURNAMENT-001, TOURNAMENT-002, TOURNAMENT-003, TOURNAMENT-004, TOURNAMENT-005, TOURNAMENT-006 |
| CAP-TOURNAMENT-002 | lifecycle plus scoped admin catalog/detail/manual add | TOURNAMENT | `/tournaments/:id`, `/matches/:id`, `/admin` | TOURNAMENT-007, TOURNAMENT-008, TOURNAMENT-009, TOURNAMENT-010, TOURNAMENT-011, TOURNAMENT-012, TOURNAMENT-013, TOURNAMENT-014, TOURNAMENT-015, TOURNAMENT-016, TOURNAMENT-018, TOURNAMENT-019 |
| CAP-TOURNAMENT-003 | detail | TOURNAMENT | `/tournaments/:id` | TOURNAMENT-017 |
| CAP-TEAM-001 | lifecycle | TEAM | `/teams`, `/teams/:id`, `/start`, `/matches/new` | TEAM-001, TEAM-002, TEAM-003, TEAM-004, TEAM-005, TEAM-006, TEAM-007, TEAM-008, TEAM-009 |
| CAP-HISTORY-001 | history feed | RESULTS | `/history`, `/matches/:id`, `/tournaments/:id` | HISTORY-001, HISTORY-002, HISTORY-003, HISTORY-004 |
| CAP-RANKING-001 | ranking browse | RESULTS | `/rankings`, `/players/:userId` | RANK-001, RANK-002, RANK-003, RANK-004, RANK-005 |
| CAP-PROFILE-001 | own profile | RESULTS | `/profile` | PROFILE-001, PROFILE-002, PROFILE-003, PROFILE-004, PROFILE-006 |
| CAP-PROFILE-002 | public profile | RESULTS | `/players/:userId` | PROFILE-005 |
| CAP-NOTIF-001 | notifications center | RESULTS | `/notifications`, `/`, `/profile` | NOTIF-001, NOTIF-002, NOTIF-003, NOTIF-004, NOTIF-005, NOTIF-006 |
| CAP-HELP-001 | help/feedback | AUTH | `/help`, `/matches/new`, `/matches/:id/judge`, `/rankings` | HELP-001, HELP-002, HELP-003 |
| CAP-ADMIN-001 | users/audit | ADMIN | `/admin` | ADM-001, ADM-002, ADM-003, ADM-004, ADM-005, ADM-006, ADM-007, ADM-008 |
| CAP-ADMIN-002 | match safeguards | ADMIN | `/matches/:id`, `/history` | MATCH-016, MATCH-017 |

## Изменения D35

Оператор может создать обычный матч для других; приглашения добровольны. Режим подтверждений турнира выбирается при создании и затем неизменен. Организатор и активный admin имеют явно ограниченную возможность ручного включения; до старта добавление в построенную сетку связано с атомарной перестройкой. Scoped admin catalog/detail не дают прочие права организатора. Это описание candidate source; точное runtime поведение принимает GAP-012.

HOME и помощь исследуются пакетом AUTH; профиль, публичная карточка и уведомления — RESULTS. COMPONENTS проверяет состояния поперёк этих функций и не заменяет их сценарный аудит.

Источники: [PRD](../../requirements/04_PRD.md), [приёмка](../../requirements/11_ACCEPTANCE_TEST_CATALOG.md), [UX](../../requirements/05_UX_FLOWS.md), [маршруты](../../../apps/web/src/App.tsx). EMPTY-001–006 и AUDIT-001–003 проверяются как поперечные ограничения в каждом применимом пакете; они не исключены из исследования.
