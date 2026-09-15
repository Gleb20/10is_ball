# Coverage delta: TEAM

## Covered in this package

| Requirement / acceptance | Evidence level | Coverage |
|---|---|---|
| TEAM-001 / AT-TEAM-001 create and captain membership | browser + API persisted | Covered; optional avatar is absent and raised as F-TEAM-001 |
| TEAM-002 edit name/slogan/welcome | browser + forced error + persisted retry | Covered |
| TEAM-003 captain/member role actions | browser + persisted API | Covered for remove/transfer/leave; confirmations raised as F-TEAM-004 |
| TEAM-004 / AT-TEAM-003 invite visibility and access | browser + API persisted | Covered for captain/invitee/outsider |
| TEAM-005 / AT-TEAM-002 invitation 14-day lifecycle | browser + persisted API/DB | Covered for accept/decline/expired; manual revoke is absent and non-canonical |
| TEAM-006 leaving | browser + persisted API | Covered for ordinary member after transfer; captain-blocked leave was observed as disabled before transfer |
| TEAM-007 captain transfer on block | accepted implementation plus this run’s sole-captain block | Covered for zero-member archive; multi-member automatic earliest-member transfer not independently rerun |
| TEAM-008 / AT-TEAM-006 archive at zero members | browser + API + disposable DB | Covered; historical UI discovery raised as F-TEAM-008 |
| TEAM-009 / AT-TEAM-007 use in match/tournament | bounded cross-package browser slice | Partially covered; discoverability/slot-assignment findings F-TEAM-006/F-TEAM-007 |
| AT-TEAM-004 revoke invitation | N/A in current acceptance catalog | Not specified; user-requested audit probe documented as F-TEAM-005 |
| AT-TEAM-005 captain block with member transfer | source + prior accepted gate only | Not rerun in this bounded audit |
| Shared loading/empty/error/pending/long text | browser | Covered for list/detail, delayed create/invite/accept, forced edit error, 360px long text |
| Keyboard/focus | browser | Covered for invite picker only; deduplicated to BUG-018 |
| 1440 / 390 / 360 | browser | Covered in Chromium |

## Deliberately not covered

- No full MATCH or TOURNAMENT audit: only the team-discovery seams were examined.
- No second browser engine, physical device, 200% zoom, reduced motion, spoken screen reader, or real-user session.
- No destructive or mutating public/prod checks; all actors and data were synthetic in the disposable PostgreSQL project.
- No full test suite; only 15 focused TEAM page tests after the production build.
- No concurrency stress. Accepted 1257/1257 evidence belongs to the frozen baseline, not to this run.

## Common defects referenced, not duplicated

- BUG-018: `Autocomplete` active-descendant/focus semantics; reproduced in the team invite picker (`referencedOptionExistsBeforeEnter=false`).
- BUG-019: narrow mobile menu geometry; applicable to the shared picker but not separately re-filed.
- BUG-023: directory display-name ordering; visible in shared picker/card strings and not re-filed.
- BUG-024: fixed BottomNav can constrain lower-page recovery/actions; the TEAM-local error-location finding cites it as a compounding shared condition.
- BUG-026: create request leaves form fields editable while pending; reproduced in Teams create and cross-linked instead of re-filed.
