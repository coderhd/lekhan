# 0004 — Sync topology: server-hub CRDT replication across device replicas

Date: 2026-08-23
Status: Accepted

## Context

With desktop storing pages as local files (ADR 0003) and mobile PWA using IndexedDB, the question
arises how a page edited on desktop appears on mobile. The model must be stated explicitly to avoid
designs where devices read each other's storage directly.

## Decision

**The server is always the hub; every device holds its own replica of the workspace.**

- Desktop: replica lives in the user-chosen folder (`*.md` + `.lekhan/` sidecar).
- Mobile PWA: replica lives in IndexedDB.
- Cross-device transfer happens only through the sync layer: y-websocket relay for live sessions,
  Supabase Storage snapshots for cold state. Mobile never reads the desktop's disk; it merges
  updates from the hub into its own replica.
- Offline edits queue locally on each device and merge via Yjs CRDT on reconnect — no conflict
  copies, no last-writer-wins.
- **Desktop merge-on-launch (mobile edit → desktop file):** when the desktop app opens a page, it
  loads the hub's cold state (`main_state.bin`) plus pending WAL updates, merges them into the local
  sidecar state via CRDT, and **rewrites the `.md` file from the merged result**. So yes — changes
  made on mobile appear in the desktop's local files automatically on open; the local file is
  overwritten with the merged content, not replaced wholesale. Edits made locally before launch are
  preserved because the CRDT merge is additive (both sides' ops survive), never a blind overwrite.

Analogy: Microsoft Word + OneDrive works the same way at heart — the `.docx` on disk is one copy,
OneDrive holds the cloud copy, other devices open *their* synced copy. The difference is the merge
engine: OneDrive does file-level sync with conflict copies when two devices diverge offline; Word's
real-time co-authoring only works against the cloud hub. Lekhan's CRDT does block-level merge, so
offline divergence resolves without conflict copies while keeping real-time collaboration.

## Consequences

- "Open the same vault folder from two machines" works, but both replicas still reconcile through
  the hub — local files are not a peer-to-peer transport.
- Free-tier boundary enforcement (sync access) lives at the hub (connection limits in
  `server/index.js`, future distinct-user/device caps), not in client storage formats.
- The hub is load-bearing infrastructure for every tier (see ADR 0002 history costs); hardening it
  precedes charging for sync.
