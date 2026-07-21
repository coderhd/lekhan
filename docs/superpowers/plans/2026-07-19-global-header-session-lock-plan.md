# Global Header and Session Lock Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** Move the shared non-auth header into the application layout, preserve route-specific controls through slots, add scroll-direction visibility, and make the session-lock dialog readable in both themes.

**Architecture:** Add a client-side GlobalHeaderProvider in the layout that owns slot state, and render GlobalHeader inside that provider from app/layout.tsx. Expose GlobalHeaderSlot registration for route-specific React content. Keep auth routes excluded by pathname, preserve the current sticky/translucent visual treatment, and manage header visibility locally from passive scroll events. Replace session-lock hard-coded black/white alpha surfaces with existing semantic Tailwind color tokens.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, next-themes, Vitest + Testing Library, Playwright.

## Global Constraints

- Keep /login, /signup, and /forgot-password on their existing auth-page headers.
- Do not change session timeout, reauthentication, sign-out, Supabase, or route-access behavior.
- Keep the shared header sticky at the top, translucent, and backdrop-filtered.
- Header content must hide on downward scroll and reappear on upward scroll without changing document flow.
- Session-lock dialog text and controls must remain readable in light and dark themes.
- Use the repository's existing scripts and dependencies; do not add packages.
- Preserve unrelated user working-tree changes and do not reset or checkout files.

---

### Task 1: Add a layout-owned header slot system and scroll behavior

**Files:**

- Create: components/layout/global-header-context.tsx
- Modify: components/layout/global-header.tsx
- Create: tests/unit/global-header.test.tsx

**Interfaces:**

- GlobalHeaderProvider({ children }: { children: React.ReactNode }): JSX.Element provides slot registration to descendants; app/layout.tsx renders GlobalHeader inside it.
- GlobalHeaderSlot({ slot, children }: { slot: 'main' | 'right'; children: React.ReactNode }): null registers route-specific content and clears it on unmount.
- GlobalHeader remains the visual header component and consumes the current main and right slot content through useGlobalHeaderSlots().

- [ ] Step 1: Write the failing unit tests for route visibility, slot rendering, and scroll direction.

In tests/unit/global-header.test.tsx, mock next/navigation with a mutable pathname, mock Supabase auth with a resolved null session and an unsubscribe spy, and stub requestAnimationFrame so scroll events can be flushed synchronously. Cover these behaviors:

    it('renders one shared header and the registered route slots on non-auth routes', async () => {
      pathname = '/settings'

      render(
        <GlobalHeaderProvider>
          <GlobalHeaderSlot slot="main"><span>Settings</span></GlobalHeaderSlot>
          <GlobalHeaderSlot slot="right"><button>Profile</button></GlobalHeaderSlot>
        </GlobalHeaderProvider>
      )

      expect(await screen.findByRole('banner')).toBeInTheDocument()
      expect(screen.getByText('Settings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument()
    })

    it.each(['/login', '/signup', '/forgot-password'])('does not render the shared header on %s', (route) => {
      pathname = route
      render(<GlobalHeaderProvider><GlobalHeader /><p>Auth page</p></GlobalHeaderProvider>)
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    })

    it('hides after downward scrolling and reveals after upward scrolling', async () => {
      pathname = '/about'
      render(<GlobalHeaderProvider><GlobalHeader /><div style={{ height: 2000 }} /></GlobalHeaderProvider>)
      const header = await screen.findByRole('banner')

      expect(header).toHaveAttribute('data-header-visible', 'true')
      Object.defineProperty(window, 'scrollY', { value: 240, configurable: true })
      act(() => window.dispatchEvent(new Event('scroll')))
      expect(header).toHaveAttribute('data-header-visible', 'false')

      Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
      act(() => window.dispatchEvent(new Event('scroll')))
      expect(header).toHaveAttribute('data-header-visible', 'true')
    })

The test must fail because the provider and data-header-visible behavior do not exist yet.

- [ ] Step 2: Run the focused test and confirm the failure is about missing header behavior.

Run: npm test -- --run tests/unit/global-header.test.tsx

Expected: FAIL with missing GlobalHeaderProvider/GlobalHeaderSlot or missing header visibility behavior, not a test-environment import error.

- [ ] Step 3: Implement the slot context and provider.

In components/layout/global-header-context.tsx, define the exact slot types and use registration tokens so an old route's cleanup cannot clear a newer route's content:

    export type GlobalHeaderSlotName = 'main' | 'right'

    type SlotEntry = { id: symbol; content: React.ReactNode }
    type GlobalHeaderSlots = Partial<Record<GlobalHeaderSlotName, SlotEntry>>

    type GlobalHeaderSlotsContextValue = {
      slots: GlobalHeaderSlots
      registerSlot: (slot: GlobalHeaderSlotName, content: React.ReactNode) => () => void
    }

    export function GlobalHeaderProvider({ children }: { children: React.ReactNode }) {
      const [slots, setSlots] = useState<GlobalHeaderSlots>({})

      const registerSlot = useCallback((slot: GlobalHeaderSlotName, content: React.ReactNode) => {
        const id = Symbol(slot)
        setSlots((current) => ({ ...current, [slot]: { id, content } }))
        return () => setSlots((current) => current[slot]?.id === id
          ? { ...current, [slot]: undefined }
          : current)
      }, [])

      return (
        <GlobalHeaderSlotsContext.Provider value={{ slots, registerSlot }}>
          {children}
        </GlobalHeaderSlotsContext.Provider>
      )
    }

Add useCallback/useEffect/useState imports. Export useGlobalHeaderSlots with a clear provider error, matching the existing useSessionReauth pattern. GlobalHeader itself should use usePathname to return null for /login, /signup, and /forgot-password, so the layout can always render the component without duplicating auth-page headers.

- [ ] Step 4: Implement GlobalHeader scroll state and slot rendering.

Update components/layout/global-header.tsx to consume the context and retain its Supabase auth behavior. Add visible state initialized to true, a lastScrollY ref initialized from window.scrollY inside the effect, and a passive scroll listener guarded by requestAnimationFrame:

    const [isVisible, setIsVisible] = useState(true)
    const lastScrollY = useRef(0)
    const frame = useRef<number | null>(null)

    useEffect(() => {
      const handleScroll = () => {
        if (frame.current !== null) return
        frame.current = window.requestAnimationFrame(() => {
          const currentY = Math.max(window.scrollY, 0)
          const delta = currentY - lastScrollY.current
          if (currentY <= 16 || delta < 0) setIsVisible(true)
          else if (delta > 0) setIsVisible(false)
          lastScrollY.current = currentY
          frame.current = null
        })
      }

      window.addEventListener('scroll', handleScroll, { passive: true })
      return () => {
        window.removeEventListener('scroll', handleScroll)
        if (frame.current !== null) window.cancelAnimationFrame(frame.current)
      }
    }, [])

Render the existing header with sticky top-0, bg-background/80, backdrop-blur-md, and transform/opacity classes. Add data-header-visible={isVisible} for deterministic tests. Render slots.main?.content between the logo and the right area, and render slots.right?.content in place of custom rightActions. Preserve the default theme toggle and login/dashboard action when no right slot is registered.

Use motion-reduce:transition-none and keep the transform state in CSS classes: translate-y-0 opacity-100 versus -translate-y-full opacity-0 pointer-events-none. Verify that the hidden state does not alter layout height.

- [ ] Step 5: Run the focused tests and confirm they pass.

Run: npm test -- --run tests/unit/global-header.test.tsx

Expected: all header visibility, auth-route exclusion, and slot-rendering tests PASS.

- [ ] Step 6: Commit the isolated header behavior.

    git add components/layout/global-header-context.tsx components/layout/global-header.tsx tests/unit/global-header.test.tsx
    git commit -m "feat: add shared scroll-aware header shell"

If the workspace still rejects .git/index.lock, report the permission error and leave files unstaged rather than touching unrelated changes.

### Task 2: Mount the shared header in the layout and migrate route-specific controls

**Files:**

- Modify: app/layout.tsx
- Modify: components/landing-page.tsx
- Modify: components/dashboard.tsx
- Modify: components/settings-client.tsx
- Modify: app/about/page.tsx
- Modify: app/contact/page.tsx
- Modify: app/faq/page.tsx
- Modify: app/privacy-policy/page.tsx
- Modify: app/terms-of-service/page.tsx
- Modify: tests/unit/global-header.test.tsx

**Interfaces:**

- app/layout.tsx wraps the existing application content in GlobalHeaderProvider.
- Route components use GlobalHeaderSlot and no longer render a nested GlobalHeader.

- [ ] Step 1: Add a route migration smoke test.

Extend tests/unit/global-header.test.tsx with a route-like layout composition that renders GlobalHeaderProvider containing one GlobalHeader plus a child containing GlobalHeaderSlot and asserts getAllByRole('banner') has length one. This keeps the no-duplicate-header assertion tied to the corrected layout ownership.

- [ ] Step 2: Run the migration regression test.

Run: npm test -- --run tests/unit/global-header.test.tsx

Expected: the route-like layout composition remains green after the page migrations; if it fails, it identifies a duplicate or missing header during integration.

- [ ] Step 3: Mount GlobalHeaderProvider in app/layout.tsx.

Keep ThemeProvider, SessionReauthProvider, GlobalFooter, SessionInfoBanner, and Toaster in their current order. Wrap the existing flex shell inside GlobalHeaderProvider:

    <SessionReauthProvider>
      <GlobalHeaderProvider>
        <GlobalHeader />
        <div className="flex min-h-screen flex-col">
          <main className="flex flex-1 flex-col">{children}</main>
          <GlobalFooter />
        </div>
        <SessionInfoBanner />
        <Toaster />
      </GlobalHeaderProvider>
    </SessionReauthProvider>

Import GlobalHeaderProvider from @/components/layout/global-header-context. Do not add a second header to auth pages.

- [ ] Step 4: Replace route-level header wrappers with slots.

In landing-page.tsx, replace the GlobalHeader wrapper with a GlobalHeaderSlot slot="right" containing the current features/FAQ/theme/login JSX. In dashboard.tsx, register the current search JSX in slot="main" and the current theme/notifications/profile JSX in slot="right"; keep notification refs and state in Dashboard. In settings-client.tsx, register the breadcrumb/title in slot="main" and theme/profile controls in slot="right".

For the six informational pages, remove the GlobalHeader import and JSX entirely; the layout-owned header's default actions will render. Keep page content intact.

- [ ] Step 5: Remove obsolete header compensation spacing.

Adjust only top spacing that existed to compensate for page-local fixed headers:

- Landing page: change the wrapper main pt-16 to pt-8.
- Dashboard: change pt-24 to pt-8 because the sticky header participates in document flow.
- Informational pages: change their first content container pt-16 to pt-8 where needed to avoid a doubled header gap.
- Do not modify auth-page header spacing.

- [ ] Step 6: Run unit tests and lint for the migrated routes.

Run: npm test -- --run tests/unit/global-header.test.tsx
Run: npm run lint

Expected: focused header tests PASS and ESLint exits 0. If lint reports existing unrelated errors, record them separately and fix only errors introduced by this migration.

- [ ] Step 7: Commit the layout migration.

    git add app/layout.tsx components/landing-page.tsx components/dashboard.tsx components/settings-client.tsx app/about/page.tsx app/contact/page.tsx app/faq/page.tsx app/privacy-policy/page.tsx app/terms-of-service/page.tsx tests/unit/global-header.test.tsx
    git commit -m "refactor: mount global header from app layout"

If git remains permission-blocked, leave the working tree intact and report it.

### Task 3: Fix session-lock contrast with semantic theme tokens

**Files:**

- Modify: components/session-reauth-provider.tsx
- Create: tests/unit/session-reauth-provider.test.tsx

**Interfaces:**

- Keep SessionReauthProvider, useSessionReauth, lockSession, unlockSession, handleReauth, and handleSignOut behavior unchanged.
- Only modal/overlay styling and test coverage change.

- [ ] Step 1: Write the failing dialog styling regression test.

Mock next/navigation (usePathname returning /, useRouter with push), Supabase auth (getSession returning a user and onAuthStateChange), and sonner. Render a test consumer that calls lockSession() from useSessionReauth, then assert the dialog renders with semantic classes and no hard-coded dark-only field classes:

    it('uses theme-safe surfaces and text for the locked-session dialog', async () => {
      render(<LockedSessionHarness />)
      fireEvent.click(screen.getByRole('button', { name: 'Lock session' }))

      expect(screen.getByRole('heading', { name: 'Session Locked' })).toBeInTheDocument()
      expect(screen.getByText('test@example.com')).toHaveClass('bg-input', 'text-on-surface')
      expect(screen.getByPlaceholderText('Enter your password')).toHaveClass('bg-input', 'text-on-surface')
      expect(screen.getByRole('button', { name: 'Verify Password' })).toHaveClass('bg-primary-container', 'text-on-primary-fixed')
      expect(screen.getByText('Sign out of this account')).toHaveClass('text-muted-foreground')
      expect(screen.getByPlaceholderText('Enter your password').className).not.toMatch(/dark:bg-black|border-white/)
    })

Use fireEvent from Testing Library so no dependency change is needed. The test must fail against the current bg-black/* and border-white/* classes.

- [ ] Step 2: Run the dialog test to verify the expected failure.

Run: npm test -- --run tests/unit/session-reauth-provider.test.tsx

Expected: FAIL on the missing semantic class assertions, not on Supabase/router mocks.

- [ ] Step 3: Apply semantic classes without changing dialog behavior.

In components/session-reauth-provider.tsx:

- Change the overlay to bg-background/85 backdrop-blur-md while retaining fixed inset-0, z-index, centering, padding, and animation.
- Change the dialog card from glass and border-white/10 to bg-surface-container, border-border, and shadow-2xl while retaining width, radius, spacing, and positioning.
- Change the account field to bg-input border-border text-on-surface.
- Change the password input to bg-input border-border text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-primary/30.
- Change the sign-out divider to border-border and keep text-muted-foreground hover:text-error.
- Keep primary button, error semantics, focus behavior, auto-focus, loading spinner, and event handlers intact.
- Do not replace all theme-specific styles globally; this fix is scoped to the modal.

- [ ] Step 4: Run the dialog test and existing unit suite.

Run: npm test -- --run tests/unit/session-reauth-provider.test.tsx
Run: npm test -- --run

Expected: the focused test and all existing unit tests PASS.

- [ ] Step 5: Commit the contrast fix.

    git add components/session-reauth-provider.tsx tests/unit/session-reauth-provider.test.tsx
    git commit -m "fix: improve session lock theme contrast"

### Task 4: Build and perform rendered browser QA

**Files:**

- Modify: none unless QA reveals a regression.
- Test artifacts: /private/tmp/lekhan-header-dark.png, /private/tmp/lekhan-header-light.png, /private/tmp/lekhan-scroll-hidden.png, /private/tmp/lekhan-scroll-visible.png.

- [ ] Step 1: Run full static verification commands.

    npm run lint
    npm test -- --run
    npm run build

Expected: each command exits 0. Read the complete output before reporting status.

- [ ] Step 2: Start the local app and use the Browser plugin for rendered checks.

Read and follow browser:control-in-app-browser/SKILL.md, then use the in-app Browser path. The flow under test is: non-auth route loads -> layout header renders once -> scroll down hides it -> scroll up reveals it -> session-lock modal renders in dark and light themes.

Check page identity/title, meaningful DOM, no framework overlay, and console warnings/errors. Capture screenshots at desktop and mobile-sized viewports when practical.

- [ ] Step 3: Verify the shared header across routes.

Open /, /about, /settings, and /login as available. Confirm:

- /, /about, and /settings have exactly one shared header.
- Dashboard search/notifications/profile, settings controls, and landing links/buttons remain interactive.
- /login has only its existing auth header.
- The shared header remains translucent/backdrop-filtered and sticky.
- A downward wheel/scroll gesture moves it out of view; an upward gesture restores it; content does not jump.

- [ ] Step 4: Verify session-lock contrast in both themes.

Use the supported test-time localStorage timeout override or the provider's lock context to open the modal. Check dark and light modes for readable heading/body/labels, account email, password placeholder/input, error message, primary action, and sign-out action. Capture dark and light screenshots if useful.

- [ ] Step 5: Fix only verified regressions and rerun affected checks.

If browser QA finds a mismatch, state the observed DOM/screenshot evidence, make the smallest targeted change, rerun the focused unit test, then rerun the relevant Browser interaction and static command. Do not broaden scope.

- [ ] Step 6: Review final diff and report exact verification evidence.

    git diff --check
    git status --short
    git diff --stat

Confirm no unrelated user changes were overwritten. Report the commands and their exit results, the rendered routes/themes checked, any pre-existing failures, and whether commits were blocked by the .git/index.lock permission.
