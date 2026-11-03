# SIL-161 — Shortcut-help `?` modal + empty-state polish (DEFINE)

Child of SIL-93 · source: SIL-133 triage on #140 (beta-optional slice).

## Problem

Lekhan ships a set of keyboard gestures (palette, slash menu, wikilinks, bot bar,
history, Markdown copy/paste) with **no single place that lists them**. New users
meet the palette's `↑↓ · Enter · Esc` footer and the editor placeholder, but the
rest is folklore. Empty first-reach surfaces also read as dead ends rather than
guidance.

## Verified shortcut inventory (source of truth)

| Gesture | Keys | Implemented in |
| --- | --- | --- |
| Open search palette | `⌘K` / `Ctrl K` | `components/global-search-palette.tsx` |
| Open Lekhan Bot | `⌘L` / `Ctrl L` | `components/editor-workspace.tsx` |
| Version history | `⌘⇧S` / `Ctrl Shift S` | `components/editor-workspace.tsx` |
| Slash menu | `/` at line start | `lib/slash-menu-extension.ts` |
| Wikilink a page | `[[Page title]]` | `lib/wikilink.ts` (decorations, no popup) |
| Copy as Markdown | `⌘C` / `Ctrl C` in editor | SIL-59 clipboard path |
| Paste Markdown | `⌘V` / `Ctrl V` in editor | SIL-57 paste path |
| Dismiss dialog | `Esc` | Radix `Dialog` |
| Shortcut help | `?` (not while typing) | this ticket |
| Share / publish | — | Share button in the editor header; **no shortcut yet** |

Browser-reserved keys (`⌘W`, `⌘T`, `⌘N`, `⌘⇧T`, …) are left to the browser and the
modal says so instead of pretending they are ours.

## Decision

- One module, `lib/shortcuts.ts`, is the single source of truth for groups, key
  tokens, platform labels, and the browser-reserved note. The modal renders from
  it — no hand-copied list in JSX.
- `components/shortcut-help-dialog.tsx` renders a Radix `Dialog` (focus trap,
  `Esc`, restore focus for free), announced as "Keyboard shortcuts".
- `GlobalSearchPalette` owns the mounting because it already tracks auth/lock
  state for every authenticated page: `?` opens help only when signed in,
  unlocked, and the event target is **not** an input/textarea/select or
  contenteditable (so `?` typed in the editor stays a character). The palette
  footer gains a "Shortcuts" button that opens the same dialog.
- Empty states get one line of in-brand guidance, no lorem copy:
  - dashboard first-run: create or import,
  - dashboard section empty: use New,
  - palette zero-results: shorten the query,
  - palette no-recency: open a page to start the list,
  - editor blank page: `/` for blocks, `[[` to link.

## Acceptance criteria mapping

| AC | Evidence |
| --- | --- |
| Opens from palette footer hint | Footer button test + component wiring. |
| Opens from `?` when not typing in editor | Keyboard tests: opens on body, stays closed in input and contenteditable. |
| `Esc` closes; focus-trapped | Radix Dialog + test asserting `role="dialog"` and focus inside; Esc test. |
| Wired to the real shortcut list | Modal renders `lib/shortcuts.ts`; test asserts `⌘K`, `⌘L`, `⌘⇧S` and the reserved-key note. |
| Empty states verified; no lorem | Updated copy + palette tests; manual dogfood pass. |

## Out of scope

- Key remapping or a configurable shortcut map (full map remains needs-design-spec).
- Shortcuts for publish/share, backlinks, export — not implemented yet, so not listed as keys.
