# Stage 12 final local candidate

Base: published 4.3.0 SHA
`43f4b2425cc0c79b5ad6cf192abb5802c3559e50`.
Candidate version: 5.0.0. The admin password reset UI flag is `false`.

## Accepted source input

- R2 source patch: `/private/tmp/tab10-stage12-wo2-r2-full-source.patch`
  (`5bdf93b9e4a9deb6f1be32eb2e6db72892a501234dabeadb7b70b93871a6a868`).
- R2 source manifest: `/private/tmp/tab10-stage12-wo2-r2-manifest.json`
  (`b46274944425528e9d81614d26fd7b906fd8096e45964908f6e3b77b79a76d03`).
- All 33 source entries matched the input manifest before the bounded E2E helper
  correction and route inventory update. Reverse apply check passed.

## Runtime evidence

- `enabled-e2e/`: feature-enabled compiled flow, 3/3 at 1440/390/360 plus
  9/9 migration foundation. It performed exactly one successful reset POST and
  verified a non-secret receipt. Screenshots stop at the confirmation dialog and
  contain no generated password.
- `ci/`: final held source-candidate run with the production flag restored to
  false. Canonical documentation was synchronized afterward and checked
  separately. `local-summary.json` reports 1605/1605: cleanup 4, quality 1376,
  PostgreSQL 96 and compiled browser 129, with zero failed, skipped, todo or
  interrupted. The Stage 12 held scenario verifies both reset entry points are
  disabled and observes zero reset POST.
- `stage12-wo2-flow-report-r2.html`: immutable accepted R2 review artifact.

The complete original CI report remains at
`/private/tmp/tab10-stage12-held-ci-r2/local-summary.json`; the canonical copy is
`ci/local-summary.json`.

## Release boundary

This evidence is `verified_local`. It does not prove hosted or public 5.0.0.
Release 5.0.0 must keep the UI held while the migration and receipt API converge.
Only after hosted checks, exact-SHA public smoke and confirmed legacy-fleet drain
may a separate 5.0.1 release enable the UI. No commit, push, deploy, public
mutation or non-ephemeral database migration was performed here.
