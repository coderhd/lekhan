# #87 H0 — Idempotent bulk imports — implementation plan

**Spec:** `docs/superpowers/specs/87-spec.md` · **Branch:** `feat/87-idempotent-bulk-imports`
**Stage:** BUILD → VERIFY → REVIEW

## Task breakdown (all landed)

| # | Task | Files | Tests |
|---|---|---|---|
| T1 | Ledger table + retention fn | `supabase/migrations/20261007000001_import_batches_ledger.sql` | migration applies/re-applies (ops) |
| T2 | Ledger module (atomic claim, replay, reclaim, complete, fail) | `lib/import-ledger.ts` | `tests/unit/import-ledger.test.ts` (7) |
| T3 | Route: validate id pair, claim before writes, replay/409, checkpoint + failure mark | `app/api/import/route.ts` | `tests/unit/api-import.test.ts` (+5) |
| T4 | Client: stable id, `batchIndex`, `resumedCount`, id/fingerprint helpers | `services/vault-import.ts` | `tests/unit/vault-import.test.ts` (+6) |
| T5 | Dialog: attempt-session ref keyed by vault fingerprint, resume across retry | `components/import-dialog.tsx` | `tests/unit/import-dialog.test.tsx` (+1) |
| T6 | Report card: honest "resumed" line | `components/import-report-card.tsx` | covered by T5 assertion |

## Verification (run in the worktree, 2026-10-07)
- `npm run typecheck` → clean.
- `npm run lint` → **1 pre-existing repo-wide error** at `scripts/paperclip/assign-execution-gates.mjs:84` (`names` unused), present on `main` and unrelated to this slice; all changed files lint clean (`npx eslint <changed>` → exit 0).
- `npm test` → 81 files / 593 tests passed.
- `npm run build` → compiled successfully, `/api/import` emitted as a dynamic route.

## Acceptance criteria mapping
- **AC1 zero duplicates on retry** — T2 claim/replay + T3 replay path + T5 stable id.
- **AC2 honest partial progress** — T4 `resumedCount` aggregation + T6 report line + `/api/import` `resumed` flag.
- **AC3 ledger cleanup** — T1 `cleanup_import_batches(retain_days DEFAULT 30)`; rows cascade with workspace.

## Residual risks / follow-ups
- Checkpoint write failing *after* pages land can still duplicate on the next retry (same-DB double failure). Documented in spec D-edge; the staleness window lets a crashed batch recover.
- `cleanup_import_batches` is not scheduled (ops/cron follow-up); retention is satisfied by "retained briefly for audit".
- `#78` Notion importer consumes this endpoint and will send the same id pair.
