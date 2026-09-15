# Source reconciliation пилота

Read-only explorer, accepted clone, без изменений/тестов. Parent принимает как source evidence; rendered evidence отдельно.

- HomeService.matchCard home-service.ts203–218 выбирает последнюю judgeSession без фильтра active/released/expired, затем activeJudge fallback. Role239–245 participant→historical/currentjudge→organizer→viewer. Это объясняет прежнее имя на активной карточке. Для finished historical attribution полезна; для active подпись не различает last/current. RESULTS должен предложить явные состояния, не удалять историческое авторство.
- MatchCreatePage389–422 рендерит suggestions section при ready/createOptions даже когда recent/frequent/teams пусты; styles774–789 добавляет padding/border. Пустая рамка подтверждена source+pilot. Решение в GAP013 — не рендерить пустую группу.
- ic-kit.js8640–8655 закрывает Autocomplete по document.mousedown/Escape; input8880–8895 открывает onFocus, нет onBlur. Поэтому Tab оставляет старые listbox. Существующие MatchCreate tests28–81/104–230 проверяют selection click/payload, не ownership/Tab. F-PILOT004 дополняет BUG018; не путать с геометрией BUG019.
- Blank new game = navigate('/matches/new'), исходный manual defaults; не query revengeOf. Existing revenge eligibility MatchDetail242–246 и CTA742–745 сохранить. Judge route700–709 уже существует; creator start684–693 имеет отдельную проверку434–452. Target нельзя расширять права чужого judge или auto-start.
