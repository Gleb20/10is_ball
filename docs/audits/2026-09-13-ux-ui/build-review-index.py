#!/usr/bin/env python3
"""Build a read-only review index from the canonical backlog; never edit task data."""
import hashlib
import html
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BACKLOG = ROOT / "docs/BACKLOG.md"
source = BACKLOG.read_text()
tasks = []
for match in re.finditer(r"^### ((?:BUG|GAP)-\d+) — (.+)\n([\s\S]*?)(?=^### |\Z)", source, re.M):
    ident, title, body = match.groups()
    area, number = ident.split("-")
    if not ((area == "BUG" and int(number) >= 18) or (area == "GAP" and int(number) >= 13)):
        continue
    def field(name):
        found = re.search(r"^- \*\*" + name + r":\*\* (.+)$", body, re.M)
        return found.group(1).strip() if found else "unknown"
    tasks.append(dict(id=ident, title=title, body=body, priority=field("Priority"), status=field("Status")))
tasks.sort(key=lambda x: (x["priority"], x["status"] != "ready", x["id"]))

def md(text):
    def link(m):
        label, target = m.groups()
        target = html.unescape(target)
        if target.startswith(("https://", "http://")):
            return '<a href="' + html.escape(target, quote=True) + '">' + label + '</a>'
        if ":" in target.split("/")[0] or target.startswith("/"):
            return label
        path, sep, anchor = target.partition("#")
        relative = os.path.relpath(ROOT / "docs" / path, OUT) if path else "../../BACKLOG.md"
        return '<a href="' + html.escape(relative + ("#" + anchor if sep else ""), quote=True) + '">' + label + '</a>'
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return text

labels = {"ready": "Готова к реализации", "confirmed": "На проверке", "blocked_decision": "Нужно решение"}
cards = []
for task in tasks:
    rules = ''.join('<p class="rule">' + md(line.removeprefix('- ')) + '</p>' for line in task['body'].splitlines() if line.strip())
    cards.append(f'''<details class="task" id="{task['id']}" data-priority="{task['priority']}" data-status="{task['status']}">
<summary><span class="tag {task['priority']}">{task['priority']}</span><span><b>{task['id']}</b> {html.escape(task['title'])}<small>{labels.get(task['status'], task['status'])}</small></span></summary><div class="content">{rules}</div></details>''')
ready = sum(t['status'] == 'ready' for t in tasks)
digest = hashlib.sha256(BACKLOG.read_bytes()).hexdigest()
page = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tab-10 — программа улучшения интерфейса</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#20252b;font:16px/1.55 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:32px 22px}h1{font-size:30px;line-height:1.2;margin:12px 0}h2{font-size:22px;margin:32px 0 12px}.intro{max-width:850px}.quiet{color:#52606d}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.fact{background:white;border:1px solid #cbd1d7;border-radius:10px;padding:16px}.fact b{display:block;font-size:26px}.links{display:flex;flex-wrap:wrap;gap:10px}.links a{border:1px solid #a4adb8;border-radius:7px;background:white;padding:10px 13px;min-height:44px}a{color:#174e7a;text-underline-offset:3px}.controls{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.controls label{display:flex;flex-direction:column;font-size:14px;gap:4px}.controls input,.controls select{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #8f99a5;border-radius:6px;background:white}.controls input{min-width:270px}.task{background:white;border:1px solid #c3cbd3;border-radius:9px;margin:10px 0}.task summary{display:flex;gap:12px;align-items:flex-start;cursor:pointer;padding:16px;min-height:56px}.task summary::after{content:'+';margin-left:auto}.task[open] summary::after{content:'−'}.task[open] summary{border-bottom:1px solid #cbd1d7}.tag{font-size:13px;padding:3px 8px;border:1px solid #a6b0b9;border-radius:5px;flex-shrink:0}.P1{background:#fff1e8;color:#863700;border-color:#bc8153}.P2{background:#eef4fa;color:#204e79}.P3{background:#f0f1f2}.task small{display:block;color:#52606d;margin-top:5px}.content{padding:8px 18px 18px;overflow-wrap:anywhere}.rule{margin:12px 0}.task[hidden]{display:none}code{font-size:.92em}a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #216aaa;outline-offset:3px}.notice{border-left:4px solid #718395;padding:10px 16px;background:#edf1f5}.hash{font-size:12px;overflow-wrap:anywhere}@media(max-width:600px){main{padding:20px 14px}h1{font-size:26px}.facts{grid-template-columns:1fr}.controls,.controls label,.controls input,.controls select{width:100%;min-width:0}.task summary{padding:13px;gap:8px}}
</style><main>
<p class="quiet">Tab-10 · локальная база GAP012-r6 · 14 сентября 2026</p>
<h1>Программа улучшения интерфейса</h1>
<p class="intro">Главный сценарий: человек у телефона выбирает двух игроков, запускает матч для них и ведёт счёт. Основные действия получают приоритет, остальные возможности сохраняются и остаются доступными.</p>
<p class="notice">Это обзор постановок. UI-улучшения ещё не реализованы. Подготовительные правила GAP-012 проверены локально; публикация оформляется отдельно. Канонические статусы и инструкции хранятся только в BACKLOG.md.</p>
<div class="facts"><div class="fact"><b>__READY__</b>готовых постановок</div><div class="fact"><b>108</b>требований в матрице, с явными ограничениями проверки</div><div class="fact"><b>1257/1257</b>приёмка подготовительной базы, не нового UI</div></div>
<div class="links"><a href="README.md">Материалы и текущий статус</a><a href="../../BACKLOG.md">Канонический бэклог</a><a href="delivery-map.md">Эпики и очередь спринтов</a><a href="finding-map.csv">Находки → задачи</a><a href="user-session.md">Пользовательское прохождение</a></div>
<h2>Сценарии и схемы</h2><div class="links"><a href="core-wireframes.html">Создание и следующий шаг</a><a href="results-layout.html">Главная и история</a><a href="journey.md">CJM компании и организатора</a><a href="component-state-index.md">Состояния компонентов</a><a href="coverage.csv">Покрытие сценариев</a><a href="requirement-coverage.csv">Покрытие требований</a></div>
<p class="quiet">Подтверждённые дефекты отделены от экспертных гипотез. Реальное пользовательское прохождение ещё не проведено; физические устройства, WebKit, spoken AT и настоящий browser zoom имеют явные ограничения. Статус «Готова» означает однозначную постановку, а не выполненное изменение.</p>
<h2>Постановки по приоритету</h2><p>Раскройте задачу: внутри результат, входные данные, ограничения, подзадачи и проверяемая приёмка. Спринты учитывают зависимости из канонических задач; календарные сроки и скорость команды не выдуманы.</p>
<div class="controls"><label>Поиск<input id="search" type="search" placeholder="Сценарий, компонент или ID"></label><label>Приоритет<select id="priority"><option value="">Все</option><option>P1</option><option>P2</option><option>P3</option></select></label><label>Готовность<select id="status"><option value="">Все</option><option value="ready">Готова к реализации</option><option value="confirmed">На проверке</option><option value="blocked_decision">Нужно решение</option></select></label></div><p id="count" role="status" aria-live="polite"></p>
__CARDS__
<p class="quiet hash">Сгенерировано из docs/BACKLOG.md, SHA-256 __HASH__. Этот файл — производный обзор, его не редактируют вместо бэклога. Обновление: python3 docs/audits/2026-09-13-ux-ui/build-review-index.py.</p>
</main><script>const tasks=[...document.querySelectorAll('.task')];const search=document.querySelector('#search'),priority=document.querySelector('#priority'),status=document.querySelector('#status');function filter(){const q=search.value.trim().toLocaleLowerCase('ru');let n=0;for(const task of tasks){task.hidden=!!((priority.value&&task.dataset.priority!==priority.value)||(status.value&&task.dataset.status!==status.value)||(q&&(/^(bug|gap)-\d+$/.test(q)?task.id.toLowerCase()!==q:!task.textContent.toLocaleLowerCase('ru').includes(q))));if(!task.hidden)n++;}document.querySelector('#count').textContent='Показано задач: '+n+' из '+tasks.length;}for(const x of [search,priority,status])x.addEventListener('input',filter);filter();</script></html>'''
page = page.replace('__READY__', str(ready)).replace('__CARDS__', '\n'.join(cards)).replace('__HASH__', digest)
(OUT / 'review-index.html').write_text(page)
print(f'{len(tasks)} tasks; {ready} ready; source SHA {digest}')
