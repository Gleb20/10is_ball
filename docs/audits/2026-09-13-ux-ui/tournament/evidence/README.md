# Evidence index

Accepted evidence is from the final completed run beginning `2026-09-14T08:00:32.879Z` only.

- `runtime-observations.json`: seven runs, UI observations plus authoritative response/state checks.
- `fixture-index.json`: synthetic IDs and labels only; no email, password, token or cookie.
- `screenshots/`: 33 current-state Chromium PNGs across 360×800, 390×844, 844×390 and 1440×900.
- `environment.json`: frozen source, toolchain, build, PostgreSQL and health provenance.
- `cleanup.json`: stopped processes, destroyed tmpfs DB and listener checks.
- `audit-runner.mjs`: repeatable local-only harness; refuses non-local web/DB hosts and reads credentials only from environment.
- `render-artifacts.mjs`: static renderer for the two annotated target PNGs; no app runtime.

The screenshots are evidence of rendered state, not human comprehension or completion time. Full-page PNGs include the fixed BottomNav at its viewport position; this stitching artifact is not itself a layout finding. The machine JSON contains synthetic record/request UUIDs, not secrets or personal data.
