# Visual baseline

This directory stores evidence captured during the audit foundation phase.

- `production/` is read-only evidence from `https://tab-10.vercel.app`.
- `local/` is captured against a disposable local database only.
- Filenames include the route and requested viewport. Screenshots are JPEG files
  with dimensions equal to that viewport; metrics retain document overflow.
- Production currently contains the public login at 360×640, 440×956,
  768×1024 and 1440×900. Local contains the authenticated home at the same
  sizes plus 360×640 match, tournament, rankings and admin evidence.
- `local/route-smoke.json` records the organizer pass across 17 routes and a
  separate admin-route pass; all identities and entities are synthetic.
- Screenshots document the current state; they are not an approved redesign.
- Personal data and secrets must never be included. Production captures are limited to public screens unless a separate read-only test account is approved.

Capture date: 2026-09-06 (`Europe/Moscow`).
