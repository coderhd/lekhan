# 0003 — Desktop app stores pages as markdown files plus a Yjs sidecar, not IndexedDB

Date: 2026-08-23
Status: Accepted
Applies to: H1 desktop app (Tauri, epic #43)

## Context

Tauri renders in the OS webview. IndexedDB there is opaque (buried in webview profile directories),
unbackuppable by users, wipeable on webview/OS updates, and size-capped — it would undermine the
local-first ownership story for exactly the users the product targets (Obsidian refugees who expect
files they own).

The markdown round-trip pipeline (#26) already losslessly serializes editor content — including
callouts, wikilinks, frontmatter-as-properties — to `.md`. The server WAL (`server/wal.js`) already
implements the append-updates + compacted-snapshot persistence pattern Yjs needs.

## Decision

Desktop persists each workspace to a user-chosen folder as:

1. **A real `.md` file per page** — human-visible layer. Users can open the folder in Obsidian,
   back it up, grep it, or commit it to git.
2. **A hidden `.lekhan/` sidecar directory** — append-only Yjs update log + periodic compacted
   snapshots per page (the `server/wal.js` pattern pointed at disk). Carries what markdown cannot:
   CRDT merge state for real-time collaboration and offline conflict resolution.

IndexedDB remains a mobile-PWA-only storage backend.

## Consequences

- The Obsidian importer degrades gracefully into "open folder as workspace": desktop reads `.md`
  natively; import becomes pointing at an existing vault.
- Bidirectional file watching is required: external edits to `.md` (e.g., from Obsidian) must be
  re-imported into the live doc. This is real work — its own ticket when #43 is specced.
- E2E encryption applies only to data leaving the machine; local files stay plaintext (user's own
  disk) — consistent with ADR 0001.
- Rich content that cannot survive markdown round-trip must either gain a serialization convention
  or be rejected at the schema level; the round-trip tests in #26 are the guardrail.
