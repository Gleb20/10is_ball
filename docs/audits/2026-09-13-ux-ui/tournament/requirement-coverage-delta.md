# TOURNAMENT: покрытие требований в ограниченном UX/UI-аудите

База: `9f71b9f` + frozen GAP-012 r6 candidate fingerprint `8e876257…`; runtime build не опубликован. Статусы ниже относятся только к пользовательскому представлению и собственным browser-runs этого пакета. Полный принятый технический gate 1257/1257 переиспользуется как контекст и не превращается в UX PASS.

| Требование | Собственный run | Статус | Evidence / ограничение |
|---|---|---|---|
| TOURNAMENT-001 создание и форматы | T-RUN-001/002 | PASS | SE/DE, title, organizer=false, consent=false; `runtime-observations.json` |
| TOURNAMENT-002 3–64 участников | T-RUN-001/002 | PARTIAL | UX проверен на 3/5/8; границы 2/65 и max64 только в accepted technical evidence |
| TOURNAMENT-003 алгоритмы сетки | T-RUN-001/002 | PASS | compact и power_of_two, V2, обе схемы |
| TOURNAMENT-004 приглашения/статусы/команда | T-RUN-004/006 | PASS | accepted, pending, declined, expired response, withdrawn, team override + notification |
| TOURNAMENT-005 consent policy | T-RUN-001/004/005 | PASS_WITH_FINDING | direct/consent/manual override; F-TOURNAMENT-005 |
| TOURNAMENT-006 явное подтверждение override | T-RUN-004/005 | PASS | dialogs называют пользователя, турнир, override и regeneration |
| TOURNAMENT-007 активный состав | T-RUN-001/002/005 | PASS | minimum, active-only, no organizer, post-start rejected without mutation |
| TOURNAMENT-008 расстановка и swap | T-RUN-005 | PARTIAL | prefix retained after additions; ручной swap не выполнялся в собственном run, technical acceptance reused |
| TOURNAMENT-009 визуализация, BYE, zoom | T-RUN-002/003 | PASS_WITH_FINDING | SE/DE 3/5/8, BYE cards, keyboard/scroll; F-TOURNAMENT-004 |
| TOURNAMENT-010 роспуск сетки | T-RUN-007 | PASS_WITH_FINDING | collecting + roster retained; F-TOURNAMENT-001 — нет подтверждения |
| TOURNAMENT-011 выход участника | T-RUN-004/007 | FAIL_UX | pre-generation withdraw works; generated withdraw вызывает needs_regeneration без обязательного предупреждения, F-TOURNAMENT-002 |
| TOURNAMENT-012 старт | T-RUN-005/006/007 | PASS | organizer start, bracket/current matches, post-start add rejected |
| TOURNAMENT-013 one active match/concurrency | — | REUSED_TECHNICAL | не UX-проверка; accepted GAP-012 PostgreSQL gate, собственный concurrent run не повторялся |
| TOURNAMENT-014 match completion/no-show | T-RUN-006/007 | PARTIAL | обычное завершение и advancement проверены; no-show/manual loss не выполнялись в UI |
| TOURNAMENT-015 итог/места | T-RUN-007 | PASS_WITH_FINDING | finished top3/places/played matches корректны; ранний summary F-TOURNAMENT-003 |
| TOURNAMENT-016 stop | T-RUN-007 | PASS | reason required, stopped без выдуманных мест, scoped admin 403 |
| TOURNAMENT-017 detail/current/next | T-RUN-005/006 | PASS_WITH_FINDING | role views, next→current→next; ранний summary F-TOURNAMENT-003 |
| TOURNAMENT-018 cancel | T-RUN-007 | PASS_WITH_FINDING | status cancelled подтверждён; F-TOURNAMENT-001 — одно касание |
| TOURNAMENT-019 legacy V1 DE | — | REUSED_TECHNICAL | frozen accepted regression evidence; собственный V1 browser fixture не создавался |

Acceptance catalog: собственные наблюдения дают частичное evidence для AT-TRN-001, 003–005, 007–014, 016 и 022. Они не объявляются полным acceptance там, где catalog включает дополнительные negative/concurrency ветви. AT-TRN-002, 006, 015, 017–021 и 023 либо не повторялись этим UX-пакетом, либо используют только frozen technical evidence; это не собственный UX PASS.
