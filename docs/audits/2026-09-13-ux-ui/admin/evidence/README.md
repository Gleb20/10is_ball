# ADMIN evidence

Safe, synthetic, disposable evidence for the accepted `GAP012-r6` candidate at base HEAD `9f71b9f4c91f6f7184e8c34716d7b57b7c27a221`.

- `runtime-observations.json`: the eight run outcomes, dialog text, expected console errors and sanitized persisted-audit sample.
- `environment.json`: toolchain, fixed local ports and exact health release marker. It contains no database URL or credentials.
- `cleanup.json`: completed cleanup and free port evidence.
- `fixture-index.json`: synthetic IDs/labels only; no email/password/token/cookie.
- `screenshots/`: 13 screenshots. One-time password DOM text was replaced with a clear `[СКРЫТО]` marker before capture.
- `safe-replay/`: reproducible harness using a digest-pinned PostgreSQL tmpfs. It generates fixture/admin passwords only in process memory and always tears down processes, temp files and the Docker project.
- `admin-audit-runner.mjs`: browser/API/DB driver. Lost reset response is injected after one successful server response; it records that no blind retry was executed.
- `render-annotated.mjs`: local renderer for the structural before/after artifacts; it performs no product mutation.
- `flow-report-preview.png`: render QA snapshot proving the standalone HTML report lays out successfully.
- `validate-package.mjs`: read-only local JSON/CSV/link/candidate-integrity validation.

Expected console errors are induced 401/403/409 and network-abort branches. There were no page exceptions. The local migrator URL in the harness targets `127.0.0.1:33030`, uses the disposable no-password test role from the checked-in migration verifier, and is not an external credential.
