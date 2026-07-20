# Requirements ↔ Tests Traceability

Эта таблица должна обновляться в каждом PR.

| Requirement group | Primary tests | Test layers | Critical |
|---|---|---|---|
| AUTH-001..008 | AT-AUTH-001..008; REQ_ui__auth_layout (UI-5) | unit, integration, API, E2E, component | yes |
| ADM-001..008 | AT-ADM-001..005; REQ_ui__temp_password_copy, admin_confirm_dialogs (UI-5) | integration, API, E2E, component | yes |
| HOME-001..006 | AT-EMPTY-001, AT-RANK-*; shell IA = ADR D5; AsyncState/ListRow/StatusChip; Home hero+podium (UI-3) | component, API, E2E | medium |
| MATCH create picker | API_GET_users_directory; REQ_ui__match_create_autocomplete | API, component | high |
| PROFILE-001..006 | profile contract tests | unit, API, component | medium |
| RANK-001..005 | AT-RANK-001..004 | unit, integration, API | yes |
| HISTORY-001..004 | AT-VIS-*, AT-VIS-003 | integration, API, E2E | high |
| MATCH-001..015 | AT-MATCH-001..012 | unit, integration, API, E2E | yes |
| JUDGE-001..012 | AT-JUDGE-001..006; REQ_ui__judge_immersive / serve / landscape (UI-4) | integration, API, E2E, component | yes |
| TOURNAMENT-001..017 | AT-TRN-001..013 | unit, integration, API, E2E | yes |
| TEAM-001..009 | AT-TEAM-001..006 | unit, integration, API | high |
| NOTIF-001..006 | AT-NOTIF-001..004 | integration, API, component | medium |
| ONB-001..005 | AT-ONB-001..002, AT-MATCH-012; highlight tabs per ADR D5 | integration, E2E | medium |
| HELP-001..003 | feedback/FAQ contract tests | API, component | low |
| EMPTY | AT-EMPTY-001 | component, visual | medium |
| AUDIT | audit integration tests | integration | high |
| NFR-002 perf | INT_load__ten_parallel_matches_meet_slo | integration (load) | yes |
| NFR-007 backup | scripts/backup-rehearsal.sh | ops script | high |

## Naming convention

- Unit: `REQ_<group>__<rule>`
- Integration: `INT_<group>__<behavior>`
- API: `API_<method>_<route>__<behavior>`
- E2E: `E2E_<journey>__<outcome>`

## Review rule

Если requirement изменён:
1. соответствующий acceptance scenario изменяется первым;
2. тесты должны упасть;
3. затем меняется реализация;
4. matrix остаётся согласованной.
