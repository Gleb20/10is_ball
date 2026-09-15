# Координация и handoff

Этот файл описывает ход исследования и владельцев, а не второй backlog. Scope TECH-006; продуктовая подготовка GAP-012. Родитель: `01a09c2f-d33a-7773-804e-cde75aafab83`.

## Текущее состояние — 2026-09-14

GAP-012 принят координатором locally: r6 immutable52paths, fresh1257/1257, Terra static/runtime PASS. Код публично не выпущен. Pilot390 завершил create→score→handover→result→next-form; desktop проверил keyboard/mixed-input и коррекцию. Research продолжается; исходный dirty checkout сохранён.

| Пакет | Модель | Текущее состояние | Следующий gate |
|---|---|---|---|
| GAP-012 | Sol High | verified_local accepted; task01a09c5c-ae93-7d63-bce7-fe7908b8109c idle | Только отдельный release при запросе |
| COMPONENTS | Sol High | task01a09c5d-45d9-7a32-8c0a-f8c8ac13c35c; recheck и mandatory correction приняты, оба imported exact hashes | Адресная проверка при новых данных |
| Pilot | Coordinator | [report](pilot/report.md), runs/target/wireframes/GAP013 приняты Terra; stand4617/4618 очищен | Синтез первой волны |
| Inventory | Luna | 22CAP/108REQ source inventory; не runtime coverage | Package requirement-coverage deltas |
| AUTH | Sol High | Frozen45 payloads принят Terra и root; четыре задачи ready; стенд очищен | RESULTS дополнил coverage с явными пределами |
| MATCH | Sol High | Frozen79 evidence и root core-target приняты, автор idle | Реализация только отдельной задачей |
| JUDGE | Sol High | Frozen67 evidence и core/recovery приняты с mandatory coverage correction; ресурсы absent | Реализация только отдельной задачей |
| TOURNAMENT / TEAM | Sol High | Frozen51/39 приняты Terra/root с обязательными overlays; стенды очищены | Targets приняты; RESULTS/ADMIN и итоговая согласованность |
| RESULTS | Sol High | Frozen40 + results-correction приняты Terra/root, стенд очищен | Финальный синтез |
| ADMIN | Sol High | Frozen35 + admin-correction приняты, GAP026/027 ready; BUG038 target принят | Будущая implementation verification |
| Review | Terra High | reusable research_protocol_review | Приняты35 targets и coverage108/72; финальная согласованность |

Открыто: Q-UX-001 о закрытии pending Dialog, Q-UX-002 team avatar, Q-UX-003 minimal admin read; фактическое основное устройство пользователя пока неизвестно; пользовательское прохождение не проведено. Никакая из найденных UI-проблем не объявлена исправленной.

Дочерние пакеты завершены: JUDGE correction probe принят, стенд очищен; BUG039 ready; ADMIN reset contract принят с обязательным overlay, BUG038 ready; Terra выполняет финальный review. Прежние пакеты неизменны, canonical пишет root. Максимум три дочерние работы одновременно.

Последний durable checkpoint: `artifacts/ux-audit-2026-09-13/core-checkpoint-07`,529 paths, manifest0639520ccddf0aa865a84504df49a6374e4f935db35529f836c50954e0f055fa; round-trip hashes и docs122/74 PASS. Снимок содержит core acceptance, но предшествует TOURNAMENT/TEAM и следующим пакетам. Следующий checkpoint включит синтез.

## Порядок и ограничения

Максимум три дочерние работы одновременно. Не запускать отдельного агента ради одной записи. Shared DB/ports/browser — один owner; параллельные проверки только на разных ресурсах. Не назначать новый writer пока предыдущий не остановлен. Точный threadId/cwd/ports/evidence внести после подтверждения запуска.

Родитель интегрирует только именованный task delta. Не копировать целиком чужую dirty ветку и не делать reset/clean. Канонические документы GAP-012 пишет его worker в своём worktree; coordinator до интеграции добавляет только исследовательский scope TECH-006. Разрешённых commit/push/deploy в этом плане нет: принятая задача явно отделяет выпуск.

## При перерыве

Сохранить: active threadId/cwd, owners и paths, source manifest, progress/partial outputs, команды и ports, вопросы и next gate. Не помечать аудит или подготовительную реализацию завершёнными из-за исчерпания времени/контекста. Возобновление начинается с wait_threads snapshot и проверки изменившихся файлов, не с полного повторного аудита.

## Спринты будущей реализации

S0 — принятый GAP-012 и новая исследовательская база. Остальные спринты формируются после evidence: S1 основной путь и блокирующие общие компоненты; S2 системные паттерны и обнаружимость; S3 турниры/команды; S4 остальные доказанные локальные улучшения. Это ориентир, не приоритет готовых задач. Любой доказанный P0/P1 поднимается независимо от пакета. У каждого спринта будет наблюдаемый outcome, входные зависимости, задачи и exit checks; сроки до оценки объёма unknown.

## Проверенный checkpoint

Исследовательский foundation принят Terra High; 317source hashes matched, 30scenarios/60planned runs, docs links/diff check PASS. Основной аудит ещё не выполнен. Sol High для substantive audit выбран явно пользователем в принятом плане; Luna остаётся для inventory/recording, мелкие проверки выполняет coordinator.

## Координаторские уточнения GAP-012

Проверена первая спецификация worker до freeze. Минимальные defaults: ручной creator не играет по умолчанию; challenge/revenge сохраняют player prefill; выбор игроков не рассылает invites, нужен явный opt-in; ручное включение подтверждается именованным диалогом и серверным флагом, без перепечатывания имени; tournament policy выбирается при создании и затем неизменна (редактирование режима пользователь не запрашивал). Existing roster/history не получает ретроактивного согласия. Admin DTO ограничивается нужными полями, прочие organizer powers не расширяются. Старый side-swap consent resend и исключение teammates из явного invite требуют адресной проверки. Worker принял первую группу уточнений; acceptance pending.

Лично просмотрены component screenshots: auth1440 pointer-focus показывает внутреннюю прямоугольную обводку внутри округлой рамки; history native select390 имеет внешний округлый ring. Причина/computed styles и target spec запрошены у component worker. FullPage autocomplete screenshot признан недостаточным для focused-state evidence; требуется viewport/close-up. Это intermediate observation, не принятый итог пакета.

## Контроль качества в ходе работы

GAP-012: первая переработка GAP-008 слишком сильно сократила старые регрессии. Координатор вернул требование сохранить проверку истории приглашений, cancel/purge, notification rollback и roster identity, изменив только устаревшие обязательные consent/автоприглашения. В актуальном WIP файле эти сценарии восстановлены; полный gate ещё не принят. Web writer остаётся исходный Sol, поскольку он уже редактирует страницы; второй writer не назначен.

COMPONENTS: первоначальный F-CMP-005 отправлен на перепроверку, потому что сборщик не сохранял aria-current, а React Router NavLink выставляет его автоматически на совпадающем route. Отсутствующее измерение не доказывает отсутствие атрибута. Пакет до исправления не принят. Остальные findings требуют независимого review по raw evidence; число находок не является KPI.

Immutable checkpoint foundation-01 сохранён в исходном workspace только как новый artifact: artifacts/ux-audit-2026-09-13/foundation-01. Экспорт содержит 15 paths, manifest SHA256 69c392e2b77bb68c90764e9cf623c3bec97b96ab96bccb15e78e30e730554a44. Проверено восстановление в чистой копии /private/tmp/tab10-ux-export-verify-01: patch apply, все file hashes, docs audit PASS. Это checkpoint документов, не реализация и не release.

COMPONENTS frozen: /Users/liubavskii/.codex/worktrees/e1f7/tab10/docs/audits/2026-09-13-ux-ui/components/, 40files; payload manifest SHA2563354f54230bb5ebb32c88874950a1051f2adc7162fccae7d6ae1cbe46b555cbf. Stand stopped, DB removed. Immutable export /private/tmp/tab10-components-review-01 has 40paths, export-manifest SHA25605010d0a350b5cfa6f741252a648191d754bf3976c4405293c6e9a4131de31c2. Reviewer independently checks five remaining findings and coverage completeness; package not yet accepted.

COMPONENTS cycle1 Terra PASS для пяти findings; full coverage INCOMPLETE явно. Payload импортирован в coordinator без изменений. Canonical BUG-018/019/020 statusconfirmed, notready до GAP-012 recheck. Reporter новую turn не запускает; reviewer свободен для следующего frozen scope. Пилот run-plan создан, actualrun ещё не начат.

COMPONENTS supplement dispatched в ту же отдельную задачу SolHigh после PASS: новый exclusive path components-supplement/**, прежний frozen components/** immutable. Scope выполнимые checkbox/radio/dialog/menu/feedback states,390/1440; старый matchflow не повторять. Autocomplete на изменённых формах ждёт GAP-012 recheck. Ports4517/4518 вновь его owner. Это закрытие coverage, не новая UI реализация.

GAP-012 code/contract review cycle1 started independently while worker checks run: immutable /private/tmp/tab10-gap012-review-r1, 46paths, export manifest6808f96cfa1c13fd9ad18a8c1a027350a9799fc358139a67c08c48df955ab815. Source export+restore allhashesPASS. Terra reads only frozen copy; ba9f remains solewriter and may fix test failures. Any laterdelta needs scopedreview beforeacceptance. Final fullci/browser stillpending.

GAP-012 r1 REWORK: threeP1 (purposefulsource creator guard, side-effecting outsideradminGET, legacyV1 swaps lost onadd) and staleAPI assertionP2. SameSolwriter received exactfixes+regressions; currentfullgate may be stopped withcleanup, noacceptance onrejectedbytes. Frozenreviewreceipt gap012-review-r1.json. OldGAP008 lifecyclecoverage restoration accepted; do notrepeat that entire review absentdelta.

GAP-012 r2 frozen /private/tmp/tab10-gap012-review-r2;49paths/exportmanifest4a2f8f9f4fc0094cc92513d933ab2711eef296a8bd856e350198e0ee7df2ff7c. Sevenchangedpaths since r1; Terra scopedre-reviewactive. Worker reports exactly3Red regressions→6/6Green, focusedrealPG7/7 and APItypecheck. Finalfullci waitsreview; these narrowchecks notaggregateacceptance.

GAP012r2 REWORK: threepreviousfixes/mechanicaldeltaaccepted; historicalV1swaps stilllost because fixcoversfuturepatchonly. Scope explicitly narrowed to regeneration+historicalfixture; nofullgateuntilfixed. Originalr1/r2 receipts retained. Solremainswriter; parent/reviewercheckactuallegacydatawithoutinvokingnewpatchAPI.

GAP012historicalcompat correction frozenr3: /private/tmp/tab10-gap012-review-r3,49paths/exportmanifestc60920f545e007ec656ee88194430acd6999558e7a531edb4f1904a22ad91b5e. Deltaтолькоtournament-service+gap012integrationtest. Pendingtargetedreview; workerreports11/11legacy+GAP andtypecheck. Fullciwaits. COMPONENTS supplement meanwhilefrozen; reviewactive,2runtimeP2+1sourcehypothesis proposed,notyetaccepted.

GAP012r3staticPASS; finalfullci worker. Первыйfinalrun reportedquality1123/1123+PG71/71, ChromiumMacsandboxdenybeforeteststeps; cleanupPASS, samebytesrerunoutsideconstraint underway. Neveracceptthatfailedbrowserrun. Coordinatorr3source integrated:35changedapp paths matchfrozenmanifest;3canonicaldocs merged retainingTECH006andcomponenttasks. OwnbuildPASS, migrationfoundation9/9PASS, sameoriginhealth/release test+dirtyverified. Pilotruntimepreparation.json: web4617 session11992/API4618 session35633, DBprojecttab10-ux-pilot-4617 port33007. FixtureC/A/B/D/E allordinaryusers prepared; noauditrunsyet. Privatefixturescript /private/tmp/tab10-ux-pilot-fixtures.mjs mustnotbeexportedasusercredentialdoc. Cleanup ownweb/API/DBwhenresearchdone.

2026-09-14: Terra PASS для BUG-021/022/Q-UX-001/dialog-target (dialog-task-review.json). COMPONENTS r3 recheck отправлен прежнему Sol, новый scope components-recheck/**; prior payload immutable. Собственный стенд4517/4518, отдельная clean temporary copy candidate; не coordinator runtime. Chromium coordinator launch-only PASS после разрешённого escalated exec. Полный GAP-012 browser gate пока pending; pilot не начат.

Inventory rework: Luna исправила baseline и package ownership, но дважды оставила поля current/proposed только на общем уровне. Координатор завершил ограниченное преобразование каждой CAP-записи и проверил 22/22 обязательных поля. Далее этот recorder допускается к обновлениям только с явным машинным критерием приёмки; численность CAP/REQ сама по себе не доказывает полноту формы.

GAP-012 r4 static PASS: пять E2E-файлов исправляют подтверждённые устаревшие ожидания; app bytes r3 неизменны. 52 пути frozen export проверены, manifest 5f0d7853df348e981d8686e58b953e30b1902e7b7ebaf59c6eefb1d2eb2127d6. Эти пять файлов интегрированы в coordinator; fresh full gate поручен worker. Browser driver coordinator подготовлен, session32706, но ещё не посещал страницы.

GAP-012 r5 static PASS: один E2E fixture исправлен на active registered player, который всё ещё не принимал турнирное приглашение. Остальные права/assertions сохранены. Manifest 1cbc60895e9031519443fade7729526b3a86e9a1923d3f7ed8b5a47b0b7cae39, 52 paths. Следующий обязательный порядок: focused compiled browser по всем ранее падавшим сценариям desktop/390 → полный fresh gate. App bytes r3 неизменны. Inventory после адресных исправлений принят Terra; receipt inventory-review.json.

CORRECTION r5: предположение исполнителя/reviewer о неактивности аккаунта до первого входа опровергнуто координатором по schema/createUser/listDirectory и runtime probe. Новый аккаунт уже active и виден directory при mustChangePassword=true. DisplayName возвращается в порядке «Фамилия Имя»; fixture искал «Имя Фамилия». Review r5 отозван в части заявленного устранения root cause, полный gate приостановлен до DOM/focused evidence. Безопасное доказательство: preparation-evidence/new-account-directory.json. Проверка не относится к UX pilot.

GAP-012 r6 static PASS и интегрирован в coordinator: label LAST FIRST и partial query согласованы с runtime, account/directory preconditions проверяются до UI. Manifest 6dec4f2dcf87b82a75dce3e439ee24ec55cd1486411db681919df50414c39292. Выполняется focused12 → freshfull. Coordinator browser driver старый session32706 остановлен; актуальный session3280 с raw stdin. Диагностические прогоны PREP-DIAG-01..04 не считаются основным пилотом; создан отдельный collecting synthetic tournament cd994b4a-bf06-4067-a495-6612ea2e495f без участников. Основной UI pilot ещё не начат.

2026-09-14: GAP-012 FINAL ACCEPTED LOCAL. 1257/1257,0fails/skips/todo/interrupted; Terra runtime PASS; frozen52-path export точносовпадаетr6. Workeridle, cleanupподтверждён; отправкаегоhandoffбылаотклоненаприложением, coordinatorполучилрезультатразрешённымread/waitиreceipt, повторнаяотправканенужна. Canonicalclosureсделалcoordinator. Новаябазаcandidate-source.json323paths; пилотдопущен. Диагностическийтурнирcancelled,diagnosticaccountsessionlogout/closed;sourceappunchanged.


## Dispatch wave1 — после Terra PASS пилота

Frozen export /private/tmp/tab10-ux-audit-dispatch-v1,310paths,manifestc39ed47d9aaaadfba7fac3790bde26acac772ae9946e2f1c99bcdb6a1d46b3a6. Три задачи SolHigh; реальный ID/cwd подтверждён read_thread, не clientThreadId.

| Пакет | threadId | worktree | web/API/PGproject | Scope |
|---|---|---|---|---|
| AUTH | 01a09cf8-2548-7463-8856-091f7b704c38 | 99f2 |4717/4718/tab10-ux-auth-4717|auth/**|
| MATCH | 01a09cf8-c961-72e3-a2df-0fbf5cdeae6c | f45a |4817/4818/tab10-ux-match-4817|match/**|
| JUDGE | 01a09cf9-72bb-74a1-b0dd-2aeb521b7306 | 06d3 |4917/4918/tab10-ux-judge-4917|judge/**|

Пока эти три активны, reviewer/новые пакеты не запускаются. Следующие TOURNAMENT/TEAM/RESULTS/ADMIN получают свободные места после review/acceptance. Подготовка и COMPONENTS idle. Родитель singlewriter canonical; новые BUG024–026 confirmed, ещё на review, не ready. После принятия общих постановок сообщить пакетам номера для dedup.


2026-09-14: coordinator pre-review synthesis records BUG027/028 and GAP014–016 as confirmed, notready; immutable AUTH package/reviewer receipts pending. Source inspection confirms FirstPassword navigate-only exit, ordinary Profile logout not implicated. AUTH evidence provenance typos and Russian narrative returned to author before freeze. MATCH replacement invite reframed as explicit UI entry gap, not erroneous absence of auto-invite (D35). JUDGE reports P1 lost response with repeat instruction; root requested exclusive runtime handover for independent minimal reproduction. No package accepted by author self-report.


MATCH frozen imported79payloads SHA3d855c482a0227a85f16f9324e468f26acf6270dce16bddd982b1acf9366892d, authoridle. Review snapshot /private/tmp/tab10-ux-wave1-review-01,390paths exportSHA4e83f7785458f3486437dd7c78650c90a35ee58e6161b84da2c90222f5c0ae0b. Independent review interrupted by usage limit (no verdict), later fresh tool reported ordinaryUsageAllowed=true/used1%; resumed same reviewer and AUTH/JUDGE partial tasks. MATCH pending review, not accepted. JUDGE disposablePG33019 projecttab10-ux-judge-4917 remains for rootrecheck; web/API stopped; cleanup pendingroot. Rootminimal repro authored at /private/tmp/tab10-ux-root-score-repro.mjs, syntaxcheckPASS, not executed yet.


## Сводка после первой волны — 2026-09-14

AUTH принят: 45 payloads, manifest f0b1eb402e85aa362367a7fb4d3f99c4dd7edd330ec50920d21751f7e1e16c39, [receipt](auth-review.json). BUG-027/028 и GAP-014/016 ready; GAP-015 ждёт populated Home и общего action contract. MATCH evidence PASS, target REWORK: [receipt](match-review.json), [согласование](core-target.md). Frozen пакеты не переписываются.

JUDGE последняя возобновлённая turn закончилась пустой; вновь отправлено ограниченное завершение provenance/manifest/cleanup, без нового полного прогона. Владелец judge/** сохраняется. Передача приватного runtime handoff была отклонена автоматической проверкой; coordinator не использовал его и создал независимый stand5017/5018. BUG-029 лично воспроизведён, 8/8 условий; первая попытка setup ошиблась NODE_ENV и не считается UX-run. Успешная попытка: migration9/9, Chromium390, точный key/readback; весь свой stand/PG очищен,323 source hashes неизменны. [Receipt](coordinator-rechecks/judge-outcome/receipt.json). Очистка старого JUDGE стенда остаётся обязанностью его автора, не root.

| Пакет | threadId | worktree | web/API/PG project | Scope |
|---|---|---|---|---|
| TOURNAMENT | 01a09ed5-7264-78c0-9019-c03285153ed0 | d23d | 5117/5118/tab10-ux-tournament-5117 | tournament/** |
| TEAM | 01a09ed9-70fd-7990-977f-8f18ea3b0e5e | 5758 | 5217/5218/tab10-ux-team-5217 | team/** |

Оба используют неизменный dispatch-v1 и323 source hashes. RESULTS/ADMIN ещё не начаты. Пока JUDGE/TOURNAMENT/TEAM активны, reviewer не запускается: максимум три дочерние работы. Подготовительная задача получила отдельное продолжение пользователя; её persistent DB/локальный запуск не входят в UX-стенды и не меняют принятую r6 evidence.


JUDGE завершение подтверждено по свежему original manifest: 67 payloads SHA2d52de7833695a17a4bef74229157ca85ea44845cdeec66377207e57f3f9a9dd. Luna копия не понадобилась как новый authority: original package импортирован exact bytes. Root прочитал Docker labels и TCP listeners: собственных JUDGE containers/networks/volumes нет,4917/4918/33019free; [cleanup](coordinator-rechecks/judge-cleanup.json).

Core review dispatch: /private/tmp/tab10-ux-core-review-01,522 paths, exportSHAcd77b889bc152cd61a02a1c598088276384fd1ec35c5a378931fb25afb1e2523. Scope JUDGE evidence + score-recovery-target + core-target/schemes + GAP013/017/018,BUG030 и shared024/025/026. Terra active, TOURNAMENT/TEAM active — три работы. Root отдельно исправил ложное coverage PROFILE005 в AUTH delta: public card не подтверждается session list; обязательная [коррекция](auth-coverage-correction.md). Frozen AUTH не изменён.

Добавлены user-session protocol и пустая таблица наблюдений: интервью не проводилось. ROOT docs120/73 PASS, git diff whitespace PASS; схема390/1440 отрендерена, mobile create/detail просмотрены; это структурный proposal, не runtime новой UI.
