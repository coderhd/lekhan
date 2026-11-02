# H1: Daily notes / quick capture / inbox — Design

**Date:** 2026-11-02
**Status:** Approved (design — scheduled into W45)
**Epic:** [SIL-27](/SIL/issues/SIL-27) · GitHub issue #39
**Strategy:** docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md §4 H1
(roadmap: "First H1 epic is #39 — no blockers")

## Goal

Close the fastest PKM loop on the roadmap: **capture anything in one action**, land it in
**today's daily page**, and **triage it later** from an Inbox view. No new schema, no new
write path — this entire epic composes existing Page machinery.

## Background

- Pages are the universal nodes of the graph (`services/graph.ts`, `createPage`), nested
  under workspaces with tags, links, and markdown round-trip already delivered (H0
  import/export pipeline).
- There is no daily-notes affordance, no quick capture, no inbox surface anywhere in the
  app today. This epic is additive UI over existing primitives.
- Language (CONTEXT.md): the surfaces are **Pages** (never "notes"/"documents"); capture
  runs through the **Workspace** of the user's choice.

## Scope decisions (locked)

- **Daily notes are Pages:** a daily page is a top-level `Page` per workspace whose title
  **is** the local date `YYYY-MM-DD` (single canonical format; no `[[2026-11-02]]` vs
  free-text ambiguity), tagged with `#daily` on creation, including a `properties.daily`
  marker so #47 databases can later type them.
- **Uniqueness is by convention, not constraint:** `ensureDailyPage(ws, date)` reuses the
  existing page if a `#daily`-tagged page with that exact title exists; otherwise creates.
  One page per date per workspace (duplicates show same target in search/graph).
- **Quick capture surface:** a single global palette action (`⌘⇧C` and a dashboard button)
  → one mini input → optionally add `#tag` inline in the text using the existing `#tag`
  grammar → Enter lands the paragraph into today's daily page, underneath the capture
  heading block, appending as a new block with the timestamp. No separate schema type for
  captures ("capture" is a content convention, not an entity).
- **Where captures land:** default is the daily page's Inbox section. An optional button in
  the palette lets users hand the capture to a chosen page (existing page-picker search
  reused from the `[[` autocomplete path).
- **Inbox view:** the daily page's "Inbox" section, plus a dedicated dashboard "Inbox"
  summary card (count + top 5 pending items); opening it opens today's daily page scrolled
  to the section. Inbox items are bullet blocks tagged `#inbox`; triage = edit/move/link/tag.
- **Triage actions (keyboard-first):** on a capture row, `o` → link it to a page
  (via `[[wikilink]]` into the target page's related-actions block), `Del` → delete,
  `t` → add tags. Processed items (linked or deleted) leave the Inbox count.
- **Calendar affordance (small):** dashboard header strip lists today's date; clicking
  opens/creates today's daily page; left/right arrows move day; days with daily pages show
  a dot (queried by title format + `#daily` tag).

## Architecture

```text
⌘⇧C / dashboard QuickCapture button ──▶ QuickCapturePalette (root layout, authed)
                                          │ debounced page search (server RPC reuse from
                                          │   global search — services/search.ts)
                                          ▼
                      appendCaptureBlock(pageId, text, {section:"inbox"})
                              │ supabase client-side CRDT append (existing editor tx)
                              ▼
                      daily page (a Page) updated; graph index derives [[links]]/#tags
                      as usual — zero hub changes

Dashboard ▷ DailyStrip (today, prev/next) + InboxCard (count)
   → /page/[id] if daily page exists else auto-create via ensureDailyPage then redirect
```

- `lib/daily-notes.ts`: `dailyTitle(date)`, `dailyTag`, `ensureDailyPage(ws, date)` reusing
  `services/graph.ts createPage` + a title-or-tags lookup; timezone = client-local (a
  workspace's daily page always names the date the user means — UTC drift is accepted in
  v1 and documented).
- Append path must reuse the editor's existing CRDT-aware append (same code path as the
  `[[` autocomplete's create-page insertion — `lib/insert-parsed-html.ts` seed) so live
  collaborators see the capture immediately. No server-side body write.

## Tickets

| Slice | Est | Title |
|---|---|---|
| DN-T1 | 3 | `lib/daily-notes.ts` + `ensureDailyPage`, DailyStrip calendar affordance on dashboard, today/prev/next + dot indicator |
| DN-T2 | 5 | QuickCapturePalette global action (⌘⇧C + button), capture-into-daily-page append (CRDT-aware), inline `#tag`/`[[link]]` grammar passthrough |
| DN-T3 | 5 | Inbox surface: dashboard InboxCard + daily page Inbox section, keyboard triage (`o` link / `Del` delete / `t` tag), empty/loading states |

## Acceptance (epic)

- `⌘⇧C` anywhere (authed) opens capture; Enter lands today's daily page with a timestamped
  block; second capture appends, never duplicates the daily page when opened again.
- DailyStrip prev/next opens/creates the right date page; days with existing daily pages
  show dots and reuse the existing page.
- InboxCard count matches the number of `#inbox` bullet blocks in the workspace's daily
  pages of the last 14 days; processed blocks stop counting.
- Unit tests prove `ensureDailyPage` reuses the existing `#daily` page instead of creating
  a second one; `dailyTitle` is timezone-stable per workspace.
- Works end-to-end in a 2-collaborator session (capture from device A is immediately
  visible on device B via the existing CRDT channel).
- a11y: palette is keyboard trapped, `Del`/`o`/`t` only fire on focused row, labeled
  buttons on the strips/cards; follows the #79 UX-parity bar.

## Test requirements per slice

- DN-T1: unit tests for `dailyTitle` and `ensureDailyPage` reuse-vs-create; component test
  for DailyStrip (dot state, navigation, network-fail recovery).
- DN-T2: e2e/Playwright test of ⌘⇧C → type → Enter → block appears on today's daily page;
  component test for inline `#tag`/`[[link]]` flavor passthrough; verified capture round-trip.
- DN-T3: unit test for inbox counting (14-day window, processed items excluded); component
  tests for triage keys (`o`/`Del`/`t`) and empty state.

## Non-goals (v1)

- Full Obsidian-style calendar plugin UI; native date pickers; template variables
  (`{{date}}` — Templates epic #42 covers).
- Capture-to-Inbox routing from outside the app (email/telegram #43); mobile capture UX.
- Offline-first capture queue (PWA/offline land later; CRDT append already tolerates
  offline extension).
