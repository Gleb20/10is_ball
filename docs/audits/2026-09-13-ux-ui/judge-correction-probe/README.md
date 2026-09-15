# JUDGE manual-correction lost-response probe

Статус: `READY_FOR_REVIEW`. Это один дополнительный runtime probe для TECH-006. Принятый пакет `judge/**`, приложение и канонические документы не менялись.

## Наблюдение

Ручная коррекция задаёт абсолютные `scoreA`, `scoreB` и подающего. В Chromium на accepted candidate `GAP012-r6` воспроизведена цепочка `server commit → потеря browser response`:

1. UI отправил коррекцию `1:0/A → 4:2/B` с `expectedVersion=1` и ключом `64979b06-8be0-4b85-8954-35034f599080`.
2. `route.fetch()` получил `200`; authoritative match стал `version=2`, `score=4:2`, `serve=B`.
3. GET содержал exact prefixed key `manual-correction:64979b06-8be0-4b85-8954-35034f599080` и ровно одно событие `manual_correction` с теми же `from/to`.
4. После искусственного abort UI оставил форму и draft `4:2/B`, но показал сырой `Failed to fetch`, сохранил на табло старые `1:0/A` и снова включил `Сохранить коррекцию`.
5. Явная повторная отправка создала новый key, но сохранила stale `expectedVersion=1`. Сервер ответил `409 VERSION_CONFLICT`; новый key не записан, version/score/serve и число audit-events не изменились. UI загрузил authoritative `4:2/B`, сохранил draft и сообщил: `Матч изменился на другом устройстве…`.

Это подтверждённый **P2 recovery/copy defect**: UI не сообщает, была ли коррекция сохранена, и после `409` неверно объясняет собственную потерянную операцию действием другого устройства. Немедленная повторная отправка не удвоила очки и не добавила второе audit-event благодаря version CAS. Оснований объявлять P1-повреждение счёта этот probe не дал. Ручная коррекция — абсолютная запись и отличается от инкрементного `+1`; канонический owner и backlog target определяет координатор. `BUG-031` исправляет focus-only и этот recovery не закрывает.

## Ранний GET

Во второй независимой ветке request был перехвачен, но ещё не передан серверу. Ранний GET вернул прежние `version=1`, `score=1:0/A`, без prefixed key и без manual-correction event. После release запроса `route.fetch()` получил `200`, а поздний GET уже содержал exact key, `version=2`, `score=2:1/B` и одно событие.

Следствие ограничено: отсутствие ключа в раннем GET не доказывает `no-write`, пока исходный request ещё может завершиться. В pending UI честно показывал `Сохраняем…`, отключал Save/Cancel и сохранял draft.

## Evidence

- [probe-results.json](probe-results.json) — sanitized request/state/event replay без credential и fixture IDs.
- [source-provenance.json](source-provenance.json) — `323/323` accepted source hashes; fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.
- [c01 commit then lost response](screenshots/c01-commit-then-lost-response.png) — draft сохранён; UI показывает stale `1:0` и `Failed to fetch`.
- [c02 explicit stale resend](screenshots/c02-explicit-stale-resend.png) — authoritative `4:2/B` после `409`; draft сохранён.
- [c03 request held and early GET](screenshots/c03-request-held-early-get.png) — pending `Сохраняем…`; authoritative key ещё отсутствует.
- [c04 delayed commit then lost response](screenshots/c04-delayed-commit-then-lost-response.png) — поздний commit доказан readback; UI всё ещё показывает stale board и generic error.
- [cleanup-receipt.json](cleanup-receipt.json) — точная проверка удаления owned runtime resources.
- `manifest.sha256` — целостность финального probe-пакета.

## Метод и ограничения

- Runtime: compiled production bundles из собственной disposable копии frozen candidate; Node `24.20.0`, pnpm `9.15.0`, PostgreSQL `16.15`, Playwright `1.63`, Chromium, viewport `1440×900`.
- Проверены две необходимые ordering-ветки: commit-before-abort и early-GET-before-forward. Console: два ожидаемых `net::ERR_FAILED` и один ожидаемый `409`; page errors `0`.
- Полный gate `1257`, общий UX-аудит и production/public stand не запускались.
- Не проверялись третий submit после authoritative refresh, Undo после recovery, pending-confirmation boundary, loss до получения request браузерным proxy, WebKit/Firefox, mobile/touch и spoken AT.
- Artificial route ordering доказывает состояние и causal boundary, но не естественную частоту потери ответа.
- Ни credential values, ни raw cookies, ни synthetic user/match IDs в evidence не сохранены.
