# Corrected active-option coverage delta

| Surface / evidence | 1440 | touch390 | 360 | Corrected result |
|---|---:|---:|---:|---|
| Keyboard active-option DOM semantics | raw DOM ✓ | not exercised | `aria-activedescendant` only | `F-CMP-001` confirmed at 1440; 360 semantic completeness not established |
| Keyboard active-option viewport geometry | raw rect ✓ | not exercised | NOT_TESTED | 1440 option is below viewport; no valid 360 option rect |
| Active option visibly captured | NOT_TESTED | touch option ✓ | NOT_TESTED | 1440/360 contextual PNGs do not show the active option |
| Fixed-nav geometric intersection | NOT_TESTED | no intersection in captured touch state | NOT_TESTED | erroneous derived 1440 overlap boolean is withdrawn |
| Touch option and tap selection | not exercised | visual/runtime ✓ | not exercised | option visible above nav; tap selects and closes popup |

## Screenshot labels

- `match-create-option-active-1440.png`: **desktop form context**, not popup/active-option evidence.
- `match-create-option-360.png`: **360 form context**, not visible active-option evidence.
- `match-create-option-touch-390.png`: valid visible touch-option/context evidence.

All non-active-option coverage remains as recorded in the immutable source package. Browser UI zoom 200% remains `NOT_TESTED`.

