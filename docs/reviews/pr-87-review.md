# PR #87 review — idempotent bulk imports

**Branch:** `feat/87-idempotent-bulk-imports` · **PR:** #130 (**merged** at pre-fix tip `83fd28a`) · **follow-up fix:** #132 (`fix/87-stable-retry-fingerprint`)
**Diff:** `git diff origin/main...HEAD`
**Reviewer:** independent clean-room adversarial subagent (did not author the change), run across two passes; plus the external Pullfrog review on PR #132.
**Verification (worktree):** `npm run typecheck` clean · `npm run lint` clean · `npm test` → 80 files / **616 tests** passed · `npm run build` succeeded. Live-Postgres migration/RLS was not executable from this worktree.

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

The external Pullfrog review on #132 then found that this fix was still **incomplete**: hashing only
`path` + `plainText` meant a mark-only edit (e.g. `word` → `*word*`) or a metadata-only edit
(`properties`/`tags`) left the fingerprint unchanged, so the dialog reused the old `clientImportId` and the
server replayed the completed `(clientImportId, batchIndex)` from its ledger — **silently dropping the
edit**. Fixed by making the fingerprint cover all deterministic page state: each page now carries a
`contentHash` computed at ingestion from the fitted ProseMirror doc (`stableHash(canonicalJson(fitted))`,
capturing marks/structure/attributes), and the fingerprint also folds in canonical `properties`, `tags`,
and the folder/note role. `splitIntoBatches` tie-breaks on the same `contentHash`. `Yjs` bytes remain
excluded. See the findings table and `docs/superpowers/specs/87-spec.md` D3.

Pullfrog's re-review of that fix raised one further **incomplete-fingerprint** gap: `canonicalJson`
walked objects by enumerable keys, so a `Date` (which `gray-matter` produces from unquoted YAML
timestamps) collapsed to `{}`. Two different timestamps then hashed identically even though the request
serializes them as distinct ISO strings — the same stale-replay failure. `canonicalJson` now honours
`toJSON` (exactly as `JSON.stringify` does), so Date-valued metadata is fingerprinted by its serialized
value, and `undefined`-valued keys are omitted to match the request payload.

A follow-up re-review then caught that `canonicalJson` treated `Date` as an empty object, so a
YAML-timestamp property edit was still invisible to the fingerprint; fixed by honouring the `toJSON`
hook (Date → ISO string), matching the request's own serialization.

## Findings and resolution

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKER | `cleanup_import_batches` `SECURITY DEFINER` reachable via PostgREST rpc (default `PUBLIC` EXECUTE) — an authenticated caller could wipe every tenant's ledger. | `REVOKE EXECUTE … FROM PUBLIC` / `FROM anon, authenticated`; `GRANT … TO service_role` (`supabase/migrations/20261007000001_import_batches_ledger.sql`), mirroring `20260814000000_sync_page_graph.sql:62-64`. |
| BLOCKER | A reclaimed batch re-runs leaf inserts → duplicate pages (partial chunk / checkpoint failure / crash-after-landing). | Deterministic ids `deriveBatchPageId(workspace, clientImportId, batchIndex, ordinal)` (UUID v5) + `upsert(…, { onConflict: 'id', ignoreDuplicates: true })` (`lib/import-ledger.ts`, `app/api/import/route.ts`). |
| BLOCKER | **Unstable fingerprint → new `clientImportId` on retry → duplicates (see verdict).** | `vaultFingerprint` is now content-based and Yjs-independent; verified by real double-ingestion test. |
| BLOCKER | **Incomplete fingerprint → stale edit silently dropped (external Pullfrog review, #132).** `path`+`plainText` ignores marks/structure and `properties`/`tags`; a mark- or metadata-only edit left the fingerprint unchanged, so the dialog reused the id and the server replayed the old batch. | Each page gains `contentHash = stableHash(canonicalJson(fitted))` (marks/structure/attrs); `vaultFingerprint` also hashes canonical `properties`, `tags`, and folder/note role; batching tie-breaks on `contentHash` (`lib/stable-content.ts`, `services/obsidian-import.ts`, `services/vault-import.ts`). Tests: mark-only and metadata-only edits diverge despite identical `plainText`. |
| BLOCKER | **Date-valued metadata collapsed in the fingerprint (external Pullfrog re-review, #132).** `canonicalJson` walked objects by enumerable keys, so a `Date` from a YAML timestamp became `{}`; two different timestamps hashed the same while the request serialized distinct ISO strings → stale replay. | `canonicalJson` honours `toJSON` (mirroring `JSON.stringify`) and omits `undefined` keys; tests cover Date divergence and repeat-ingestion stability (`lib/stable-content.ts`, `tests/unit/stable-content.test.ts`, `tests/unit/vault-import.test.ts`). |
| BLOCKER | **`canonicalJson` collapsed `Date` to `{}` (external Pullfrog re-review, #132).** gray-matter parses unquoted YAML timestamps into `Date`; with no enumerable own keys a timestamp-only property edit produced an identical fingerprint, so the stale batch was replayed. | `canonicalJson` honours the `toJSON` hook (exactly as `JSON.stringify` does) so `Date` → ISO string, matching the bytes the request serializes; `undefined`-valued keys are dropped like `JSON.stringify`. Tests: `canonicalJson(date)` equals `JSON.stringify(date)`, distinct timestamps diverge, and an ingestion-level YAML-timestamp edit changes the fingerprint (`tests/unit/stable-content.test.ts`, `tests/unit/obsidian-import.test.ts`). |
| MAJOR | Order-blind fingerprint + positional `batchIndex`: enumeration reorder maps a batchIndex to different pages; the server replays the recorded set and drops the new pages. | `splitIntoBatches` sorts deterministically (path, then content hash) so `batchIndex` ↔ page set is stable. |
| MINOR | No client retry on `409 batch_in_progress` (contradicts spec D2). | Bounded backoff (`MAX_BATCH_ATTEMPTS = 4`, 400 ms × attempt). |
| MINOR | `cleanup_import_batches` pruned only `completed`. | Prunes any stale row. |
| MINOR | Report headline double-counted resumed pages. | Resumed line reworded to be non-additive. |
| MINOR | `failImportBatch` could downgrade a `completed` row in the stale-reclaim race; reclaim `UPDATE` errors read as "no match". | `.eq('status','processing')` guard; reclaim errors now propagate (`2d23aef`). |
| NIT | `key={i}` on warnings; progress not announced; `completeImportBatch` unguarded. | Stable keys; `role="status" aria-live="polite"`; `.eq('status','processing')` + require a returned row. |

## Acceptance criteria

- **AC1 zero duplicate pages on retry — PASS.** Completed batches replay with no writes; reclaimed
  failed/stale batches re-run but every leaf re-derives the *same* id and `ON CONFLICT (id) DO NOTHING`
  keeps them unique. The attempt-session id is now stable across retries (fingerprint fix) **and** any
  deterministic edit to page content or metadata changes the fingerprint, minting a fresh id so the edit
  is actually imported rather than silently replayed away. A *genuinely edited* vault is a different
  import (fresh id, full re-import) — that is the intended, honestly-reported behaviour.
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
- **Server replay trusts the client fingerprint** — the ledger replays a completed `(clientImportId,
  batchIndex)` without re-comparing the request payload. This is by design: the client owns vault content,
  and the (now complete) fingerprint is what guarantees a changed vault gets a fresh id. A defensive
  server-side payload hash in the ledger is deliberately out of scope for #87 and could be a follow-up.
