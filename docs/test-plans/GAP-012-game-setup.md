# GAP-012 — game setup without mandatory player consent

## Scope and accepted outcome

The primary setup actor may be the person holding the scoring phone rather than a
player. A standalone creator may still participate, but no longer has to occupy a
side. Registered player and judge invitations remain explicit, voluntary records;
they do not reserve a judge slot or block a valid standalone start. Match ownership,
one active judge/session, score idempotency/versioning, distinct and non-busy player
rules, tutorial isolation, finalization and player-only statistics remain unchanged.

Tournament organizers choose whether participant consent is required. Pending
invitations are never roster rows. An accepted invitation adds the invited account;
a declined, expired or cancelled invitation remains terminal history. The organizer
or an active global admin may use the separately confirmed manual-add action as a
scoped override. It grants no other organizer capability.

## Contracts and defaults

### Standalone matches

- `created_by_user_id` remains the immutable owner and the only ordinary actor that
  may start the match; it is independent from `match_participants`.
- `1v1` still requires one complete side A and one complete side B; `2v2` still
  requires two distinct identities per side. Registered users must be active.
- Selecting players does not send invitations. Manual setup has a separate,
  unchecked `Пригласить игроков` choice; challenge/revenge setup keeps that
  purposeful choice enabled. An optional judge selection remains a separate
  explicit invitation. Pending/declined invitations do not block start.
- Starting a match atomically marks every still-pending match invitation
  `cancelled` with `expiry_reason=match_started`, reads its notification and enters
  scoring. Later responses remain immutable history.
- Challenges and revenge continue to prefill the creator as a player and keep the
  purposeful invite choice enabled. Manual setup exposes an explicit
  `Создатель играет` choice, default `false` for the operator-first primary flow.
  When false, every playing slot is selected explicitly.

### Tournaments

- `tournaments.require_participant_consent boolean not null default false` is the
  persisted setting. The forward migration backfills every existing tournament to
  `false`, matching its existing direct-roster semantics. New API/UI creates also
  default to `false` when omitted.
- The setting is chosen at creation and immutable afterwards. This avoids a mode
  switch silently reclassifying existing roster rows or implying retroactive
  acceptance. Existing roster/invitation history remains unchanged by migration.
- Under either policy, an invitation is voluntary and does not add a participant
  until the invited user accepts. Under required consent, ordinary invitation is
  the default path; pending/declined users are excluded from generation and start.
- A registered manual add is allowed to the tournament organizer or an active
  global admin. Under required consent, or whenever the actor is an admin who is
  not the organizer, a separate dialog names the player and tournament, explains
  the consent override and sends `confirmManualOverride=true`. Missing confirmation
  has zero writes. Guests cannot consent and remain organizer-only direct additions.
- Active admins may see title/status in the tournament list and read only the
  tournament/active-roster fields needed to choose a missing player and perform the
  scoped add. Pending invitation history is omitted from this non-contextual admin
  DTO. Settings, invitation, removal, bracket, start/stop/cancel/dissolve and every
  other tournament mutation stay organizer-only and are not rendered to admins.
- Every manual registered add records `added_by_user_id`, `addition_source` and an
  `audit_logs` row (`tournament.participant_manually_added`) in the same transaction.
  Invite acceptance uses source `invitation_accept`; creator auto-entry uses
  `organizer_default`; migrated rows use `legacy`; guests use `guest_manual`.
- `Idempotency-Key` is optional for backward compatibility but, when supplied, is a
  UUID stored with a request fingerprint. The first successful add owns the key.
  Exact replay returns the existing participant without a second audit, notification
  or bracket version change. Reuse for another actor/target/source rejects with
  `IDEMPOTENCY_KEY_REUSED` and zero writes. The web client always supplies a key.
- Adding to `bracket_generated` requires `confirmBracketRegeneration=true`.
  Participant insert, stale pending-invite cancellation/read, audit and full bracket
  regeneration are one transaction. Failure rolls everything back. Existing seeded
  participants retain their relative order; new participants append in deterministic
  insertion order. Manually edited swaps therefore survive where their participants
  still exist. The response includes the authoritative participant and tournament.
- A new add after start rejects before participant, invitation, audit, notification,
  bracket or version writes. Exact replay of an add that succeeded before start may
  return that historical participant to recover a lost response, still with zero
  writes. Tournament-row serialization orders invite response, manual add, bracket
  generation and start.
- A manual add of a registered user closes that user's pending invitation as
  `cancelled` with source reason `manual_override`; declined/expired/cancelled and
  withdrawn rows remain history. A later valid manual add may create a new active
  row, still protected by the active-user unique index.

## Migration policy and rollback

- Migration `0006_gap_012_game_setup.sql` only adds nullable provenance/idempotency
  columns and the non-null consent-policy column with a false default, plus partial
  uniqueness/check constraints. It never deletes or rewrites sporting results,
  invitation history, roster identity, seed or bracket JSON.
- Existing participant rows are classified `legacy`; no historical actor is
  invented. Existing tournaments read exactly as direct-roster policy.
- Apply is forward-only. Verification covers a fresh database, an historical
  pre-0006 database containing waiting/active/finished matches and tournaments,
  repeated apply, and a disposable rollback roundtrip that restores the pre-0006
  catalog and row payload. No persistent or public database is used.

## Red → Green acceptance matrix

| Claim | Fresh evidence required |
|---|---|
| C creates A-vs-B and enters scoring without responses | API/service + component + desktop/390 browser journey |
| Voluntary player/judge invitations do not block | start regression; terminal invitation/notification assertions |
| Tournament policy false/true and pending exclusion | create/patch/detail contract and bracket roster cases |
| Organizer/admin override; outsider denied | API actor matrix, explicit-confirmation negative case and audit persistence |
| New post-start add has zero writes; prior exact replay recovers only its old result | persisted participant/invite/audit/bracket/version snapshot |
| Add + regenerate is atomic and retains seed order | PGlite fault rollback and real PostgreSQL bracket assertion |
| Duplicate request is idempotent | same-key replay and different-payload key-reuse cases |
| Invite response/add/start races serialize | deterministic PostgreSQL blocking/race tests |
| Existing rows migrate safely | migration fresh/historical/repeat/roundtrip cases |
| Judge device paths, attribution, busy rules and stats remain | focused existing handover/stats/busy regressions plus full gate |

## Verification commands

Use the repository's pinned Node `24.20.0` and pnpm `9.15.0`. Run focused Red
tests first, then relevant shared/API/web typechecks and suites, disposable
PostgreSQL migration/concurrency tests, the prodlike browser journey at desktop and
390 px, and finally `pnpm run verify:all`. Browser and database writers must be
stopped before handoff. Record exact results and every skip; previous 3.0.0 evidence
is context only and is not GAP-012 acceptance.

## Final local acceptance — 2026-09-14

Frozen r6 source52 paths matches before/after full run. Fresh verify:all1257/1257 PASS, zero failures/skips/todo/interrupted; quality1123, PG71 on16.15, cleanup4, browser9 foundation+50 journeys (25desktop,25mobile390). The previously failing12 browser cases also passed in a focused compiled run before full acceptance. Terra independently accepted code and receipts; coordinator accepted this local UX-audit baseline. [Canonical evidence](../audit/evidence/gap012-local.json).

r5 activation root cause was withdrawn: new accounts are already active before first login. The final fixture asserts actual account status/directory identity and uses the displayed LAST FIRST label. Earlier failed/invalid receipts are retained; none count toward acceptance. No commit, version bump, push, deployment or production mutation. WebKit, physical-device and spoken-AT residuals remain outside this local verdict.
