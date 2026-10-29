# 0006 — Vault export reads Page content local-first, syncing only gaps

**Status:** Accepted · **Date:** 2026-10-07 · **Issue:** [SIL-64](/SIL/issues/SIL-64) (S4a) · **Epic:** [SIL-9](/SIL/issues/SIL-9) (#78)

## Context

Whole-Workspace → Obsidian vault export (`buildVaultFiles` / `buildVaultZip`,
`lib/markdown/vault-export.ts`) needs each Page's Tiptap `doc`. Page bodies are
**not** reachable client-side in bulk today:

- the `pages` table has no content column
  (`supabase/migrations/20260812000000_pages_graph_schema.sql`), and
- bodies live in encrypted `<pageId>/main_state.bin` snapshots that only the
  sync server decrypts (ADR 0001). The editor receives only the *current* Page's
  Yjs doc over the y-websocket collab server (ADR 0004).

Story 13 requires export to be **fully client-side** ("leaving is always possible
regardless of service status") and forbids adding a dedicated server export
endpoint. The S4 spec (§5.5) left the concrete content path to this task.

Two options were named:

1. **Client batch-sync** — open each Page's collab doc briefly (`WebsocketProvider`,
   wait for sync, read the Yjs state), bounded concurrency, progress UI.
2. **Local-first snapshot** — prefer the `y-indexeddb` copy the client already has
   (the editor persists every opened Page under `IndexeddbPersistence(pageId)`),
   and sync only the gaps.

## Decision

**Adopt option 2: read local-first, sync only the gaps.**

The loader (`lib/markdown/vault-export-loader.ts`, orchestrated by
`lib/markdown/vault-export-source.ts`) resolves each non-folder Page's doc as:

1. **Local** — open `IndexeddbPersistence(pageId, doc)` and read the page's
   `y-indexeddb` copy if the `default` Y.XmlFragment is non-empty. This is the
   fast path for Pages the user has already opened on this device, and it works
   offline.
2. **Gap sync** — only when no local copy exists, open a short-lived
   `WebsocketProvider` for that Page (same room, token, `documentId` params the
   editor uses) and read the doc after the `sync` event. Bounded concurrency
   (default 4) keeps the number of simultaneous connections small; a per-Page
   timeout fails the Page soft (a `FidelityWarning`), never the whole export.
3. Convert the Yjs state to Tiptap JSON via `MarkdownEngine.yjsStateToJson`
   (the inverse of `seedToYjsBase64`; ADR 0005 keeps the conversion on the engine).

A Page whose content cannot be read is exported as a title/frontmatter-only note
and surfaced as a warning in the `FidelityReport` — never silently dropped.

## Consequences

- **Client-side guarantee holds**: no export endpoint is added; the whole zip is
  assembled in the browser (zip writer is pure, `lib/zip-write.ts`).
- **Reduced load**: an export touches the collab server only for Pages the
  device has not cached, instead of opening one websocket per Page in the
  workspace.
- **Freshness trade-off**: a locally cached Page reflects the device's last
  synced copy, which may lag a change made on another device. This matches the
  "compatibility, never live sync" framing (§3) — an export is a one-shot
  snapshot, not a live mirror — and is recorded here so the behaviour is honest.
- **Bounded concurrency** means large workspaces export without a connection
  stampede; a per-Page timeout bounds worst-case latency.

## Alternatives considered

- **Always remote batch-sync (option 1).** Simpler read path but opens one
  websocket per Page even when every Page is already cached locally, and offers
  no offline export.
- **Server export endpoint.** Rejected: violates story 13's client-side guarantee.
