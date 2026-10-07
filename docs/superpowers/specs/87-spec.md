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

### D3 — Client id is stable across the *retry*, not regenerated per call
`crypto.randomUUID()` generated once per import attempt-session. The Import dialog holds the id in
a ref keyed by a **vault fingerprint** (`workspaceId + page count + total content bytes + hashed
sorted paths`). Re-picking the *same* vault after a failure reuses the id → server skips landed
batches (AC1). Picking a *different* vault yields a new id (no cross-vault false "resumed").
The ref clears on success, on dialog close, and when the fingerprint changes.

### D4 — Honest resume reporting
`/api/import` adds `resumed: boolean` to its response. The client aggregates `resumedCount`
across batches and the report card shows a "resumed — N pages already imported" line (AC2).
A resumed batch is not re-uploaded and not re-indexed — it is reported, not hidden.

### D5 — Retention
Ledger rows are retained for audit/resume (a completed-row delete would break idempotency on a
late replay) and pruned by `cleanup_import_batches(retain_days DEFAULT 30)`. Rows cascade with
their workspace (AC3: "retained briefly for audit").

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
| Concurrent duplicate of an in-flight batch | first wins, second 409 |
| Crashed request | `processing`; reclaimable after 10 min |
| Checkpoint write fails after pages landed | throw 500 + mark `failed` so a retry reclaims; documented residual risk (same-DB double failure) |
| Oversized page skipped client-side | unchanged (#27 behaviour) |

## Test requirements
1. Ledger unit: insert-claim, completed replay, failed reclaim, stale reclaim, in-progress.
2. Route: resumed path returns recorded result and performs no page insert; 409 path; claimed path
   records the checkpoint; validation 400s.
3. Client: sends `clientImportId` + `batchIndex` each batch; aggregates `resumedCount`; fingerprint
   stability/divergence; id generation shape.
4. Dialog: retry after failure reuses the same `clientImportId`.
