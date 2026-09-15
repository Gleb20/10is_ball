# Обязательная коррекция покрытия JUDGE

Координатор, по independent Terra review frozen core-review-01. Исходные67 payloads и manifest сохранены. Runtime findings подтверждены; следующие метки не являются полным выполнением mutation acceptance. Нового прогона для исправления классификации не требуется.

| Строка исходного delta | Исходная метка | Применяемая метка | Основание |
|---|---|---|---|
| JUDGE-006 | PASS | PARTIAL | Собственный J-RUN-RELEASE проверил только отказ release и предупреждение после выхода; успешный release/reacquire не повторялся |
| D23 | PASS | PARTIAL | J-RUN-ACTOR-MATRIX проверил видимость действий; cancel mutation принадлежит MATCH, не этому run |
| D24 | PASS | PARTIAL | Проверены видимые terminal действия, void mutation не выполнена |
| AT-JUDGE-008 | PASS | PARTIAL | Проверен setup Cancel с отказом release; Back/explicit exit не повторялись |
| AT-JUDGE-006 | PASS | PARTIAL | Прежний/другой auth session заблокированы на UI surface; прямой unauthorized score API не отправлялся |

Все другие ограничения исходного [delta](judge/requirement-coverage-delta.csv) остаются обязательными: physical/WebKit/TTL/heartbeat/spokenAT/realzoom не проверены. Accepted GAP-012 gate можно цитировать по его exact cases как отдельное прежнее evidence, но не переименовывать в новый JUDGE run.

Коррекция меняет только область утверждений, не screenshots, находки или target. Центральная coverage использует эти уточнения.
