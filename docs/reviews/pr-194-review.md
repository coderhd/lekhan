# Clean-Room Review — PR #194 (SIL-161)

Scope: `git diff origin/main...HEAD` — `feat/161-shortcut-help-empty-states`.
Reviewer: independent clean-room subagent (did not author the code).
Artifacts reviewed: `lib/shortcuts.ts`, `components/shortcut-help-dialog.tsx`,
`components/global-search-palette.tsx`, `components/dashboard.tsx`,
`lib/editor-extensions.ts`, tests, and `docs/superpowers/specs/SIL-161-shortcut-help-spec.md`.

## Verdict

**REVISE** on `ec0b78d`; all Major findings and actionable Minors closed in
`4d9984b`. Re-verification after the fixes: targeted suites 37/37, `tsc` clean,
targeted `eslint` clean. Full suite: 1269 passed, 1 skipped, 3 pre-existing
`billing-gateway` failures that also fail on `origin/main` (`ca400b4`, #158).

## Findings and disposition

### Major

| # | Finding | Disposition |
|---|---|---|
| M1 | Dashboard whole-workspace search/filter empty state still read as a dead end. | **Fixed** — copy now says "No pages match this search or filter. Try a shorter word, or widen the date range." |
| M2 | Dialog claimed "Every shortcut" while omitting editor formatting keys; the inventory test used `arrayContaining`, so drift could not fail. | **Fixed** — added a Formatting group (bold, italic, underline, strike, inline code, quote, bullet/numbered list, heading 1–6); subtitle softened to "The gestures this build actually implements"; test now asserts an exact id list plus a duplicate-key check. |
| M3 | `⌘⇧S` was documented as version history but Tiptap Strike also bound it, so the key struck the selection. | **Fixed** — StarterKit's `strike` is disabled and a local Strike extension binds `Mod-Shift-x`; inventory documents `⌘⇧X`. Test asserts the override list. |

### Minor

| # | Finding | Disposition |
|---|---|---|
| m1 | Esc test claimed focus restore without asserting it; trap test only checked `aria-modal`. | **Fixed** — dialog explicitly captures/restores the opener; tests assert opener focus after Esc and that Tab stays inside the dialog. |
| m2 | Palette → help handoff focus unverified; comment described Radix incorrectly. | **Fixed** — comment corrected; footer test asserts the help dialog owns focus after the handoff. |
| m3 | Signed-out gating untested. | **Fixed** — added signed-out test. |
| m4 | Failed recent fetch rendered "Nothing to quick-switch yet." | **Fixed** — dedicated error state with **Try again**; tests cover search failure and recent-fetch failure. |
| m5 | Browser-reserved note was macOS-only. | **Fixed** — `browserReservedNote(platform)` renders `⌘W…` or `Ctrl+W…`. |
| m6 | `?` could stack help over another open modal. | **Fixed** — handler bails when any `[role="dialog"][data-state="open"]` is present; test added. |
| m7 | Input guard test dispatched on `document`, so only the activeElement branch ran. | **Fixed** — tests dispatch on the focused element and assert `defaultPrevented === false`. |

### Nits

| # | Finding | Disposition |
|---|---|---|
| n1 | Redundant `aria-modal`. | **Kept** — removing it left the attribute absent under this Radix/jsdom version and broke the modal test; explicit is safer. |
| n2 | Keyless row's bare `—` unstable for screen readers. | **Fixed** — `sr-only` "No shortcut" plus `aria-hidden` dash. |
| n3 | Slash menu described as line-start only. | **Fixed** — "Type / to open the block menu". |
| n4 | Unbounded query echo. | **Fixed** — truncated at 40 chars with an ellipsis. |
| n5 | Missing newline at EOF. | **Fixed**. |
| n6 | "notes" vs the domain's "Page" vocabulary. | **Fixed** — "pages" in the dashboard copy. |

## AC evidence after fixes

| AC | Evidence |
|---|---|
| `?` opens only when signed in, unlocked, not typing | Gate `userId`/`isLocked`; `isTypingTarget` covers INPUT/TEXTAREA/SELECT, `isContentEditable`, and contenteditable ancestors. Tests: opens, input guard (`defaultPrevented === false`), contenteditable guard, signed-out, locked. |
| Opens from the palette footer | Footer button swaps modals; test asserts palette closes, dialog opens, dialog owns focus. |
| Esc closes; focus-trapped modal | Radix dialog + explicit opener restoration; tests assert Esc close, focus return, and Tab containment. |
| Wired to the real shortcut list; honest claims | Dialog maps `SHORTCUT_GROUPS`; exact-id and duplicate-key tests; formatting keys included; Share marked "No keyboard shortcut yet"; `⌘⇧S` collision removed. |
| Empty-state pass, no lorem | Dashboard first-run/section/search, palette zero-results/no-recency/error, editor placeholder; tests for palette paths, source review for dashboard/editor. |
