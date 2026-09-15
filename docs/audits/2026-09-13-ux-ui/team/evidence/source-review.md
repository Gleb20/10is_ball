# Source review: TEAM

- Frozen package: `/private/tmp/tab10-ux-audit-dispatch-v1`; `manifest.sha256` = `c39ed47b617b793124ced607889d2102fb1ac2398a380c49321f61b473e9895b`.
- Base HEAD: `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.
- Candidate: accepted local `GAP012-r6`, source fingerprint `8e8762575a07e71a17192da327cbe1b5906ca33c1c2ef762c0f9a37463b94cb3`.
- Package recovery: the dispatch directory contained `tracked.patch`, but its `files/` payload was absent. The missing 264 manifest-named new files were recovered from `/Users/liubavskii/.codex/worktrees/99f2/tab10` only after all 310 manifest entries there matched their declared SHA-256. All 323 paths in `candidate-source.json` then matched the candidate hashes in the disposable copy `/private/tmp/tab10-team-audit.1u276g`.
- Runtime source: production build from that disposable copy; no application source was changed.

## Canon and implementation seams

- `docs/requirements/04_PRD.md`: TEAM-001…009 define create/edit, optional avatar, captain/member permissions, 14-day invitation lifecycle, leaving, automatic captain transfer, auto-archive, and teammate use in matches/tournaments.
- `docs/requirements/11_ACCEPTANCE_TEST_CATALOG.md`: AT-TEAM-001…007 and shared EMPTY/AUDIT/UI criteria.
- `docs/DECISIONS.md`: D5 keeps Teams under Profile and requires the same IA on mobile/desktop; D22/D26 establish error and responsive baselines.
- `apps/web/src/pages/TeamsPage.tsx:76-118`: create form precedes list/empty state; fields are name/slogan/welcome only.
- `apps/web/src/pages/TeamDetailPage.tsx:203-338`: archived read-only branch, immediate member actions, edit/invite/history cards, one common bottom action error.
- `apps/web/src/pages/MatchCreatePage.tsx:253-270,413-418`: one team shortcut writes user IDs to participant slots without asking which side.
- `apps/web/src/pages/TournamentDetailPage.tsx:735-751`: roster uses the generic user picker with no team grouping or explanatory team context.
- `apps/api/src/openapi.ts:465-472,1120-1143`: team contract has no avatar property and no manual invitation-revoke operation.
- `apps/api/src/modules/teams/team-service.ts`: authoritative captain/invitation/leave/remove/transfer/archive rules and persisted transitions.

## Method boundary

Source review establishes available seams and contract absence. Runtime claims in this package are based on the isolated browser/API/PostgreSQL run in `runtime-states.json`; neither method is a user study or a WCAG certification.
