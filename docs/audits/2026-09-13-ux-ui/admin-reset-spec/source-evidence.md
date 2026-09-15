# Source inspection evidence

Frozen application source was inspected only; no runtime or database was started.

## Confirmed problem and canonical correction

- Root `BUG-038` is confirmed P2/not-ready: applied response loss was observed, while unchanged markers, generic timestamps and another reset cannot identify the outcome of the exact request.
- `admin-correction.md` requires request identity/version/order before readiness, keeps the one-time secret unrecoverable and explicitly rejects blind retry.

## Existing reusable seams

- `apps/api/src/modules/auth/auth-service.ts:571-620`: `resetPassword` already generates the secret/hash, opens one transaction, locks actor/target through `lockAdminMutationUsers`, updates password, revokes all target sessions, inserts `temporaryPasswordIssues`, audit and notification, then returns plaintext.
- `apps/api/src/modules/auth/auth-service.ts:467-500`: `lockAdminMutationUsers` uses deterministic user ordering and `FOR UPDATE`, and recomputes active-admin authority inside the transaction. The proposal reuses it unchanged as the reset authorization/target lock seam.
- `apps/api/src/db/schema.ts:86-96`: `temporary_password_issues` stores only issue identity/actor/time/consumption, not plaintext. A rejected request must not be represented as an issue, which justifies the separate receipt table.
- `apps/api/src/app.ts:723-734` and `apps/web/src/api.ts:457-461`: the existing route/response has no request ID, body or idempotency header.
- `apps/api/src/app.ts:1904-1920`: a shared UUID `parseIdempotencyKey` already exists and can be reused.
- `apps/api/src/modules/tournaments/tournament-service.ts:348-370`: the repository already uses SHA-256 request fingerprints and `IDEMPOTENCY_KEY_REUSED`; the proposed receipt follows that convention.

## Why adjacent credential paths need a local recheck

- `login` verifies a hash, inserts a session and only then updates the user without a shared user-row transaction (`auth-service.ts:243-301`). A reset can otherwise revoke before a racing login inserts its session.
- `changePasswordFirst` and `changePassword` update credentials/sessions without locking the same user row or revalidating that their already-authorized session remains active (`auth-service.ts:334-417`). A request authorized just before reset could otherwise overwrite the new reset credential afterward.
- The proposed double-check remains inside `AuthService`: no port/adapter/new service is introduced. It is the smallest seam that makes both-order claims testable.

## Rejected designs

- `issuedAt`, `users.updatedAt`, latest audit row or a generic `credentialRevision`: not correlated to the exact request and can reflect login, profile work, first-change or another reset.
- Replaying the same POST and returning the secret: impossible without storing/recovering plaintext, which is forbidden.
- Treating receipt absence as rejection: unsafe while a delayed transaction may still commit.
- A public/self-reset receipt token: expands the auth boundary and creates a credential-adjacent bearer secret.
- Allowing uncorrelated legacy POSTs: a delayed old request could arrive after a confirmed replacement and become authoritative; failing closed is required for the ordering proof.
