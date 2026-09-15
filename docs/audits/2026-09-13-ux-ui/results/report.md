# RESULTS UX/UI audit

**Статус:** READY_FOR_REVIEW — пакет не принят и UI не изменён.

**Baseline:** local unpublished 3.0.0, `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221` + accepted GAP012r6; 310-file dispatch manifest `c39ed47…`, 323-source fingerprint `8e8762…`. Точные значения — в `evidence/baseline.json`.

## Итог

Основные RESULTS-функции проходят scoped сценарии: 22-матчевая история с pagination/recovery, общий/месячный/командный рейтинг, собственный и публичный профили, blocked historical profile, отзыв другой сессии, pending/declined/expired/source-unavailable уведомления, populated Home и tutorial isolation. Найдено два runtime defect и три экспертные гипотезы; P0/P1 нет. Наблюдений реальных пользователей, частот и количественной оценки пользы нет.

Ключевой межпакетный результат: populated Home подтверждает все пять метрик, rival/revenge, ranking period, recent five, profile и notifications — GAP-015 можно переставить action-first без удаления функций. F-PILOT-005 уточнён: после judge release Home показывает бывшего судью как `Судья`, хотя authoritative `activeJudge=null`; detail корректно требует `Судить`, поэтому расширение прав не обнаружено.

## Метод и границы

- Полностью прочитаны канонические PRD/AT/ADR, audit dispatch, accepted core target и source seams.
- Применены `userflow` (`flow-settings`, `flow-tables`, `flow-search`, `flow-navigation`) и `interface-design`: сначала task completion/recovery, затем hierarchy без смены бренда.
- Exact candidate tree проверен программно; initial build прошёл после явной release metadata. Полный 1257 gate не повторялся и не заявляется.
- Собственный PostgreSQL compose `tab10-ux-results-5317`, ports web5317/api5318/PG33029; migration foundation 9/9.
- Финальный replay прошёл на заново созданной disposable DB; synthetic credentials и cookies не сохранены. Скрипт fail-closed требует exact compose project и opt-in к fixture SQL.
- Chromium: 390×844, 360×780, 1440×1000; API authoritative readback для critical states. Focused web tests: 34/34.
- Intentional 503 pagination и 400 profile validation объясняют два console resource errors; иных console errors не записано.

## Findings

| ID | Kind | P | Вывод | Дедупликация |
|---|---|---:|---|---|
| F-RESULTS-001 | expert_hypothesis | P2 | History search row не называет соперника/контекст совпадения | Не BUG-023; отдельный presentation contract |
| F-RESULTS-002 | expert_hypothesis | P3 | Search/filter отсутствуют в URL; специальный detail→Back при этом проходит | Новая, продуктовая потребность неизвестна |
| F-RESULTS-003 | runtime_defect | P2 | 400 профиля сохраняет draft, но ошибка generic, не связана с полем, focus=body | Не BUG-024/021 |
| F-RESULTS-004 | runtime_defect | P3 | Just-read non-actionable row остаётся под `Актуальные` до refresh | Новая local lifecycle рассинхронизация |
| F-RESULTS-005 | expert_hypothesis | P2 | Released judge label на Home противоречит free slot в detail, но права сохранены | Уточнение F-PILOT-005/GAP-015, не новый backlog item |

Полные формы — `findings.json`; target behavior и Given/When/Then — `target-spec.md`.

## Сценарные результаты

### SC-R01 — History + populated Home

- History загрузила 20 строк и `Показать ещё`; injected next-page 503 сохранил существующие строки и recovery.
- Existing detail-return contract с actor-scoped snapshot прошёл focused test; direct URL state отсутствует (F-RESULTS-002).
- Search по фамилии сработал, но rows не показали фамилию/роль/date/format (F-RESULTS-001).
- Home показал 22/18/4/82%/1.6, rival после 22 очных матчей, ranking period, five recent events, notifications/profile.
- Released judge: API `activeJudge=null`; Home `Судья: Результатов Роман · Вы судили`; detail `Судья не назначен` + `Судить`. Score rights не проверялись вызовом, потому что UI guard уже не предложил их.

### SC-R02 — Rankings

- Общий all-time, month и team scope отрисованы; команда содержит двух active members.
- Podium/list ведут в own/public profile; self challenge отсутствует, rival challenge есть.
- Effect cleanup отбрасывает superseded responses; focused tests прошли. Week calendar/DST boundary не воспроизводился отдельным браузерным fixture.

### SC-R03 — Profile, sessions, tutorial

- Own profile показывает identity, email, D10 avatar note, all stats/facts/team; public profile скрывает email/birth date и предлагает challenge.
- Blocked historical target читаем и не имеет challenge; blocked user отсутствует в ranking.
- Revoke другой session: confirm/pending, rows 1→0. Focused runtime: same actor сохраняет draft, другой actor очищает, mutation остаётся единственной попыткой.
- Profile over-limit validation воспроизводит F-RESULTS-003; сохранение draft само по себе проходит AT-PROFILE-004.
- Tutorial завершён; history count, stats, ranking row и rival byte-equivalent не изменились; tutorial ID отсутствует. D34 completion оставался null до explicit `complete`.

### SC-R04 — Notifications

- Pending read invitation остаётся actionable, unread badge очищается; declined/timeout/source_unavailable видны в history без actions.
- Expired/terminal rows popup не вызвали; живой pending вызвал одну ненавязчивую шторку.
- F-RESULTS-004 воспроизводится до refresh; после server refresh row исчезает из Actual.

## Anti-pattern review

| Check | Verdict | Evidence |
|---|---|---|
| Search result explains match | FAIL | F-RESULTS-001 |
| Filters visible and reversible | PASS | filter dialog, applied summary/reset, empty recovery |
| Stateful view survives detail Back | PASS | HistoryPage focused test |
| Stateful view reproducible by URL | WARN | F-RESULTS-002 |
| Ranking tabular comparison keeps labels/actions | PASS | all/month/team screenshots |
| Settings save is explicit and draft survives failure | PASS | profile validation screenshot/runtime facts |
| Invalid field is localized/focused | FAIL | F-RESULTS-003 |
| Read and actionable are independent | PASS | pending read retains actions |
| `Actual` filter matches visible lifecycle | FAIL | F-RESULTS-004 |
| Navigation does not infer rights | PASS | free-slot detail requires acquire |
| Current/historical judge label is unambiguous | WARN | F-RESULTS-005 |

## Evidence index

- Replay: `evidence/replay-results-audit.mjs`.
- Runtime facts and fixture labels: `evidence/runtime/runtime-facts.json`, `fixture-index.json`.
- 16 origin screenshots: `evidence/runtime/*.png`.
- Migration: `evidence/migrations/*`.
- Focused verification: `evidence/focused-tests.txt`.
- Source pointers: `evidence/source-map.md`.
- Target schemes: `wireframes.html`, `evidence/target-wireframes-390.png`, `evidence/target-wireframes-1440.png`.
- Full run ledger: `runs.csv`; REQ/AT delta: `requirement-coverage-delta.csv`.

## Limitations and residual risk

- **NOT_TESTED:** physical mobile, WebKit, spoken screen reader, true browser zoom. CSS zoom was not substituted.
- No user session: impact/frequency for all expert hypotheses is unknown.
- Browser coverage is Chromium and selected states, not full WCAG or cross-browser certification.
- Team invitation 14-day boundary, ranking guest contribution/DST boundary, browser empty Home and every long-text permutation were not replayed here; coverage CSV states each gap.
- Source-review and focused tests are not relabelled as production evidence. Public stand was not touched.

## Reviewer checklist

Confirm exact baseline; inspect five findings against runtime paths; verify that F-RESULTS-005 is merged into GAP-015 rather than duplicated; decide only the optional notification label; review target API display fields and auth-session guards. Reviewer verdict must be PASS/REWORK/INCOMPLETE. Until then the package remains READY_FOR_REVIEW.
