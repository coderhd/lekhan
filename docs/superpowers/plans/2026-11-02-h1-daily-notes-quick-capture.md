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
  appends to the chosen page's Inbox section instead.
- The append goes through a headless Tiptap editor bound to the page's Y.Doc over the existing
  y-websocket channel. **No server-side body write, no direct `pages` content update.** Collaborators
  receive the change live through the CRDT channel.

## T1 — RED: unit tests for the pure capture/append layer

1. `tests/unit/quick-capture.test.ts`
   - `buildCaptureText`: local padding, `#inbox` added once (case-insensitive), `#tag`/`[[link]]`
     untouched, whitespace collapsed, empty input rejected.
   - `appendCaptureBlockToEditor` against a real `Y.Doc` + Tiptap Collaboration editor:
     empty page → `h1 <date>`, `h2 Inbox`, one timestamped bullet; second capture appends to the
     same list; existing Inbox section is extended, not duplicated; content without an Inbox section
     grows one.
   - `appendCaptureBlock` orchestrator with an injected connector: waits for sync, appends, flushes,
     destroys; a sync failure rejects and still destroys.

## T2 — GREEN: `lib/quick-capture.ts`

1. `buildCaptureText` / `captureTimeLabel` / `hasInboxTag`.
2. `appendCaptureBlockToEditor(editor, { pageTitle, text, now })` — top-level scan for the `Inbox`
   heading (level ≤ 2), append to the section's last top-level bullet list, or create
   `h2 Inbox` + `bulletList` at the section/page end. Seed `h1 <pageTitle>` only on an empty doc so
   the page keeps the editor's required leading heading.
3. `appendCaptureBlock({ pageId, pageTitle, token, text, now })` — `Y.Doc` + dynamic
   `y-websocket` connection (token/documentId params identical to `use-editor-collab`), wait for
   `sync` with a timeout, create the headless editor (`getSharedExtensions` + `Collaboration`),
   dispatch, flush the socket, destroy everything in `finally`.
4. `CaptureError` with a user-facing `code` (`offline` | `forbidden` | `timeout`).

## T3 — Palette + dashboard entry

1. `components/quick-capture-palette.tsx`: root-layout provider (mirrors `GlobalSearchPalette`),
   `useQuickCapture()`, global shortcut, Radix dialog, one input, page-picker stage, toast result.
   Resolves the workspace with `ensureWorkspace(user.id)` and the session token at submit.
2. `app/layout.tsx`: mount inside `SessionReauthProvider`, wrapping `GlobalSearchPalette`.
3. `components/dashboard.tsx`: labeled "Quick capture" button beside search.
4. `tests/unit/quick-capture-palette.test.tsx`: shortcut open, `#tag`/`[[link]]` passthrough to
   `appendCaptureBlock`, a11y labels/dialog role, Escape closes, locked session never opens.

## T4 — E2E + VERIFY

1. `tests/e2e/quick-capture.spec.ts` (env-gated like the existing specs): login → `⌘⇧C` → type →
   Enter → today's daily page holds the timestamped `#inbox` bullet; second capture appends below.
   Second test: two authenticated contexts, page open in B, capture in A, bullet appears in B
   without reload (two-collaborator check).
2. `npm run typecheck && npm run lint && npm test && npm run build`.
3. Clean-room adversarial review of `git diff origin/main...HEAD` → `docs/reviews/pr-204-review.md`;
   fix valid findings; then PR, external review, merge per the SHIP gate.

## Out of scope

- Inbox card, triage keys, inbox counting (DN-T3).
- In-app/email/Telegram capture channels; offline capture queue (spec non-goals).
- Fixing the pre-existing `server/persister.js` `ydoc.getText('default')` text extraction that throws
  for XmlFragment documents — noted for DN-T3 because inbox tag counting depends on it, but it is a
  separate defect outside this ticket's append path.
