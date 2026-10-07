# PR review — #87 H0 Idempotent bulk imports (branch `feat/87-idempotent-bulk-imports`)

**Gate:** Stage 5 REVIEW (clean-room adversarial) · **Issue:** SIL-6 / coderhd/lekhan#87
**Diff reviewed:** `git diff origin/main...HEAD`
**Reviewer:** independent clean-room subagent (did not author the change), re-reviewed after remediation.

## Verdict

Initial pass: **REQUEST CHANGES** (2 blockers, 3 major, 3 minor, 3 nits).
After remediation: **APPROVE** — all blockers/majors resolved with tests; remaining items are documented residual risks.

## Findings and resolution

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKER | `cleanup_import_batches` is `SECURITY DEFINER` with default `PUBLIC` EXECUTE, reachable via PostgREST `rpc/` — an authenticated caller could wipe every tenant's ledger (`retain_days=0`), defeating idempotency and destroying audit rows. | Added `REVOKE EXECUTE … FROM PUBLIC` / `FROM anon, authenticated` and `GRANT … TO service_role`, mirroring `20260814000000_sync_page_graph.sql:62-64` (`supabase/migrations/20261007000001_import_batches_ledger.sql`). |
| BLOCKER | A batch whose leaf inserts land in multiple `INSERT_CHUNK_SIZE` statements (2000 pages → up to 4 statements) could partially land, be marked `failed`, and be fully re-inserted on reclaim → duplicate pages. | Leaf creation on the idempotent path now uses **deterministic page ids** (`deriveBatchPageId(workspace, clientImportId, batchIndex, ordinal)`, RFC 4122 v5) and inserts with `upsert(..., { onConflict: 'id', ignoreDuplicates: true })`. A retry re-derives the same ids and inserts only the missing rows (`lib/import-ledger.ts`, `app/api/import/route.ts`). |
| MAJOR | `vaultFingerprint` is order-independent but `batchIndex` is positional; if directory enumeration reorders between attempts, the server replays the recorded batch and silently drops the newly-positioned pages (duplicates + data loss). | `splitIntoBatches` now sorts pages deterministically (`folderPath` + title) before splitting, so `batchIndex` ↔ page-set is stable across retries (`services/vault-import.ts`). |
| MAJOR | Checkpoint write failing *after* pages landed marks the batch `failed`; the retry re-inserts → duplicates. | Deterministic ids make the reclaim idempotent: the re-run upserts the same ids (no new pages). |
| MAJOR | A crash after leaf insert but before checkpoint leaves `processing`; after the 10-min stale window the reclaim re-inserts → duplicates. | Same fix: reclaim is idempotent by construction. |
| MINOR | Client threw immediately on `409 batch_in_progress`, contradicting spec D2 ("client retries"). | `importVaultIR` now retries 409 with bounded backoff (`MAX_BATCH_ATTEMPTS = 4`, 400 ms × attempt). |
| MINOR | `cleanup_import_batches` only pruned `completed`; `failed`/`processing` rows grew unbounded. | The function now prunes any row older than `retain_days`. Scheduling remains an ops/cron follow-up (see residual risks). |
| MINOR | Report headline (`report.pages created`) double-counted resumed pages shown in the "resumed" line. | Resumed line reworded to "N of these pages were already imported …" so it is not additive to the headline (`components/import-report-card.tsx`). |
| MINOR | No tests covered partial-landing reclaim, the completion guard, cleanup grants, or batch/content mismatch. | Added: `deriveBatchPageId` determinism/version/distinctness + "does not complete a non-processing batch" (`import-ledger.test.ts`); deterministic-id upsert assertion (`api-import.test.ts`); batch-order stability + 409 retry (`vault-import.test.ts`). Live-DB migration/RLS tests remain out of scope for the unit suite. |
| NIT | `key={i}` on warning list rows. | Stable key `${title}:${stage}:${i}`. |
| NIT | Busy/progress block not announced to screen readers. | Added `role="status" aria-live="polite"`. |
| NIT | `completeImportBatch` updated by id with no status guard. | Added `.eq('status', 'processing')` + require a returned row; a late writer cannot overwrite a completed report. |

## Acceptance criteria

- **AC1 zero duplicate pages on retry** — deterministic ids + replay-safe upsert; failed/stale batches are reclaimed but re-insert only the missing rows. PASS.
- **AC2 honest partial progress** — `/api/import` returns `resumed: true` with the recorded report; the client aggregates `resumedCount`; the report card shows the resumed line. PASS.
- **AC3 ledger cleanup / brief retention** — completed (and now failed/stale) rows pruned by `cleanup_import_batches(retain_days DEFAULT 30)`; rows cascade with the workspace; function is service-role only. PASS (scheduling is an ops follow-up).

## Residual risks (accepted / followed up)

- `cleanup_import_batches` is not wired to a schedule yet (spec: "retained briefly for audit"); an ops/cron follow-up should call it.
- No live-Postgres test of the migration/RLS/grants in the unit suite; verified against repo convention + Postgres defaults. Confirm on staging.
- The derived id is scoped to `(workspace, clientImportId, batchIndex, ordinal)`. A client that reuses one `clientImportId` for *different content* would have the server replay the recorded batch; the dialog keys the id to the vault fingerprint to prevent this.
