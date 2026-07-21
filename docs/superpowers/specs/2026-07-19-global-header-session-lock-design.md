# Global Header and Session Lock Contrast Design

## Goal

Restore a single shared header owner for non-authenticated routes and make its interaction behavior consistent: translucent, backdrop-filtered, sticky, and hidden while scrolling down but revealed while scrolling up. At the same time, make the session reauthentication dialog readable and appropriately separated from its backdrop in both light and dark themes.

## Scope

In scope:

- Render one `GlobalHeader` from the shared application layout for non-auth routes.
- Keep the existing auth-page headers on `/login`, `/signup`, and `/forgot-password`.
- Preserve route-specific header content for the landing page, dashboard, and settings page.
- Preserve the current public informational pages' default header actions.
- Add direction-aware header visibility with a smooth transition and reduced-motion support.
- Replace hard-coded black/white alpha surfaces in the session-lock dialog with theme semantic tokens.
- Verify behavior in both themes and at desktop/mobile viewport sizes where practical.

Out of scope:

- Redesigning the auth-page headers.
- Changing session timeout, reauthentication, sign-out, or Supabase behavior.
- Changing dashboard, landing page, or settings content outside their header integration.
- Introducing a new navigation model or changing route access rules.

## Architecture

`app/layout.tsx` will own the shared shell. It will render a client-side header host alongside the existing `SessionReauthProvider`, page content, footer, info banner, and toaster. The host will inspect the current pathname and render `GlobalHeader` only for non-auth routes; auth pages will continue rendering their own current headers without duplication.

`GlobalHeader` will remain the visual shell and will expose two named injection targets: the main/center area and the right-actions area. A lightweight slot/portal component will let route-level components register their existing controls into those targets while the header itself remains mounted by the layout. Slot cleanup on unmount and route changes will prevent stale controls from appearing on another route.

The affected route components will stop rendering a nested `GlobalHeader` and will instead render the slot content at their existing logical location:

- Landing page: features/FAQ links, theme toggle, and log-in action in the right slot.
- Dashboard: search field in the main slot; theme toggle, notifications, and profile menu in the right slot.
- Settings: breadcrumb/title in the main slot; theme toggle and profile menu in the right slot.
- About, FAQ, Contact, Privacy Policy, and Terms: no custom slot content; the layout-owned default header actions remain.

## Header behavior

The header will use `sticky top-0`, a translucent semantic background, `backdrop-blur-md`, border, and a high stacking context. It will be visible on initial render and whenever the scroll position is near the top. After a meaningful downward scroll, it will translate upward out of view. An upward scroll will translate it back into view. Scroll handling will be passive and throttled with `requestAnimationFrame` (or an equivalent single-frame guard) to avoid state updates for every raw scroll event. The previous scroll position will be clamped to zero so returning to the top always reveals the header.

The visibility transition will use a CSS transform and opacity/visibility state only; it will not change document flow or cause content reflow. A `prefers-reduced-motion` rule will disable the transition while preserving the final visible/hidden states.

## Session-lock contrast

The modal overlay will retain the security-focused dimming and blur, but the dialog card and controls will use semantic theme tokens:

- Card: `background`/`surface-container` with `border` and semantic shadow.
- Heading/body/labels: `on-surface` and `on-surface-variant`.
- Account field: `input` or a theme-safe surface with `border`.
- Password field: theme-safe input background, `border`, placeholder, focus ring, and readable `on-surface` text.
- Error message: existing semantic error tokens.
- Primary action: existing primary container and on-primary-fixed tokens, retaining its visible disabled/loading state.
- Sign-out action: semantic muted text with semantic error hover state.

The modal will keep its existing focus, password submission, error, loading, and sign-out behavior. The fix is limited to contrast and theme-safe surfaces.

## Data flow and failure handling

The layout-owned header shell is always the source of header chrome. Route-specific slot components register their React content when mounted and clear it when unmounted. If a slot is absent, the header renders its normal default action set. A missing or late slot must not prevent the logo, theme toggle, or default navigation action from rendering.

Scroll state is local to `GlobalHeader`; it does not affect page state or persistence. The listener is attached only in the browser and is removed on unmount. It will avoid updating state after cleanup.

Theme behavior continues to be controlled by `next-themes`. The session dialog must render correctly before and after a theme toggle without relying on manually adding/removing the `dark` class in individual pages.

## Verification

Before implementation is considered complete:

1. Run the project's lint command and production build.
2. Run existing unit tests.
3. Start the app with the repository's dev script and inspect a non-auth route.
4. Verify the header is present once, translucent, sticky, and does not duplicate the page's old header.
5. Exercise downward and upward page scrolling and confirm hide/reveal behavior.
6. Confirm auth pages still show only their existing header.
7. Trigger the session lock in dark mode and light mode, confirming readable heading, labels, email, password placeholder/input, error state, primary button, and sign-out action.
8. Check at least one desktop and one mobile-sized viewport when the local app and browser tooling permit it.
9. Check browser console warnings/errors and confirm there is no framework error overlay.

## Acceptance criteria

- The shared header is owned by `app/layout.tsx` for non-auth routes.
- Auth pages retain their current headers and do not receive a duplicate shared header.
- Existing route-specific header controls still work, including dashboard search, notifications, profile menus, settings controls, landing navigation, theme toggling, and log in.
- Header scrolling hides on downward movement and reappears on upward movement, with no layout jump.
- The shared header retains translucent backdrop-filter styling and sticky positioning.
- Session-lock dialog content and controls meet readable contrast expectations in light and dark themes.
- Lint, build, tests, and rendered checks complete without new relevant errors.
