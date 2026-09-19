# Stage 3 WO2 R2 — repeated auth error focus and input typography

This bounded correction starts from the immutable WO2 R1 manifest
`/private/tmp/tab10-wo2-freeze-dffj8mr4/manifest.json`, SHA-256
`22fefb9c5bdcdb40a4d1659c9c4614e2eb89c148df639ea2e8cd39bd22b55b20`.
All R1 and WO1 evidence, logs, patches, and manifests remain unchanged. WO2 R2
is a local candidate for independent review, not whole Stage 3 acceptance.

## Red and Green

The new [`AuthFocus.wo2r2.test.tsx`]
(../../../../apps/web/src/pages/AuthFocus.wo2r2.test.tsx) had a meaningful
**1/1 Red** on the frozen R1 source: after mismatch → focus Save → submit the
same values again, focus stayed on Save instead of the existing Alert. The
R2 focus revision requests focus once per reported submit error, even when the
message string stays identical. Editing clears the stale mismatch without
another focus request. Green focused auth/reauth/guard tests: **20/20**.

[`red-focus-font.json`](red-focus-font.json) and
[`green-focus-font.json`](green-focus-font.json) measure all four actual inputs
on Chromium at 360×844. R1 computed font sizes were Login Email **14 px** and
Login password/new password/confirmation **16 px**. R2 scopes a minimum 16 px
to AuthLayout inputs; all four now compute to **16 px**. This replaces the R1
summary that sampled only a password input; it does not identify the cause of
the reported physical iPhone zoom.

The same local browser probe reproduced first Alert focus=true, second=false
on R1, then first=true, second=true on R2. One Alert remained; both fields kept
their original DOM nodes, values and `aria-describedby` associations. After an
edit, focus stayed in the field and Tab/Shift+Tab reached the reveal control and
returned. [`red-repeated-mismatch-360.png`](red-repeated-mismatch-360.png),
[`green-repeated-mismatch-360.png`](green-repeated-mismatch-360.png), and
[`green-login-font-360.png`](green-login-font-360.png) are rendered evidence;
the JSON activeElement measurements establish focus, which is not reliably
distinguishable from the screenshots alone.

## Commands and logs

- `pnpm --filter @tab10/web exec vitest run src/pages/AuthFocus.wo2r2.test.tsx`
  — Red 1/1; `/private/tmp/tab10-wo2-r2/red-focus.log`.
- `node docs/audit/evidence/stage3-wo2-r2/focus-font-probe.mjs red`
  — old repeated focus false and 14/16/16/16 px;
  `/private/tmp/tab10-wo2-r2/red-browser.log`.
- `pnpm --filter @tab10/web exec vitest run src/pages/AuthFocus.wo2r2.test.tsx src/pages/AuthPages.wo2.test.tsx src/auth-recovery.test.tsx src/pages/SubmissionGuards.test.tsx`
  — 20/20; `/private/tmp/tab10-wo2-r2/focused.log`.
- `node docs/audit/evidence/stage3-wo2-r2/focus-font-probe.mjs green`
  — repeated focus true and 16/16/16/16 px;
  `/private/tmp/tab10-wo2-r2/green-browser.log`.
- `pnpm --filter @tab10/web test` — 272/272 in 42 files;
  `/private/tmp/tab10-wo2-r2/web-test.log`.
- `pnpm --filter @tab10/web typecheck` — PASS;
  `/private/tmp/tab10-wo2-r2/typecheck.log`.
- `pnpm --filter @tab10/web build` — PASS, 115 modules with the existing
  large-chunk warning; `/private/tmp/tab10-wo2-r2/web-build.log`.
- `node scripts/audit/check-docs.mjs` — 167 files, zero broken links,
  anchors, duplicate IDs or incomplete items;
  `/private/tmp/tab10-wo2-r2/docs-audit.log`.
- `git diff --check` — PASS; `/private/tmp/tab10-wo2-r2/diff-check.log`.

All commands used Node 24.20.0. The probe uses a disposable loopback Vite
process and synthetic mocked API responses; it records password lengths only.
It writes into this directory, so replay after freeze belongs in a disposable
checkout copy with output paths inspected first. The real in-memory PGlite
logout Red/Green in [R1 evidence](../stage3-wo2/README.md) was not repeated:
R2 changes neither logout behavior nor the API/auth lifecycle.

Physical iPhone persistent zoom, actual browser UI zoom, OS autofill,
VisualViewport/keyboard/safe area, WebKit, spoken AT, and Judge landscape
remain unverified or outside WO2. The app remains fixed light theme. No
commit, push, version change, deployment, public mutation, or full Stage 3 CI
was performed.
