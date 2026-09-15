# Coverage delta — GAP 012 r3 components recheck

## Provenance

- Base SHA: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.
- Export manifest SHA-256: `c60920f545e007ec656ee88194430acd6999558e7a531edb4f1904a22ad91b5e`.
- Tracked patch SHA-256: `00d874967f236b3daacf157af10ab0fe14feea1c6cb7807d4917168e1b21ea82`.
- Все 49 export entries сверены с manifest перед запуском; mismatches `0`.
- Candidate build: PASS под Node `24.20.0`; disposable PostgreSQL migrations: PASS.

## Delta относительно frozen packages

| Surface / state | 1440 | touch390 | 360 | Результат |
|---|---:|---:|---:|---|
| Match create policy defaults | ✓ | — | — | PASS |
| Match policy keyboard toggle | ✓ | — | — | PASS |
| Player A empty query | ✓ | — | — | options `0`; отдельной no-results copy нет |
| Player A keyboard active option | ✓ | — | ✓ | `F-CMP-001/002` reproduced |
| Player A Enter selection | ✓ | — | — | `F-CMP-003` reproduced |
| Player A touch option/tap | — | ✓ | — | visible above nav; tap PASS |
| Match create pending/persisted policy | ✓ | — | — | persisted PASS; dependent controls remain enabled |
| Match edit Player A initial directory resolution | ✓ | ✓ | — | label resolves, but remount/focus loss reproduced |
| Tournament consent checkbox | ✓ | — | — | keyboard PASS |
| Scoped admin UserPicker pending/error | ✓ | — | — | `F-CMP-R-001` |
| Manual override warning/dismiss | ✓ | — | — | PASS; 0 POST after dismiss |
| Manual override pending/error recovery | ✓ | — | — | recovery PASS; picker remains enabled pending |
| Bracket radio selected+keyboard focus | ✓ | — | — | `F-CMP-004/005` reproduced |
| Bracket mutation pending/error | ✓ | — | — | `F-CMP-SUP-001/002` reproduced |
| Actual immersive judge inline error | ✓ | — | — | `F-CMP-SUP-003` runtime-confirmed, `2.58:1` |
| Horizontal overflow | ✓ | ✓ | ✓ | none in captured viewports |
| Browser UI zoom 200% | — | — | — | NOT_TESTED; runner limitation |

## Evidence inventory

- `evidence/runtime-states.json`: 21 runs with inputs/actions/expected/actual, computed states and geometry.
- `evidence/screenshots/*.png`: 19 viewport-only PNG captures.
- Controlled failures: 4 (`directory`, `manual override`, `bracket generation`, `judge point write`).
- Unexpected console/page errors: 0.

The original [components](../components/report.md) and [components-supplement](../components-supplement/report.md) packages remain immutable and are not superseded. This delta only reports the r3 candidate behavior.
