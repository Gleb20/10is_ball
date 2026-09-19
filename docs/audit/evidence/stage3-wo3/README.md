# Stage 3 WO3 — local Red/Green and browser evidence

WO3 starts from the accepted WO2 R2 manifest
`/private/tmp/tab10-wo2-r2-freeze-isoofo0q/manifest.json` (SHA-256
`6cfe5290cc6d375b1990e1edc8251144d2e210aaa1caa7dd6053377ddf13f4d3`).
The 104 source/evidence files listed there matched before WO3 edits. WO1/WO2
archives and logs remain unchanged. This is a local candidate for Terra/root
review; full Stage 3 acceptance and release have not occurred.

## Red and Green

The first focused run on the accepted baseline gave 5 failures: the new tests
observed editable match payload controls, editable Judge first-server controls,
an unclassified unknown judge setup outcome, and a bracket error outside its
open Dialog. One additional old test failure was test mock leakage from the new
test and was corrected by clearing that mock. Raw Red:
`/private/tmp/tab10-wo3-red.log`. Earlier audit evidence supplies the rendered
baseline for dark Judge error/labels: [component recheck](../../../audits/2026-09-13-ux-ui/components-recheck/report.md) and
[correction screenshots](../../../audits/2026-09-13-ux-ui/judge-correction-probe/screenshots/c01-commit-then-lost-response.png).

The change disables submitted match fields as a native fieldset while leaving
Cancel available; the roster picker remains visible but disabled during manual
add. Judge freezes server, side swap and board choice across both setup steps.
After a confirmed start, only setup may be explicitly retried after a definitive
rejection; the start response and chosen random server are retained. An unknown
start or setup outcome remains blocked after an early read, since side swap is
a toggle and a read is not a receipt. Bracket generation has a separate sticky
unknown state across close/reopen in the same page. Its Dialog contains the only
error Alert, retains selection, and disables Confirm after unknown outcome or
noncorrectable status. A manual state read never unlocks an unknown mutation.
Successful generation requires both a confirming response and a current readback.
If the POST is confirmed but its readback fails, a later explicit GET that
confirms the generated bracket closes the Dialog and permits a later explicit
regeneration; an unknown POST never gains that permission from GET alone.
The immersive Judge error and two native correction labels have scoped colors.

Focused component tests: **66/66** in four files, including a late failed
bracket read after changing tournament, serial checks, confirmed start with
known second-step rejection, unknown first and second steps, label click/focus,
and captured roster payload. Entire web suite: **284/284** in 42 files. Web
typecheck and production build passed (115 modules; existing large-chunk
warning). Raw logs: `/private/tmp/tab10-wo3-focused.log`,
`/private/tmp/tab10-wo3-web-test.log`, `/private/tmp/tab10-wo3-typecheck.log`,
`/private/tmp/tab10-wo3-web-build.log`.

## Production-preview browser probe

[`browser-probe.mjs`](browser-probe.mjs) runs the built web app in a loopback
production preview with entirely mocked synthetic API responses. Its
[`browser-results.json`](browser-results.json) records actual browser DOM,
computed colors and captured requests. These are client-state checks against a
synthetic in-memory store, **not PostgreSQL persistence evidence**.

- Match create at 390 px: one POST with the visible creator/guest payload;
  title, format, creator and guest disabled while held; Cancel remains available;
  409 preserves the guest and enables correction. [Pending frame](match-pending-390.png).
- Manual roster add at 390 px: chosen `u4` stays visible and disabled during
  one held POST; 409 preserves the value, explicit second submit updates the
  synthetic store, and a read displays the participant. [Pending frame](roster-add-pending-390.png).
- Bracket at 360, 390 and 1440 px: one unknown POST, one in-Dialog focused Alert,
  choice retained, manual GET, Confirm disabled after close/reopen, no second
  POST or horizontal overflow. At 360 the footer begins below the viewport but
  is reachable inside the Dialog by scrolling. Tab and Shift+Tab remain inside;
  Escape closes it and returns focus to the build trigger. The first browser
  run found focus on BODY after Escape at all three widths
  ([Red](browser-focus-red.json)); scoped trigger restoration passes in
  [Green](browser-results.json). [Error 360](bracket-unknown-360.png), [footer 360](bracket-footer-360.png),
  [desktop](bracket-unknown-1440.png).
- Judge setup at 390 px: confirmed start once, held setup with frozen server,
  swap, board and Cancel; after definitive setup rejection an explicit new
  selection sends only setup, without a second start. [Pending frame](judge-setup-pending-390.png).
- Actual immersive Judge at 360/390/1440 px: computed `.judge-error` text
  `rgb(245,129,129)` on `rgb(15,17,21)` = **7.50:1**; both correction labels
  `rgb(245,245,245)` on `rgb(26,29,36)` = **15.47:1**. `htmlFor` links each
  unique input and clicking the first label focuses it. [360 frame](judge-error-correction-360.png), [390](judge-error-correction-390.png),
  [1440](judge-error-correction-1440.png).

The first dev-server probe exposed a pre-existing development StrictMode timing
issue: the first tournament GET was marked stale during effect replay, leaving
its skeleton until explicit Refresh. It is tracked as open BUG-041, with no
claim of an equivalent production-navigation defect. That run was not used as Green.
The final probe uses a production-preview build and opens the page without a
fallback refresh; initial tournament loading passed. This observation is
outside WO3 and does not assert a production defect.

No real iPhone, WebKit, OS keyboard/VisualViewport, spoken AT, PostgreSQL,
cross-device persistence or CSS/browser UI zoom was verified here. The
existing pending Dialog close policy Q-UX-001, bracket backend receipt/version
fence, and score recovery remain outside WO3. There was no commit, push,
version change, deployment or public mutation.
