# Stage 3 aggregate gate — local evidence

Date: 2026-09-19. Base: `550d3680a08a8faf4e1e4afbfcc373c942f155d0`. Local candidate version: `4.1.1`. No commit, push, tag, deployment or public mutation was performed.

The single required `pnpm run ci` invocation completed cleanup 4/4, quality 1188/1188 and PostgreSQL 72/72. Chromium could not start inside the macOS sandbox (`MachPortRendezvousServer`, permission denied), so that aggregate command remains infrastructure-interrupted and is not a successful full CI. The full command was not repeated.

The browser lane was resumed outside the sandbox on disposable PostgreSQL. After two test-integration corrections, the pre-regression-correction tree passed 60/60 browser scenarios plus 9/9 foundation checks. That run is historical evidence; it predates the later match-directory product correction.

The subsequent regression package in `../stage3-final-regression/` supersedes the aggregate receipt for the final frontend tree:

- deterministic delayed-directory Red in both match forms;
- R2 focused Green 32/32;
- final quality 1193/1193;
- first corrected-tree full browser 59/60 plus 9/9 foundation, with one desktop GAP-012 first-option timeout and no proven source cause;
- final authorized original-order full browser 60/60 plus 9/9 foundation, with passive desktop/mobile capture showing retained query/input identity and normal selection;
- a four-phase filled-suggestion matrix passed 4/4 plus 9/9 foundation and preserved query/selection through the controlled 476 px late layout insertion.

The final green run does not explain the earlier timeout and does not establish that it was harmless, pre-existing or fixed. The filled-suggestion matrix remains supporting discrimination. Its `vendorDOMShapeMatches` boolean is invalid for an editable ic-kit field because the frozen helper required a read-only-only attribute; the raw event and geometry capture records that limitation.

`aggregate-receipt.json` is the machine-readable aggregate history plus the final-regression overlay. Coverage retains 236 atoms and reconciles 23 Stage 3 rows: 19 local overlays and four explicit residual rows. Accepted local items are marked `verified_local`; BUG-019, BUG-022, BUG-040 and GAP-034 retain their stated residual status. Physical iPhone, WebKit and spoken assistive-technology checks remain outside this local gate.

The copied `*.log` files here and in the work-order evidence are intentionally ignored by the repository-wide log rule. `release-allowlist-ignored.txt` is the exact allowlist for clean-export validation; it is not a broad force-add instruction.
