# PR #182 — Clean-Room Review (DN-T1, epic #39)

**Date:** 2026-11-02
**Reviewer:** independent clean-room reviewer subagent (fresh context, read-only)
**Scope:** `git diff origin/main...HEAD` — commits `86f382f` (feature), `c118043` (generated
Next.js rules block), `d7d2bb2` (spec), `afc0180` (review fixes).
**Spec:** `docs/superpowers/specs/2026-11-02-h1-daily-notes-quick-capture-inbox-design.md` §DN-T1

## Verdict

**Initial: REVISE** — one blocker (test collection under a clean shell) plus accessibility and
correctness medium findings.
**After fixes: APPROVE** — every blocker/medium finding is fixed or dismissed with a reason
below; full suite, typecheck, lint, and build re-run green.

## Findings and disposition

### BLOCKER

1. **`tests/unit/daily-strip.test.tsx` failed to collect without `NEXT_PUBLIC_SUPABASE_*`.**
   The partial mock of `@/lib/daily-notes` loaded the real module, which imports `@/lib/supabase`
   and creates a client at module scope with empty env (`supabaseUrl is required`).
   **Fixed:** the test now mocks `@/lib/supabase` (`{ supabase: { from: vi.fn() } }`). Verified by
   running the suite with those env vars unset: 32 tests pass.

### MEDIUM

2. **Lookup ignores the spec's "top-level Page" phrasing.**
   **Dismissed, with reason.** Reuse is intentionally parent-agnostic. The locked invariants are
   "one page per date per workspace" and "never creates a second one"; if a user or importer
   already made `YYYY-MM-DD` a `#daily` page under a parent, reusing it beats creating a duplicate
   title. New daily pages are always created top-level. Documented in `ensureDailyPage`'s doc
   comment.
3. **`#daily` is not in `page_tags` until the page's first save.**
   **Accepted and documented.** `page_tags` is server-maintained by `sync_page_graph`; writing it
   from the client would be a new write path, which DN-T1 forbids ("zero new write path"). The
   code documents `properties.daily` as the authoritative reuse/dot marker; the graph tag index
   catches up on the first editor save (DN-T2 appends a capture block immediately, so the epic
   path does save). Residual risk recorded below.
4. **Tests echoed mocks without proving query scoping.**
   **Fixed:** reuse test now asserts `eq('workspace_id', …)` and `eq('title', …)`; the dots test
   asserts `eq('workspace_id', …)` alongside `in('title', …)`.
5. **Accessibility: visible "Today" missing from the accessible name; date changes unannounced;
   arrows enabled during a create.**
   **Fixed:** the affordance label is now `Today, <action> daily page for <date>` (WCAG 2.5.3
   Label in Name), the long date is `aria-live="polite"`, and prev/next are disabled while busy.
   Tests assert label-in-name and the live region.
6. **"Today" frozen at mount; overnight tabs create yesterday's page.**
   **Fixed:** the strip re-anchors today on `visibilitychange`, window `focus`, and a 60s interval,
   and follows the rollover when the selection was the old today. Tested with a faked clock.

### LOW

7. **Stale dot map across workspace changes.** Fixed: the map is cleared when `workspaceId`
   changes.
8. **Touch targets below 44px.** Fixed: arrows are `h-11 w-11`; the day cells and affordance are
   `min-h-11`.
9. **Timezone/DST tests do not pin a timezone.** Acknowledged; the assertions are local-time
   component checks (no `toISOString`), and the implementation is exercised by the rollover test.
   Pinning a non-UTC zone would need a separate Vitest environment and is deferred.
10. **Duplicate failure announcement + vague Retry.** Fixed: the toast was removed (single inline
    `role="alert"`), the message uses `text-error`, and the button is "Retry opening <date>".
11. **Spec not on the branch.** Fixed: the approved spec is committed (`d7d2bb2`).

### NIT

- Group label corrected to "Days around the selected date".
- `focus-visible` rings added to every control.
- `data-testid="daily-dot"` kept as the test seam for the visual dot (the button's accessible name
  also announces it).
- English-only `Intl` formatters match the app's current English-only UI.
- `owner_id` documented as the acting user (`auth.uid()`), not the workspace owner — correct for
  H0's owner-scoped workspaces and required for future team workspaces.
- Dashboard keeps the strip mounted across refetches (only `fetchError`/missing workspace hides
  it), so the selected day and dots survive a refetch.

## Verification after fixes

```text
npm run typecheck                                              ✅
npx eslint <changed files>                                     ✅
env -u NEXT_PUBLIC_SUPABASE_* npm test   → 96 files / 876 tests passed, 0 failed
npm run build                                                  ✅
```

## Residual risks (accepted)

- Cross-device duplicate daily pages are still possible: uniqueness is by convention (spec-locked);
  the in-flight dedupe is per JS context.
- No `(workspace_id, title)` index; the dashboard window query may scan on very large workspaces.
  Adding one would violate DN-T1's "zero schema changes".
- A nightly tab that never regains focus/visibility nor crosses the interval boundary could still
  act on the previous day; the interval makes that window ≤60s.
- Collaborators in different timezones can disagree on "today" (accepted UTC drift in v1).
- `#daily` search visibility lags the first save (see finding 3).

---

## Round 3 — external review close-out + `main` merge (2026-11-03)

Payload: SIL-203 merge-gate courier (owner: Dev Engineer). PR had drifted to `CONFLICTING`
against `main` (base `0def707`, nine commits behind) and Pullfrog had left three inline
suggestions on `2cbe751`.

### Pullfrog findings — all three accepted and fixed

1. **`components/daily-strip.tsx` — Retry control ≈24px, below the strip's own 44px bar.**
   Fixed exactly as suggested: `flex min-h-11 items-center` on the retry button, so the touch
   target matches the arrows and day cells without changing its visual proportions.
2. **`components/quick-capture-palette.tsx` — every `forbidden` collapsed to "You do not have
   edit access to that page."** A vanished access token is thrown as
   `CaptureError('forbidden', 'Sign in again to capture.')`, so the old catch told a
   session-expired user they lacked edit rights. Fixed: `forbidden` now surfaces
   `error.message` (both thrown messages are already user-facing and distinct). Added a
   regression test that a missing submit-time token toasts "Sign in again…" and never the
   edit-access wording.
3. **`components/dashboard.tsx` — tooltip advertised only `Cmd+Shift+C`.** The handler accepts
   `metaKey || ctrlKey`. Fixed: `Quick capture (⌘/Ctrl+Shift+C)`.

### Merge with `main`

`origin/main` advanced to `9e341a1` (DN-T3 backlink drawer, domain move to `lekhan.online`,
wake-bridge, perf test script). One conflict, in `components/dashboard.tsx`: this branch adds
`<DailyStrip>` at the top of `<main>`, `main` adds `<WorkspaceViewsNav active="pages" />` in the
same slot. Both are kept — the views nav stays the first row and the strip renders directly
beneath it, which is the layout both features assume. No other file conflicted; the new
`d3-force` dependencies from `main` were installed for verification.

### Verification after fixes + merge

```text
npx vitest run tests/unit/{quick-capture-palette,daily-strip,dashboard-refetch-on-auth}.test.tsx
                                                               ✅ 3 files / 31 tests
npm run typecheck                                              ✅
npx eslint <changed files>                                     ✅
```

Full suite across the merged tree: `npx vitest run` → 110 files / 1012 passed, 1 skipped, 0 failed.
