# Web-specific instructions

This file extends the repository `AGENTS.md` for `apps/web`.

- Use React, React Router, TypeScript, and the existing `ic-kit` primitives and
  semantic tokens. Reuse an established page, form, dialog, list, status, and
  feedback pattern before adding a local variant.
- Treat the documented production deployment as the visual regression baseline.
  Figma is a supporting reference only unless the user explicitly approves a new
  design direction. Capture before/after evidence for intentional visual changes.
- Design mobile-first from 360 px, then verify the supported desktop widths.
  Check safe areas, portrait/landscape judge mode, text zoom, overflow, sticky
  navigation, and tournament bracket scrolling in a real browser.
- Meet WCAG AA for meaningful text and controls. Interactive targets are at least
  44 by 44 CSS pixels. Preserve semantic HTML, labels, keyboard behavior, visible
  focus, live announcements, and reduced-motion behavior.
- Every server-driven screen needs explicit loading, empty, error, success, stale,
  unauthorized, and retry behavior where applicable. Do not replace valid page
  context with an action error.
- Mirror permissions in visible/disabled affordances, but rely on API enforcement.
  Handle 401 centrally by clearing stale auth state and returning to login without
  losing an intentional post-login destination.
- Keep API calls in the shared web API layer. Prefer validated or generated DTOs
  over `Record<string, unknown>` and unchecked casts. Cancel or sequence requests
  so older responses cannot overwrite newer state.
- Poll only while the page is visible, stop on unmount, and provide the documented
  manual refresh. Serialize or queue score mutations so intentional taps are not
  lost; surface authoritative conflict state.
- Use internal router navigation for application routes. Keep bottom-navigation
  ownership and active state consistent on secondary/detail screens.
- Component tests must cover roles, states, failures, and rapid interaction. Use
  accessibility queries. jsdom geometry assertions do not replace browser checks;
  use end-to-end/visual coverage for auth, match creation, judge, tournament,
  notifications, reload recovery, and responsive regressions.
- Run focused component tests first, then `pnpm --filter @tab10/web typecheck` and
  `pnpm --filter @tab10/web test`. Run repository `pnpm ci` for shared contracts or
  critical cross-layer journeys.
