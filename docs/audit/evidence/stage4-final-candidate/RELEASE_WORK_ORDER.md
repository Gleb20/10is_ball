# Release work order — 4.1.2

## Fixed inputs

- Public base: `8b9d2650f7991e121052634ace758f5991ef25b5`, version 4.1.1.
- Candidate version: 4.1.2 from the root `package.json`.
- Required source receipt: `frozen-source-manifest.json`.
- Required local gate: `local-summary.json`, 1442/1442.

## Execution

1. Confirm `main` and `origin/main` still point to the fixed public base and that
   the scoped candidate is the only release delta. Stop on drift.
2. Recheck application and test paths against the frozen manifest. Canonical
   documentation and this final evidence package may differ only by the recorded
   post-gate finalization.
3. Create one scoped release commit on `main` for the 4.1.2 candidate. Do not
   include unrelated work, historical diagnostic artifacts, raw traces, or
   environment files.
4. Push the fast-forward commit to `origin/main`. Native Render and Vercel Git
   integrations then publish the disposable stand under D32. No tag is required.
5. Observe hosted CI for the exact pushed SHA. Require all jobs to pass.
6. Wait for Render and Vercel to converge. Render may apply only immutable forward
   migrations; this candidate contains no new migration.
7. Run read-only `pnpm smoke:public`. Require web, API, proxy, and readiness to
   report version 4.1.2 and the exact pushed SHA.
8. Record commit SHA, hosted CI run, provider results, smoke attempts/time, and
   the public parity receipt. Keep the seven items at `verified_local`: health,
   version, and SHA parity do not replace public flow or phone acceptance.

## Stop conditions

Stop on base drift, manifest mismatch, non-fast-forward push, failed hosted CI,
provider version/SHA disagreement, readiness failure, or any request for data
reset, down-migration, secret change, DNS/billing/access change, or mutating
public E2E. Those operations are outside this work order.
