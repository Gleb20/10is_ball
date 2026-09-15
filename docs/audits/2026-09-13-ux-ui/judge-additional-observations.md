# Дополнительное наблюдение по ручной коррекции

Статус: source hypothesis, runtime NOT_TESTED. Координатор фиксирует замечание Terra core-review-02 в TECH-006; это не часть принятого воспроизведения BUG-029 для +1.

JudgePage onManualCorrectionConfirm создаёт новый UUID для каждой отправки, после version conflict выполняет GET, а после generic lost response этого чтения нет. Сервер сохраняет ключ в форме manual-correction:<key>. Поэтому нельзя называть существующее восстановление generic manual correction GET-first или переносить raw point key proof BUG-029 без проверки.

Следующий ограниченный шаг при валидации recovery: commit→lost response ручной коррекции; прочитать exact prefixed key и authoritative score/server/correction event; проверить ранний GET до завершения, повтор и оба ordering случая. Не утверждается, что повтор удваивает очки: correction задаёт абсолютный счёт, её события/подача/базовая точка Undo требуют отдельной проверки.

До этой проверки нет подтверждённой runtime severity и отдельной ready задачи. BUG-031 исправляет только фокус, не представляет этот recovery как исправленный. Канонический owner наблюдения — TECH-006, не второй backlog.
