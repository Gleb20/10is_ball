# Stage 3 WO2 — auth forms and restricted-session logout

This is a local implementation checkpoint on the accepted WO1 R1/R2 tree above
`550d3680`. It is awaiting independent WO2 review. The full Stage 3 gate,
release, and device acceptance have not happened.

## Observable Red and Green

[`red-logout.json`](red-logout.json) uses the original FirstPasswordPage source
in a controlled temporary swap. The same disposable, in-memory PGlite API and
Chromium browser had two restricted sessions. The old UI sent **0** logout POSTs;
the first context still received `/auth/me` **200** after Exit and Back, and the
second context received **200**. The WO2 source was restored byte-for-byte before
continuing.

[`green-logout.json`](green-logout.json) uses the WO2 source with another fresh
in-memory API. Exit sent **1** logout POST, first-context `/auth/me` returned
**401**, second-context `/auth/me` remained **200**, and Back showed Login. Both
API instances attested `auditEphemeral=true` on `/health`. The probe generated
the admin credential in memory and kept the temporary user credential only in
memory; neither appears in this evidence or its screenshots.

[`auth-states.json`](auth-states.json) records 10 actual React/ic-kit Chromium
cases: Login and FirstPassword at 360, 390, 1440 CSS px, 720 CSS px with 200%
CSS zoom (360 effective), and OS dark preference at 390. It records empty,
filled, and **pre-edit error** geometry, plus a separate post-edit login state.
Input shells and primary actions align, targets are at least 44 px, input font
is 16 px, the card top remains reachable under CSS zoom, and there is no
horizontal document overflow. Native selection range, Tab/Shift+Tab, Escape, touch
toggle at 390, hidden→revealed→hidden without replacing the input, Enter submit,
generic wrong-credential error, mismatch association, translated policy reasons,
and focused errors were checked. Login error screenshots were captured before
editing cleared the alert. See the corresponding `login-*.png` and
`first-password-*.png` files.

[`pending-states.json`](pending-states.json) records a held Login POST and a held
FirstPassword logout POST in Chromium. The relevant fields/actions were
disabled, a programmatic duplicate submit did not create a second request, and
Save could not start during logout. A controlled 503 kept both first-password
field values (lengths only recorded), showed a focused error, and required an
explicit next action. [`login-pending-390.png`](login-pending-390.png),
[`first-password-logout-pending-390.png`](first-password-logout-pending-390.png)
and [`first-password-logout-error-390.png`](first-password-logout-error-390.png)
show these states.

The focused regressions in
[`AuthPages.wo2.test.tsx`](../../../../apps/web/src/pages/AuthPages.wo2.test.tsx)
cover 401-as-ended logout, both directions of held Save/Logout, known refusal,
mismatch/policy associations, independent reveal controls, generic credentials,
and held Login. The strengthened `auth-recovery.test.tsx` checks route, query,
hash, mounted draft and absence of rejected mutation replay for the same actor;
the existing other-actor case checks a clean tree.

## Exact local commands and raw logs

- `pnpm --filter @tab10/web exec vitest run src/pages/AuthPages.wo2.test.tsx`
  — Red 6/6 before the change; `/private/tmp/tab10-wo2/red-tests.log`.
- `node docs/audit/evidence/stage3-wo2/real-logout-probe.mjs red|green`
  — the Red run used only the controlled temporary original-page swap; raw
  `/private/tmp/tab10-wo2/red-real-logout.log` and `green-real-logout.log`.
- `node docs/audit/evidence/stage3-wo2/auth-states-probe.mjs` — 10/10 state
  cases and 2/2 pending scenarios; raw `/private/tmp/tab10-wo2/auth-states.log`.
- `pnpm --filter @tab10/web exec vitest run src/pages/AuthPages.wo2.test.tsx src/auth-recovery.test.tsx src/pages/SubmissionGuards.test.tsx`
  — 18/18; `/private/tmp/tab10-wo2/focused-tests.log`.
- `pnpm --filter @tab10/web test` — 270/270 in 41 files;
  `/private/tmp/tab10-wo2/web-test.log`.
- `pnpm --filter @tab10/web typecheck` — PASS;
  `/private/tmp/tab10-wo2/typecheck.log`.
- `pnpm --filter @tab10/web build` — PASS, 115 modules; existing large
  chunk warning; `/private/tmp/tab10-wo2/web-build.log`.
- `node scripts/audit/check-docs.mjs` — 166 files; zero broken links,
  anchors, duplicate IDs or incomplete backlog entries;
  `/private/tmp/tab10-wo2/docs-audit.log`.

All commands used Node 24.20.0 on `PATH`. The server/browser probes use only
loopback and disposable processes. Probe scripts write outputs into this
directory; after freeze, replay them only in a disposable checkout copy and
check their output paths first. See [`safe-replay.md`](safe-replay.md) for the
accepted WO1 scripts, which must not be run in the accepted checkout.

## Limits

The app explicitly sets `data-theme=light`; the OS-dark cases verify that the
same light auth UI stays coherent under dark preference. They are not a dark
theme implementation or a dark-auth PASS. CSS zoom is a reflow approximation,
not browser UI zoom or physical iPhone persistent zoom. Browser/OS autofill,
WebKit, physical keyboard, VisualViewport/safe area, spoken assistive technology,
and Judge landscape gutters/rotation remain unverified or outside WO2. The
known iPhone issue remains open. No public mutation, commit, push, version bump
or deployment occurred.
