# SIL-214 — Vault export hotfix (cold collab room loses/overwrites content)

**Status:** Implemented on `fix/214-vault-export-cold-export` · **Issue:** SIL-214 · **Source verdict:** SIL-178 (via SIL-145 / SIL-60)

## Problem

The S4 whole-workspace → Obsidian vault export reads each Page through a
short-lived writable y-websocket room. `y-websocket` creates the room and sends
sync step 1 **before** `persistence.bindState()` (the Supabase download +
decrypt) has completed. A cold room therefore syncs an empty document; on the
last connection close `writeState` persists that empty document over the real
`documents/<pageId>/main_state.bin` snapshot.

Observed: 13/13 cold-note bodies exported empty while the report claimed
success; 10/13 stored snapshots were overwritten with empty Yjs states during
the export runs.

## Acceptance criteria

1. **Cold-server export yields content.** With no editor tabs open, every note
   whose Page has stored content exports a non-empty body.
2. **No truncation.** An export can never overwrite a stored snapshot: the
   server persists only a **fully hydrated** document and only when at least one
   writable (non-export) connection owned the room.
3. **Honest report.** A read that resolves to an empty body is treated as
   *unknown*, not success, when the Page metadata says content exists
   (`searchable_text` non-empty); the FidelityReport names the page and the
   success header is replaced by a warning header.
4. **Regression test.** A cold collab server (no writable connections) → export
   reads every body and the stored snapshot is byte-for-byte unchanged.

## Design

### Server (authoritative fix)

- New `server/collab-persistence.js` wraps the existing page persister with
  hydration state on the `Y.Doc`:
  - `pending` until the stored snapshot is downloaded/decrypted/applied,
  - `hydrated` when it was applied or confirmed absent (404),
  - `failed` when it could not be read.
- `writeState` refuses to persist unless state is `hydrated` **and** the room
  has seen a writable connection. A failed hydration therefore leaves the
  stored snapshot untouched instead of replacing it with an empty doc.
- `openHydratedDoc()` is awaited in the WebSocket upgrade path **before**
  `setupWSConnection` runs, so the room cannot send sync step 1 until hydration
  completed. This is the "hydrated signal" the verdict asked for, enforced
  server-side for every client.
- Export reads connect with `readOnly=1`. Read-only connections may receive
  sync/awareness traffic but their update frames are rejected, and they never
  mark the room writable, so closing them cannot trigger a save.
- Load shedding now compares `heapUsed` against the V8 heap **limit**
  (`heap_size_limit`), not `heapTotal` on a small idle heap (F3).

### Client (honest read classification)

- `createClientPageDocSource` opens the remote room read-only and returns
  `{ doc, status }` where `status` is `ok`, `empty`, or `unavailable`.
- `loadVaultPageDocs` keeps title-only notes for genuinely empty pages, but when
  a Page has `hasStoredContent` metadata (from `pages.searchable_text`) an empty
  read becomes a `content-unverified` warning; the note is still written so the
  export does not abort.
- `toVaultPage` carries `searchable_text` into `VaultPage.hasStoredContent`.
- The shared FidelityReport card shows "Export finished with issues" (warning
  icon) instead of "Export complete" when any warning is present.

## Non-goals

- Server-side export endpoint (still forbidden by story 13).
- Recovering snapshots already truncated before this fix (out of scope; a
  separate data-recovery task if needed).
- Changing the 2 s / 10 s snapshot debounce windows.

## Test plan

- `tests/unit/sync-collab-persistence.test.ts` — hydration gating matrix.
- `tests/unit/vault-export-cold-room.test.ts` — cold collab server integration:
  read-only export returns real bodies and leaves the stored snapshot intact;
  a writable room still saves.
- `tests/unit/vault-export-loader.test.ts` — empty-with-evidence warning vs a
  genuinely empty Page.
- `tests/unit/vault-export-source.test.ts` — read-only params and status
  classification.
- `tests/unit/sync-server-health-metrics.test.ts` — heap pressure uses the V8
  limit (idle small heap is not "shedding").
