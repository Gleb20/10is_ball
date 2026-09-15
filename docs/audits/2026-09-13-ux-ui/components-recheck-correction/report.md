# COMPONENTS recheck evidence correction

## Scope

This documentation-only correction narrows two visual-evidence claims in the immutable [components-recheck report](../components-recheck/report.md) and [coverage delta](../components-recheck/coverage-delta.md). It does not modify runtime evidence, findings, app code, canonical documentation or either earlier frozen audit package.

Frozen source package manifest self-hash: `51b1896d8f93a12bfe18309d311399639e812c4678b6f51ce0362d2526480dab`.

## Precise replacement mapping

| Immutable source claim | Corrected interpretation |
|---|---|
| `components-recheck/report.md:24` labels `match-create-option-active-1440.png` as representative “desktop Autocomplete” evidence alongside popup-related findings | The PNG is **desktop form context only**. It does not visibly contain the query text, popup, active option or a rendered option/nav intersection. It must not be cited as visual proof for `F-CMP-001` or `F-CMP-002`. |
| `components-recheck/coverage-delta.md:18` marks Player A keyboard active option as covered at both 1440 and 360 | Visual active-option coverage at 1440 and 360 is **NOT_TESTED**. The 1440 finding has raw DOM/rect evidence; the 360 record contains `aria-activedescendant` only and no captured visible option. |
| `runtime-states.json` field `F-CMP-001-002-RECHECK-DESKTOP.actual.occludedByNav=true` | Do not interpret this boolean as geometric overlap: its predicate only compared option bottom with nav top. Exact rects show option top `1039.39`, viewport bottom `1000`, and nav bottom `1000`; therefore the option is below the viewport, not intersecting the nav rectangle. |

## Corrected verdict boundary

- `F-CMP-001`: still runtime-confirmed by raw DOM state: input `aria-activedescendant="_r_c_-option-0"`, active option `id=null`, referenced element absent. The contextual 1440 PNG adds no visual proof.
- `F-CMP-002`: the candidate run confirms the keyboard-active option is outside the 1440 viewport (`top=1039.39` with viewport bottom `1000`). It does **not** revalidate visible fixed-nav overlap at 1440, and provides no active-option visual capture at 360. Treat the original frozen finding as retained, while this candidate recheck is only partial evidence for its broader visibility target.
- Touch390 evidence remains valid and scoped: the visible option is above BottomNav and tap selection passes in that scrolled emulation state.
- All other recheck claims and screenshots retain their prior interpretation, including Enter/edit remount, focus/card styling, pending/error Dialog behavior, UserPicker async states, mutation-control states and actual dark judge contrast.

No runtime recapture was performed for this correction. The coordinator pilot owns any replacement visual capture of the active option and nav relationship.

