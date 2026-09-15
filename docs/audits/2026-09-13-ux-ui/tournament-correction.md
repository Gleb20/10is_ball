# Координаторская коррекция TOURNAMENT перед review

Статус: independent review PASS; приёмка зафиксирована в social-review.json. Frozen51 payloads не изменены. Runtime screenshots и findings не отменяются, но ссылки на требования и следующие target обещания уточняются.

1. PRD TOURNAMENT-004 = «Матчи»: только1v1/единые правила, а не приглашения. Invite evidence относится к005. TOURNAMENT-006 = «Комната ожидания», override относитсяк005/007/AT022/023. TOURNAMENT-008 — рейтинг/случайный посев, не только ручной swap. TOURNAMENT-009 — BYE, zoom evidence само по себе не полнаяacceptanceBYE. TOURNAMENT-014 — техническое поражение/продвижение после неявки, обычный finish его не покрывает. Центральная матрица сохраняет точные PRD названия и границы; исходный delta не читать как полное покрытие этих ID.
2. TOURNAMENT-019 явно запрещает legacyV1 read/play compatibility: нужен bounded unsupported-version error. Фраза «V1 read compatibility» в preserved target ошибочна и отозвана. Собственного V1 browser run нет.
3. Admin вне турнирного контекста получает только текущую минимальную projection D35; не показывать ему полный summary/историю/все действия по фразе «один room». Общий layout применяется только к уже разрешённым данным.
4. Граница consent confirm: requireConsent=true либо actor не organizer; поздняя генерация отдельно. Active admin, который сам organizer, следует organizer branch по PRD005/test plan. AT-TRN-022 уточнён тем же non-organizer qualifier без изменения domain.
5. 75% только с сохранением фактических размеров текста/целей. Текущее умножение13px на0.75 дало бы9.75px, поэтому простого нового значения zoom недостаточно. Конкретное поведение ниже.

## Принципиальные target уточнения

Сохраняется одна колонка и порядок roster-first из исходного target. В finished/stopped «Итоги» сохраняют server summary и все значения; в cancelled вместо нулевой таблицы показываются status и существующие данные отмены/истории без фиктивного результата. В collecting/needs_regeneration/bracket_generated/in_progress блок итогов скрыт; текущие/следующие/сыгранные матчи остаются доступны через уже существующие список/сетку. Новые данные admin не запрашиваются и не выводятся.

Confirmation для cancel/dissolve/generated-withdraw: существующий Dialog, начальный focus на безопасную вторичную кнопку; Enter из неё не подтверждает mutation. Во время запроса field/actions/Close честно disabled, Escape не выполняет ложную отмену, progress объявлен. Known error остаётся внутри; unknown требует сверки GET перед новым явным действием. Q-UX-001 касается отдельного bracket-algorithm dialog, его открытый выбор не блокирует эти точные последствия.

Direct registered add без native confirm только organizer + consent=false + collecting. Для needs_regeneration предупреждение остаётся, но не обещает автоматическую перестройку: «Добавить игрока. Перед стартом потребуется заново построить сетку». Только bracket_generated вызывает atomic regeneration и текущий confirmBracketRegeneration flag. Для consent/non-organizer admin сохраняется named override и confirmManualOverride. Список имён берётся по stable selected ID; кнопка не подменяет личность текстовым query.

Zoom75/100/125/150, default100. На75 column width165px и прежний48px gap; горизонтальная навигация сдвигается на одну колонку+gap213px, не на произвольный viewport. Имена не меньше13px, счёт не меньше14px, строки и действия не меньше44px фактически; размеры выше100 масштабируются как раньше. На75 имя переносится без обрезания полного значения, высота карточки растёт, существующий ResizeObserver пересчитывает connectors. Нет transform/zoom всего DOM, нового renderer/minimap/gesture и скрытия полей. В100/125/150 сохраняется нынешняя геометрия. Это более компактный горизонтальный обзор, не обещание уместить всю DE8 на телефоне.

Проверить75 наSE/DE3/5/8,360/390/844landscape/1440: fullnames, score/status/BYE, connectors, кнопки44, bandfocus/Arrow/Home/End, разрешённыйmatchlink. Если165px не может содержать сохранённые controls, задача не принимается; не скрывать функции.
