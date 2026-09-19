# Stage 3 WO1 R2 — constrained picker geometry

This is a local implementation candidate on base `550d3680a08a8faf4e1e4afbfcc373c942f155d0`. It addresses the P1 finding in the independent WO1 R1 review. It is not `verified_local`, a full Stage 3 CI result, or a public user journey.

## Real-component Red and Green

The fixture imports the actual React `Autocomplete`, app CSS, and (for the nested case) app `Dialog`. The outer container scrolls; the inner ancestor is 120 px tall and clips overflow. The same 30-option list is used before and after the vendor change. At 390×844, the R1 code entered the `max(above, below) < 60` branch: only 30 px was available on each side of the input. The menu retained absolute `top: 0`; active option 20 was at y411–447 beyond the clip bottom y338. Manual scroll increased `scrollIntoView` calls from 5 to 6. See [Red measurements](red-short-clip.json) and [screenshot](red-short-clip.png); raw command output is `/private/tmp/tab10-wo1-r2/red.log`.

R2 recomputes clipping after at most one visibility scroll attempt. When the input is visible but neither side of its local clip can hold a 60 px menu, a fixed popup uses the visible viewport area and follows the input during manual scroll. In the page fixture the field is y265–309, clip y218–338, and active option 20 is y533–569; a hit test reaches it. In the real Dialog fixture the field is y505.5–549.5, clip y458.5–578.5, and active option is y449–485. Both fixtures report zero `scrollIntoView` calls, retain input focus, leave selected ID empty until Enter, then select exactly `u20`. See [page](green-page-short-clip.json) and [Dialog](green-dialog-short-clip.json) measurements and adjacent screenshots.

The separate [post-scroll check](autoscroll-remeasure.json) focuses a field below a 390×500 viewport with native `focus({preventScroll:true})`. The field begins at y737–781 with scrollY 0. One component visibility scroll reaches scrollY 305; remeasurement places the field at y432–476 and the active option at y376–412 with a working hit test and focus retained. The popup does not keep `top:0`.

[Full regression](full-regression.json) covers page 360×844, 390×844, 1280×800 and 390×500 viewport approximation, plus Dialog 360×844, 390×844 and 1280×800. Each case kept option 20 visible within its clipping ancestors, retained focus, selected `u20`, showed an existing controlled empty listbox with a status message and no active ID, and closed on intentional scroll away from the field. The 360 px open-list screenshots are adjacent. The 500 px case approximates reduced visible height, not an OS keyboard.

## Reflow and scope

[Representative state measurements](states-360.json) use real TextField, Autocomplete, and BracketAlgorithmDialog components. At 360×844 and at a 720 px viewport with `documentElement.style.zoom = '200%'` (360 effective CSS px), the field has one 3 px wrapper focus outline and its error remains present; the selected picker returns stable ID `u2` with focus retained; the radio card remains checked with a separate 3 px focus outline. There was no horizontal document overflow. The 200% CSS zoom radio card becomes taller than the dialog's visible body and needs internal scrolling; the whole card is not visible at once. CSS zoom is a reflow approximation, not browser UI zoom or a physical device check.

The R1 mixed-theme experiment does not establish a production dark-mode defect or its cause. The application fixes the light theme in `main.tsx`; R1's actual immersive Judge shell readback remains the relevant dark-surface evidence. No global theme change was made.

## Replay and limits

Exact fixture source is under `fixtures/apps/web/`. From the repository root, copy it into the Vite web root, then start Vite in one terminal:

```sh
cp docs/audit/evidence/stage3-wo1-r2/fixtures/apps/web/wo1-r2* apps/web/
PATH=/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin:$PATH pnpm --filter @tab10/web exec vite --host 127.0.0.1 --port 4179 --strictPort --force
```

In another terminal, run the real-component checks:

```sh
/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin/node docs/audit/evidence/stage3-wo1-r2/probe.mjs
WO1_PROBE_STAGE=green WO1_PROBE_MODE=dialog /Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin/node docs/audit/evidence/stage3-wo1-r2/probe.mjs
/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin/node docs/audit/evidence/stage3-wo1-r2/full-regression.mjs
/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin/node docs/audit/evidence/stage3-wo1-r2/states-probe.mjs
/Users/liubavskii/.local/share/mise/installs/node/24.20.0/bin/node docs/audit/evidence/stage3-wo1-r2/autoscroll-probe.mjs
```

Stop Vite and remove only the six copied `wo1-r2*` fixture files from `apps/web/`. The raw logs with SHA-256 hashes and exact executed commands are recorded in `/private/tmp/tab10-wo1-r2/receipt.json`. The historic Red measurement requires the R1 vendor snapshot; the replay commands above exercise R2 Green.

No WebKit installation, physical iPhone, physical safe-area/keyboard, spoken assistive technology, public mutation, or aggregate CI is claimed. Independent R2 review remains pending.
