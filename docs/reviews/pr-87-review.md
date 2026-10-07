# PR #87 review — idempotent bulk imports

**Branch:** `feat/87-idempotent-bulk-imports` · **PR:** #130 · **Diff:** `git diff origin/main...HEAD`
**Reviewer:** independent clean-room adversarial subagent (did not author the change), run across two passes.
**Verification (worktree):** `npm run typecheck` clean · `npm run lint` clean · `npm test` → 79 files / **603 tests** passed · `npm run build` succeeded. Live-Postgres migration/RLS was not executable from this worktree.

## Verdict

**APPROVE** — after one blocking finding was found and fixed. Earlier passes found and fixed two blockers
(partial-batch reclaim duplication; world-callable `cleanup_import_batches`). The second pass found a third,
end-to-end blocker that the mocked tests could not see:

> **BLOCKER (fixed):** `vaultFingerprint` summed `contentYjsBase64.length`. Seeding a `Y.Doc` embeds a fresh
> random `clientID`, so the encoded byte length varies between two ingestions of the *same* vault. On "Try
> again" the dialog recomputed the fingerprint, saw it change, and minted a **new `clientImportId`** — the
> server then treated every batch as new and re-created all already-landed pages. Reproduced with a real
> ingestion probe against this worktree: `ws-1:6:1434:…` vs `ws-1:6:1426:…` (about 24 % mismatch for a
> 2-page vault; higher for larger vaults). The mocked dialog test passed because it returned the same IR
> object every call.

**Fix:** `vaultFingerprint` now hashes only deterministic content — sorted `path` values and sorted
`path\0plainText` — and never the Yjs bytes. `splitIntoBatches` also gained a `plainText`-hash tie-break so
the deterministic order is total. Regression tests now exercise real double ingestion
(`tests/unit/obsidian-import.test.ts`), Yjs-length independence (`tests/unit/vault-import.test.ts`), and a
dialog retry that re-ingests with different Yjs bytes (`tests/unit/import-dialog.test.tsx`).

## Findings and resolution

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKER | `cleanup_import_batches` `SECURITY DEFINER` reachable via PostgREST rpc (default `PUBLIC` EXECUTE) — an authenticated caller could wipe every tenant's ledger. | `REVOKE EXECUTE … FROM PUBLIC` / `FROM anon, authenticated`; `GRANT … TO service_role` (`supabase/migrations/20261007000001_import_batches_ledger.sql`), mirroring `20260814000000_sync_page_graph.sql:62-64`. |
| BLOCKER | A reclaimed batch re-runs leaf inserts → duplicate pages (partial chunk / checkpoint failure / crash-after-landing). | Deterministic ids `deriveBatchPageId(workspace, clientImportId, batchIndex, ordinal)` (UUID v5) + `upsert(…, { onConflict: 'id', ignoreDuplicates: true })` (`lib/import-ledger.ts`, `app/api/import/route.ts`). |
| BLOCKER | **Unstable fingerprint → new `clientImportId` on retry → duplicates (see verdict).** | `vaultFingerprint` is now content-based and Yjs-independent; verified by real double-ingestion test. |
| MAJOR | Order-blind fingerprint + positional `batchIndex`: enumeration reorder maps a batchIndex to different pages; the server replays the recorded set and drops the new pages. | `splitIntoBatches` sorts deterministically (path, then content hash) so `batchIndex` ↔ page set is stable. |
| MINOR | No client retry on `409 batch_in_progress` (contradicts spec D2). | Bounded backoff (`MAX_BATCH_ATTEMPTS = 4`, 400 ms × attempt). |
| MINOR | `cleanup_import_batches` pruned only `completed`. | Prunes any stale row. |
| MINOR | Report headline double-counted resumed pages. | Resumed line reworded to be non-additive. |
| MINOR | `failImportBatch` could downgrade a `completed` row in the stale-reclaim race; reclaim `UPDATE` errors read as "no match". | `.eq('status','processing')` guard; reclaim errors now propagate (`2d23aef`). |
| NIT | `key={i}` on warnings; progress not announced; `completeImportBatch` unguarded. | Stable keys; `role="status" aria-live="polite"`; `.eq('status','processing')` + require a returned row. |

## Acceptance criteria

- **AC1 zero duplicate pages on retry — PASS.** Completed batches replay with no writes; reclaimed
  failed/stale batches re-run but every leaf re-derives the *same* id and `ON CONFLICT (id) DO NOTHING`
  keeps them unique. The attempt-session id is now stable across retries (fingerprint fix), which is what
  makes the ledger actually resume.
- **AC2 honest partial progress — PASS.** `resumed: true` + recorded report; client aggregates
  `resumedCount`; the card shows the resumed line. Caveat: pages re-upserted by a *reclaimed* batch are
  reported as created, not resumed (only truly replayed completed batches increment `resumedCount`).
- **AC3 ledger cleanup/retention — PASS.** Rows cascade with workspace; `cleanup_import_batches(retain_days
  DEFAULT 30)` prunes aged rows of any status and is service-role only. The pruner is not yet scheduled
  (ops/cron follow-up).

## Residual risks

- **Pruner unscheduled** — ledger grows until an ops/cron job calls `cleanup_import_batches`.
- **Stale-window double-run** — a batch running >10 min can be reclaimed while live; deterministic ids keep
  pages unique, but ledger state can be clobbered (guarded now) and work is duplicated.
- **Live-DB verification** — grants/RLS and `ON CONFLICT` behaviour reasoned from Postgres defaults + repo
  precedent, not executed against a live DB here; confirm on staging before ship.
- **Legacy callers** — omitting the `clientImportId`/`batchIndex` pair keeps the non-idempotent path (spec
  D6); the Notion importer (#78) must send the pair.
