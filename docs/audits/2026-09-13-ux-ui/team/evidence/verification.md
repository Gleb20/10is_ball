# Verification record

UTC completion: 2026-09-14T08:01:49Z.

| Check | Result |
|---|---|
| Frozen dispatch manifest SHA-256 | PASS — `c39ed47b617b793124ced607889d2102fb1ac2398a380c49321f61b473e9895b` |
| Named export delta | PASS — 310/310 manifest entries and 323/323 candidate source paths matched programmatically |
| Production build, Node 24.20.0 / pnpm 9.15.0 | PASS — API, web, shared and test-utils built; Vite 115 modules; existing chunk-size warning only |
| Compiled PostgreSQL migrations, `--mode=apply` | PASS — disposable PostgreSQL 16.15 on port 33028 |
| Runtime release identity | PASS — SHA `9f71b9f…`, version 3.0.0, environment test, dirty true |
| TEAM browser harness | PASS — Chromium 153.0.8010.12, 22 screenshots, 0 page errors |
| Focused web tests | PASS — 2 files, 15/15 tests (`TeamsPage`, `TeamDetailPage`) |
| axe WCAG 2 A/AA + 2.2 AA tags on captain detail | PASS for this one scanned DOM state — 0 violations; not a full accessibility certification |
| 360px long-text horizontal overflow | PASS — document width 360, no horizontal overflow |
| Key current and target PNG visual inspection | PASS — empty, error, transfer result, archive, match/tournament cross-package, and all four target renders inspected |

Not run: full repository suite, WebKit, physical mobile, zoom 200%, reduced-motion variants, spoken screen reader, real-user session, latency/loss beyond explicitly delayed requests, and concurrency stress. These exclusions are carried into `runs.csv` and `coverage-delta.md`.
