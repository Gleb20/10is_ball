# Handoff — COMPONENTS supplement

## Статус

**READY_FOR_REVIEW**

Дополнение завершено в единственном write scope `components-supplement/**`. Код приложения, исходный замороженный package `../components/`, canonical backlog/status/requirements и git history не менялись.

## Coverage merge rule

При synthesis использовать **union**, не replacement:

1. `../components/` остаётся authoritative для исходных `SC-C01`–`SC-C04` runs, 33 screenshots и `F-CMP-001`–`F-CMP-005`.
2. Этот package добавляет только строки из `inventory-delta.md`, runs `CMP-SUP-01`–`05` и `F-CMP-SUP-001`–`003`.
3. PASS в supplement закрывает только названный state/input/viewport; он не отменяет original finding того же component family.
4. N/A означает отсутствие current app consumer/prop по source, а не качество компонента библиотеки.
5. При дедупликации сохранять original IDs; supplement findings объединять только по доказанной общей причине. `F-CMP-SUP-001` (error placement), `002` (pending affordance) и `003` (dark error token) имеют разные acceptance checks.

## Baseline и метод

- HEAD `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`, version `3.0.0`.
- Production web/API `4517/4518`; own disposable PostgreSQL compose project `tab10-cmp-supplement-4517`, loopback `32997`.
- Node `24.20.0`; headless Chromium `153.0.8010.12`.
- One fresh synthetic tournament per final collector run, four synthetic guests; no match-flow replay and no external/public mutation.
- Inputs separated in raw evidence: keyboard, mouse, Playwright touch emulation. Emulation is not represented as physical touch.
- `impeccable/review` constrained findings to evidence-backed user consequences; `interface-design` supplied state-consistency and contrast review criteria.

## Result

- `10` new screenshots; `15` raw component-state snapshots; `9` focus-sequence checkpoints; `10` contrast pairs.
- `3` findings: `F-CMP-SUP-001`–`003`, all P2; `F-CMP-SUP-003` is explicitly source-derived/medium-confidence.
- `4` horizontal-overflow checks PASS: checkbox 390, Dialog error 390, Skeleton 390, Alert 390.
- `0` browser page errors; `0` unexpected console errors; `2` expected 503 console diagnostics from deliberate failure probes.
- Original package manifest rechecked before work; its self-hash remained `3354f54230bb5ebb32c88874950a1051f2adc7162fccae7d6ae1cbe46b555cbf`.

## Artifacts

| Path | Содержание |
|---|---|
| `inventory-delta.md` | merge-only state matrix, source-backed N/A and explicit post-candidate rechecks |
| `report.md` | three findings, run table, contrast method/results/limits |
| `evidence/runtime-states.json` | raw attributes, computed properties, five ancestor styles, geometry, focus sequences, checks, alpha-composed contrast and source-derived dark references |
| `evidence/screenshots/*.png` | ten new 390/1440 screenshots without duplicating original captures |
| `manifest.sha256` | frozen package file hashes |

## Verification performed

1. Exact release health assertion: API reported SHA/version above.
2. Final collector:

   `/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin/node /private/tmp/tab10-components-supplement.mjs`

   Completed with `screenshots=10`, `stateSnapshots=15`, `focusSteps=9`, `contrastPairs=10`, `browserErrorCount=0`, `consoleErrorCount=0`, `expectedConsoleDiagnosticCount=2`.

3. Runtime assertions: ArrowRight changes radio focus+checked; Tab and Shift+Tab wrap; ordinary Escape closes and returns; touch emulation toggles checkbox; all four 390 overflow checks PASS.
4. Deliberate negative assertions: enabled-looking Close remained inert during pending; async Alert was outside active modal and occluded. These are findings, not harness failures.
5. Contrast: WCAG relative luminance with alpha composition; five light pairs are current-browser measurements, five dark pairs are exact source calculations with two frozen-runtime references. Dark generic error is `2.58:1`, below normal-text `4.5:1`, and remains a source hypothesis pending fresh runtime evidence. No blanket pass claimed.
6. No full CI: documentation/evidence-only task, no application/source changes.
7. Cleanup: API/web sessions stopped; `docker compose -f compose.verify.yml -p tab10-cmp-supplement-4517 down --volumes --remove-orphans` removed the disposable container/network; ports `4517`, `4518`, `32997` have no listeners. Restored ignored build/dependency artifacts were moved back to `/private/tmp/tab10-components-runtime-artifacts`; final `git clean -ndX` is empty.

## Reviewer focus

- Inspect `dialog-1440-pending-disabled.png` and `dialog-390-error-hidden-behind-modal.png`, then match them to raw states/checks.
- Verify `F-CMP-SUP-003` stays source-derived until a fresh dark runtime error is collected after the candidate.
- Preserve the explicit N/A/defer boundaries; do not translate them into PASS.
- After a fix candidate, rerun only the explicit list in `inventory-delta.md` plus the affected original target specs.

Rollback of this supplement is removal of only `docs/audits/2026-09-13-ux-ui/components-supplement/`; that destructive action was not performed.
