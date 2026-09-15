# BUG-038 specification handoff

Status: **READY_FOR_REVIEW**, source-only. Root/Terra must accept or reject this exact proposal before BUG-038 becomes ready. No implementation, migration, runtime, canonical-doc edit, commit, push or deploy occurred.

## Proposed acceptance sentence

Accept a required UUID request receipt plus `users.last_admin_password_reset_request_id` CAS. A separately confirmed request B supplies a fresh expected pointer and `supersedesRequestId=A`; B wins whether delayed A commits before or after it. Exact receipt/replay never returns a secret, absence remains unknown, and every credential/session path rechecks under the same target user-row ordering.

## Review checklist

- One contract only: existing POST plus exact preflight and receipt GET routes; no route alternatives.
- No generic `credentialRevision`; the pointer orders admin resets only.
- No plaintext in schema, receipt, GET, logs, audit, screenshot or browser persistence.
- Applied/rejected receipts are request-correlated; another reset is never attributed to the caller's request.
- Both A→B and B→A orders make B final; unrelated C forces a new confirmation.
- First-change/change-password cannot overwrite a reset after their session was revoked; login cannot create a post-reset session from an old hash.
- Self-reset revokes the caller. Lost self-reset response requires another active admin or existing approval-gated ops recovery; no auth bypass.
- API compatibility is fail-closed for missing request IDs; same route and first-success secret field are retained.
- Receipt retention is explicit: indefinite under current no-deletion policy.

## Required independent verdict

Terra should return `PASS` only if the CAS acceptance rule, receipt transaction behavior, credential lock ordering and PG both-order tests are sufficient to prove that no delayed predecessor can invalidate a confirmed replacement. Any requested change should name the exact unsafe interleaving or disclosure rather than reopening the broader ADMIN audit.
