# Target spec delta

## T-CMP-R-AUTO-001 — Stable and visible Autocomplete contract

Applies the original `T-CMP-AUTO-001` to Player A, opponent, judge, match editor and tournament UserPicker consumers.

- Every active option has a unique DOM id exactly equal to `aria-activedescendant`.
- Keyboard selection does not replace the input node or lose focus.
- Async option hydration does not remount a focused field.
- Popup placement keeps focused input and active option inside the unobscured viewport above BottomNav.
- Pending, ready-empty and failed directory states are distinguishable; failed loading exposes an actionable recovery.
- Validate at 1440, 390 touch emulation and 360; browser UI zoom 200% remains a separate required check.

## T-CMP-R-FOCUS-001 — One component-shaped focus cue

- Composite input shows one focus indicator on its visual wrapper, not an additional square raw-input outline.
- Radio-card keeps a durable selected cue and one distinct outer focus cue; no same-color border/shadow/outline triple contour.
- Hidden native radio semantics and keyboard arrow behavior remain intact.

## T-CMP-R-ASYNC-001 — Honest pending and error boundaries

- Once a mutation payload is submitted, every field that defines it is disabled or represented as an immutable submitted snapshot.
- A pending Dialog never focuses an enabled-looking action whose click/Escape handler is intentionally ignored.
- Mutation failure is perceivable in the active modal context, or the modal closes and moves focus to the page error/retry.
- Error recovery preserves the attempted selection and prevents duplicate writes.

## T-CMP-R-OVERRIDE-001 — Explicit manual override confirmation

- Warning identifies the selected person, tournament, consent bypass and bracket-regeneration consequence.
- Cancel/dismiss sends no mutation.
- Confirm sends one idempotent mutation; pending prevents changes to the selected target; failure restores a usable, truthful recovery state.

## T-CMP-R-DARK-001 — Legible immersive errors

- Normal-size `.judge-error` text reaches at least `4.5:1` against every actual underlying immersive background, including alpha composition.
- Validate with a real synthetic runtime error, not source tokens alone; keep light-shell error styling unchanged.

