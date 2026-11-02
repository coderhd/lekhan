# Implementation plan — DN-T2 Quick capture palette (epic #39 / SIL-204)

Branch: `feat/204-dn-t2-quick-capture` (base: `feat/39-dn-t1-daily-notes`, PR #182).
Spec: `docs/superpowers/specs/2026-11-02-h1-daily-notes-quick-capture-inbox-design.md` §DN-T2.
Design dependency: DN-T1 `lib/daily-notes.ts` (`ensureDailyPage`, `dailyTitle`).

## Locked behaviour

- `⌘⇧C` / `Ctrl+⇧+C` opens the palette on every authenticated, unlocked surface, plus a labeled
  dashboard button. Public readers and a locked session never open it.
- One capture input. Enter submits; Escape closes; Radix Dialog traps focus and the trigger restores
  it. Every control is labelled.
- The text is one bullet in the page's **Inbox** section: `HH:MM <text> #inbox`. The timestamp is
  client-local (matching DN-T1's timezone decision). `#tag` and `[[wikilink]]` are passed through
  verbatim — the graph index and the Wikilink extension already own that grammar.
- Default target is today's daily page (`ensureDailyPage` → append). The optional "Send to a page…"
  stage reuses `services/search.ts` `searchPages` — the same RPC behind the `[[` autocomplete — and
  appends to the chosen page's Inbox section instead. Pages the user can only view are refused
  before connecting (the sync hub silently drops viewer writes).
- The append is a single Yjs transaction on the page's `default` XmlFragment — the same document the
  live editor binds to over y-websocket — so collaborators receive one atomic update.
  **No server-side body write, no direct `pages` content update.** The Y tree (`heading` /
  `bulletList` / `listItem` / `paragraph` + `Y.XmlText`) is the exact shape `@tiptap/y-tiptap`
  produces, and a test renders it through a real Collaboration editor to guard that contract. A
  headless editor was tried first but y-prosemirror appends its required leading block into the
  fragment on creation, so the append writes the tree directly instead of corrupting the page with
  artifact nodes.
- An empty page seeds an **empty** leading heading (matching `EMPTY_PAGE_DOC` and the export
  engine's "title lives in frontmatter, not a duplicated body heading" rule).

## T1 — RED: unit tests for the capture/append layer

1. `tests/unit/quick-capture.test.ts`
   - `buildCaptureText`: local padding, `#inbox` added once (case-insensitive), `#tag`/`[[link]]`
     untouched, whitespace collapsed, empty input rejected.
   - `appendCaptureBlockToYDoc` against real `Y.Doc`s: empty page → empty `h1`, `h2 Inbox`, one
     timestamped bullet; second capture appends to the same list without accumulating artifact
     headings; existing Inbox section is extended, not duplicated; content without an Inbox section
     grows one; a live Collaboration editor bound to the same doc renders the bullets.
   - `appendCaptureBlock` orchestrator with an injected connector: waits for sync, appends, flushes,
     destroys; a sync failure rejects and still destroys; the production y-websocket connector uses
     the room/token params of `useEditorCollab`.

## T2 — GREEN: `lib/quick-capture.ts`

1. `buildCaptureText` / `captureTimeLabel`.
2. `appendCaptureBlockToYDoc(ydoc, { text, now })` — top-level scan for the `Inbox` heading
   (level ≤ 2), append to the section's last top-level bullet list, or create `h2 Inbox` +
   `bulletList` at the section/page end. One `ydoc.transact`.
3. `appendCaptureBlock({ pageId, token, text, now })` — `Y.Doc` + dynamic `y-websocket` connection
   (token/documentId params identical to `use-editor-collab`), wait for `sync` with a 60s timeout
   (the hub's documented cold start), mutate, flush the socket, destroy everything in `finally`.
4. `CaptureError` with a user-facing `code` (`empty` | `offline` | `forbidden` | `timeout`).

## T3 — Palette + dashboard entry

1. `components/quick-capture-palette.tsx`: root-layout provider (mirrors `GlobalSearchPalette`),
   `useQuickCapture()`, global shortcut, Radix dialog, one input, page-picker stage, toast result.
   Resolves the workspace with `ensureWorkspace(user.id)` and the session token at submit; checks
   edit rights for a chosen target page.
2. `app/layout.tsx`: mount inside `SessionReauthProvider`, wrapping `GlobalSearchPalette`.
3. `components/dashboard.tsx`: labeled "Quick capture" button beside search.
4. `tests/unit/quick-capture-palette.test.tsx`: shortcut open, `#tag`/`[[link]]` passthrough to
   `appendCaptureBlock`, a11y labels/dialog role, Escape closes, locked session never opens,
   viewer-only targets refused, Capture hidden while picking.

## T4 — E2E + VERIFY

1. `tests/e2e/quick-capture.spec.ts` (env-gated like the existing specs): login → `⌘⇧C` → type →
   Enter → today's daily page holds the timestamped `#inbox` bullet; second capture appends below.
   Second test: two authenticated contexts, page open in B, capture in A, bullet appears in B
   without reload. Both contexts use the same E2E account; page_members admission for a second
   collaborator needs seeded accounts and is documented as a limitation in the spec.
2. `npm run typecheck && npm run lint && npm test && npm run build`.
3. Clean-room adversarial review of `git diff origin/main...HEAD` → `docs/reviews/pr-204-review.md`;
   fix valid findings; then PR, external review, merge per the SHIP gate.

## Out of scope

- Inbox card, triage keys, inbox counting (DN-T3).
- In-app/email/Telegram capture channels; offline capture queue (spec non-goals).

## Follow-up fixed inside this ticket

`server/persister.js` called `ydoc.getText('default')` for graph indexing, but the live editor
stores an `XmlFragment` with that name, so the call threw and no page text (including `#inbox`,
`#tags`, `[[links]]`) was ever indexed. The persister now extracts text from either form, with a
regression test, because DN-T3's inbox count depends on capture tags reaching `page_tags`.
