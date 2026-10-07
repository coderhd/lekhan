# #87 H0 — Idempotent bulk imports (stable import id + server-side batch dedupe)

**Status:** spec (Stage 1 — DEFINE)
**Issue:** coderhd/lekhan#87 · SIL-6 · pulled forward to Wave 1 (gate for #78 Notion, SIL-58)
**Owner:** Dev Engineer · QA verification as usual
**Scope lock:** stable import id + server-side dedupe + resumable batch checkpoints. No re-scope.

## Problem (restated)

`POST /api/import` is multi-batch for large vaults (client budget `BATCH_BYTE_BUDGET` = 48 MB,
server ceiling 64 MB). Each batch's leaf insert is one atomic Postgres statement, and folder
chains are reused server-side — so hierarchy never duplicates. **Leaf pages do.** If batch 1
succeeds and batch 2 fails, a full retry re-creates every leaf from batch 1.

## Acceptance criteria (from issue)

- [ ] **AC1** Retrying an interrupted multi-batch import produces zero duplicate pages.
- [ ] **AC2** Partial progress is reported honestly ("resumed — N of M pages were already imported").
- [ ] **AC3** Ledger cleaned up on successful completion, or retained briefly for audit.

## Design decisions

### D1 — Batch ledger, keyed by `(workspace_id, client_import_id, batch_index)`
New table `public.import_batches` records each batch exactly once. The unique key is the
idempotency key. A retry of a landed batch returns the *recorded* result instead of re-writing.
This is the "dedicated `imports` ledger table" option from the issue sketch.

Why the ledger over stamping `pages.properties`: one row per batch (not per page), no per-page
schema churn, and it carries the recorded report (pages + warnings) needed for AC2. It also keeps
the folder-reuse path untouched.

### D2 — Claim is an atomic insert, never SELECT-then-INSERT
The route inserts the ledger row first (default `status='processing'`). On unique violation
(`23505`) the batch already exists; we then read its status:
- `completed` → replay the recorded result, `resumed: true` (AC1 + AC2).
- `failed` → atomically reclaim (`UPDATE … WHERE status='failed'`) and re-run (AC1: the failed
  batch is the one that may be incomplete; completed earlier batches are untouched).
- `processing` → a concurrent/live request owns it → `409 batch_in_progress` (client retries).

A crashed request leaves `processing`. A later retry may reclaim it only after a staleness
window (`STALE_PROCESSING_MS` = 10 min), so we never double-run a live request.

A reclaim re-runs the batch from scratch, which is only safe because leaf creation is
idempotent by construction (D7).

### D7 — Replay-safe page identity (reclaim correctness)
A reclaimed batch re-runs its writes, so a re-run MUST NOT create duplicate pages even when the
previous attempt partially landed (a batch can insert leaves across several
`INSERT_CHUNK_SIZE` statements). On the idempotent path each leaf therefore gets a deterministic
id derived from `(workspace_id, clientImportId, batchIndex, ordinal)` (UUID v5,
`deriveBatchPageId`) and is inserted with `ON CONFLICT (id) DO NOTHING`. Snapshots re-upload with
`upsert: true` and graph indexing is idempotent per page, so a full re-run converges to the same
state. Re-runs are only safe because `batchIndex` maps to a stable page set: `splitIntoBatches`
sorts pages deterministically before splitting (see D3/edge table).

### D3 — Client id is stable across the *retry*, not regenerated per call
`crypto.randomUUID()` generated once per import attempt-session. The Import dialog holds the id in
a ref keyed by a **vault fingerprint** — `workspaceId + page count + hash(each page's path,
folder/note role, canonical properties, canonical tags, rich-text content hash, and plain text)`,
order-independent. Re-picking the *same* vault after a failure reuses the id → server skips landed
batches (AC1). Picking a *different* vault yields a new id (no cross-vault false "resumed"). The
ref clears on success, on dialog close, and when the fingerprint changes.

The fingerprint deliberately hashes deterministic content only, and must cover **all** deterministic
page state that affects the import — not just paths and plain text. `plainText` drops marks and node
structure, and page `properties`/`tags` are metadata the import writes, so a mark-only or metadata-only
edit would otherwise leave the fingerprint unchanged and let the server silently replay the stale
batch instead of applying the edit (external review finding on PR #132). Each page therefore carries a
`contentHash` computed at ingestion from the *fitted* ProseMirror doc (`stableHash(canonicalJson(fitted))`),
which captures marks, structure, and node attributes. It must **not** use the Yjs encoding: seeding a
`Y.Doc` embeds a fresh random `clientID`, so the encoded bytes (and their length) differ between two
ingestions of the same vault. Depending on that would change the fingerprint on retry, mint a new id,
and re-create every already-landed page — the exact failure this ticket exists to prevent.
`splitIntoBatches` sorts on the same deterministic key (path, then content hash) so positional
`batchIndex` maps to a stable page set across retries.

### D4 — Honest resume reporting
`/api/import` adds `resumed: boolean` to its response. The client aggregates `resumedCount`
across batches and the report card shows a "resumed — N pages already imported" line (AC2).
A resumed batch is not re-uploaded and not re-indexed — it is reported, not hidden.

### D5 — Retention
Ledger rows are retained for audit/resume (a completed-row delete would break idempotency on a
late replay) and pruned by `cleanup_import_batches(retain_days DEFAULT 30)`. The function is
`SECURITY DEFINER` and **service-role only** — `PUBLIC`, `anon` and `authenticated` are revoked
so no client can call it via the REST `rpc` and wipe the ledger — and it prunes stale rows of any
status so repeated failures cannot grow the table unbounded. Rows cascade with their workspace
(AC3: "retained briefly for audit").

### D6 — Backward compatibility
`clientImportId` + `batchIndex` are optional **as a pair**. Omitting both preserves the existing
single-shot behavior (and existing tests). Passing one without the other is `400`. This keeps the
endpoint safe for any caller not yet migrated.

## Out of scope
- Notion/API importer (#78/SIL-58) itself.
- Per-page dedupe within a single already-landed batch (the batch is the atomic unit, per issue).
- Multi-request concurrency beyond the claim guard.

## Edge cases interrogated
| Edge | Behaviour |
|---|---|
| Bad uuid / negative or non-int `batchIndex` | 400, no DB write |
| `clientImportId` without `batchIndex` (or vice versa) | 400 |
| Replay of a completed batch | 200 `resumed:true`, recorded pages/warnings, zero new pages |
| Concurrent duplicate of an in-flight batch | first wins, second 409 (`batch_in_progress`); client retries with bounded backoff |
| Crashed request | `processing`; reclaimable after 10 min, re-run is idempotent (D7) |
| Partial chunk of a >500-page batch lands, then the batch fails | reclaim re-run upserts the same deterministic ids; landed rows untouched, missing rows inserted → zero duplicates (D7) |
| Crash after pages land but before checkpoint | stale reclaim re-runs idempotently — no duplicates (D7) |
| Directory enumeration yields a different page order on retry | pages sorted deterministically before batching → same `batchIndex` maps to the same page set |
| Checkpoint write fails after pages landed | throw 500 + mark `failed`; the retry re-runs but re-inserts the same deterministic ids, so no duplicates |
| Oversized page skipped client-side | unchanged (#27 behaviour) |

## Test requirements
1. Ledger unit: insert-claim, completed replay, failed reclaim, stale reclaim, in-progress,
   completion guard, deterministic-id derivation.
2. Route: resumed path returns recorded result and performs no page insert; 409 path; claimed path
   records the checkpoint and uses deterministic ids with a duplicate-tolerant upsert; validation 400s.
3. Client: sends `clientImportId` + `batchIndex` each batch; aggregates `resumedCount`; fingerprint
   stability/divergence; id generation shape; stable batch ordering; 409 backoff retry.
4. Dialog: retry after failure reuses the same `clientImportId`.
