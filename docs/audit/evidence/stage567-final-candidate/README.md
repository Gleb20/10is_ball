# Stage 5–7 local candidate 4.3.0

Frozen local evidence for the uncommitted candidate based on
`df807d508613b3226345813ff35080a9e1d1c288` (published version 4.2.0).

## Result

- `pnpm run ci`: 1563/1563 passed, with zero failed, skipped, todo or interrupted.
- Cleanup foundation: 4/4.
- Quality: 1343/1343.
- Disposable PostgreSQL: 90/90.
- Compiled production-like browser: 126/126, comprising 117 browser scenarios and 9 foundation checks.
- Candidate source manifest: 33 files outside this evidence directory.
- Both reverse application of `forward.patch` and direct application of
  `rollback.patch` passed `git apply --check` on the frozen candidate.

The machine-readable entry point is [receipt.json](receipt.json). The visual and
state summary is [flow-report.html](flow-report.html).

## Boundaries

Independent source review remains required. This package does not claim physical
iPhone touch, browser UI zoom, pinned WebKit, spoken assistive technology, public
deployment parity or completion of Stage 8 / full GAP-019.
