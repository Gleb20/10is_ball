# Stage 3 final regression correction — delayed player directory

Date: 2026-09-19. Scope: BUG-018/BUG-019 follow-up in the existing match-create and match-edit Autocomplete seams.

The aggregate browser work exposed a deterministic Stage 3 regression: both match forms can render player fields before the directory response, and the new controlled input effect could replace a query typed before the late `options` array arrived. Exact base `550d3680a08a8faf4e1e4afbfcc373c942f155d0` did not have that regression.

The correction tracks whether the operator edited the query. A late directory response may resolve an untouched selected label, but cannot overwrite active typing. Explicit selection, clear and external slot identity changes still synchronize the label without a keyed remount. Product source hashes are recorded in `base-comparison.json`.

## Verification

- Initial focused Red: both MatchCreate and MatchDetail seams failed on the pre-correction Stage 3 tree; exact base passed the isolated create case.
- R2 focused Green: 32/32 across `MatchCreatePage.test.tsx` and `MatchDetailPage.test.tsx`.
- Final quality: 1193/1193, zero failed/skipped/todo/interrupted, in `quality-r2-final/fast-summary.json`.
- PostgreSQL: the aggregate 72/72 predates this frontend-only correction; no API, schema or migration changed afterward.
- Historical pre-correction browser recovery: 60/60 browser plus 9/9 foundation passed.
- First corrected-tree full browser run: 59/60 browser plus 9/9 foundation. One desktop GAP-012 timeout waiting for the first option remained; mobile passed and no source cause was established.
- Final authorized original-order full browser run: 60/60 browser plus 9/9 foundation on a fresh disposable PostgreSQL 16.15 stand with compiled API and Vite preview. The passive helper observed only the real suite fixture: desktop and mobile committed directory groups before focus, retained query and input identity, and completed normal selection without blur, pre-click close, page error or unexpected transition. See `gap012-final-full-browser/`.
- Filled-suggestion discrimination: four named desktop phases passed plus 9/9 foundation on one disposable PostgreSQL stand. The 476 px frequent/recent/team region mounted before focus, between focus and input, on an input-triggered response, and after fill. The two late phases preserved the query, input identity and selection through the transient geometry boundary. See `gap012-filled-matrix/`.

The final green run does not establish the cause of the earlier timeout and is not evidence that it was harmless, pre-existing or fixed. The matrix does not prove that the rare timeout is absent. Its frozen helper also had one invalid boolean gate: `vendorDOMShapeMatches` required `data-readonly` on an editable field, while ic-kit emits that attribute only for read-only fields. Raw rectangles, safe-bottom measurement, scroll and event ordering are preserved with this limitation.

## Evidence integrity

An earlier generated quality JSON contained a synthetic loopback database URL inside a test title. The exact string was redacted in place and the original/sanitized hashes were recorded in `quality-sanitization.json`; the historical evidence directories were retained. `quality-r2-final/` is the fresh final quality result.

No product source change followed the browser matrix. No commit, push, tag, deployment or public mutation was performed.
