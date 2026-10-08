# #87 H0 — Idempotent bulk imports — implementation plan

**Spec:** `docs/superpowers/specs/87-spec.md` · **Branch:** `feat/87-idempotent-bulk-imports`
**Stage:** BUILD → VERIFY → REVIEW

## Task breakdown (all landed)

| # | Task | Files | Tests |
|---|---|---|---|
| T1 | Ledger table + retention fn (service-role only) | `supabase/migrations/20261007000001_import_batches_ledger.sql` | migration applies/re-applies (ops) |
| T2 | Ledger module (atomic claim, replay, reclaim, complete, fail, deterministic ids) | `lib/import-ledger.ts` | `tests/unit/import-ledger.test.ts` (11) |
| T3 | Route: validate id pair, claim before writes, replay/409, replay-safe upsert, checkpoint + failure mark | `app/api/import/route.ts` | `tests/unit/api-import.test.ts` (+6) |
| T4 | Client: stable id, `batchIndex`, deterministic batch order, 409 backoff, `resumedCount`, id/fingerprint helpers | `services/vault-import.ts` | `tests/unit/vault-import.test.ts` (+8) |
| T5 | Dialog: attempt-session ref keyed by vault fingerprint, resume across retry | `components/import-dialog.tsx` | `tests/unit/import-dialog.test.tsx` (+1) |
| T6 | Report card: honest "resumed" line (non-additive) | `components/import-report-card.tsx` | covered by T5 assertion |

## Review remediation (2026-10-07, Stage 5)

A clean-room adversarial review of `git diff origin/main...HEAD` returned REQUEST CHANGES; all
blockers/majors were fixed and re-verified (`docs/reviews/pr-87-review.md`):

- **Security:** `cleanup_import_batches` is now service-role only (`REVOKE … FROM PUBLIC/anon,
  authenticated; GRANT … TO service_role`) and prunes stale rows of any status.
- **AC1 hardening:** idempotent leaf inserts use deterministic ids
  (`deriveBatchPageId(workspace, clientImportId, batchIndex, ordinal)`) + `ON CONFLICT (id) DO
  NOTHING`, so a reclaimed batch (partial chunk, checkpoint failure, or crash-after-landing)
  re-runs without duplicating pages.
- **Stable batch identity + retry id:** `splitIntoBatches` sorts pages by their full deterministic
  identity (path, folder/note role, canonical properties/tags, fitted-content hash, plain text) so
  positional `batchIndex` maps to the same page set across retries; `vaultFingerprint` hashes that
  same identity and **never** the Yjs bytes, so a retry keeps the same `clientImportId` and the
  ledger actually resumes. `seedToYjsBase64` derives the seed clientID from the content, making the
  encoded bytes (which batching measures) deterministic across ingestions and so keeping batch
  boundaries stable; `canonicalJson` honours `toJSON` so `Date` frontmatter is not collapsed.
- **Client:** bounded 409 `batch_in_progress` backoff per spec D2.
- **A11y/UX:** progress block `role="status" aria-live="polite"`; warning keys stabilized;
  resumed line no longer double-counts the headline.

## Verification (run in the worktree, 2026-10-07, post-review)
- `npm run typecheck` → clean.
- `npm run lint` → clean (`eslint .`, exit 0).
- `npm test` → **80 files / 617 tests passed**.
- `npm run build` → compiled successfully, `/api/import` emitted as a dynamic route.

## Acceptance criteria mapping
- **AC1 zero duplicates on retry** — T2 claim/replay + T3 replay path + T5 stable id.
- **AC2 honest partial progress** — T4 `resumedCount` aggregation + T6 report line + `/api/import` `resumed` flag.
- **AC3 ledger cleanup** — T1 `cleanup_import_batches(retain_days DEFAULT 30)`; rows cascade with workspace.

## Residual risks / follow-ups
- Reclaim re-runs are idempotent via deterministic ids (D7); a checkpoint failure after landing no
  longer duplicates pages. Residual: a client that reuses one `clientImportId` for genuinely
  different content would be replayed from the recorded batch — prevented in the dialog by keying
  the id to the vault fingerprint.
- `cleanup_import_batches` is not scheduled (ops/cron follow-up); retention is satisfied by
  "retained briefly for audit". It is service-role only and prunes stale rows of any status.
- Live-Postgres migration/RLS/grant verification is out of scope for the unit suite; the migration
  mirrors the `sync_page_graph` grant convention and should be confirmed on staging.
- `#78` Notion importer consumes this endpoint and will send the same id pair.
