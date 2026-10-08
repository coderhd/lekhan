# SIL-64 / S4a — Workspace vault export: page-content loader + dashboard trigger

**Stage 1–2 (DEFINE + PLAN) spec** · Owner: Dev Engineer · Epic: SIL-9 (#78 H1 Dual-Dialect Interop Bridge) · Plan: §3-S4
**Branch:** `feat/64-vault-export-ui` (stacked on `feat/60-vault-export` @ 524e3f0, PR #128) · Parent: [SIL-60](/SIL/issues/SIL-60) (S4)

## 1. Problem

The pure S4 engine (`lib/markdown/vault-export.ts`, `lib/zip-write.ts`,
`lib/fidelity-report.ts`, `components/fidelity-report-card.tsx`) shipped in PR #128 but is not
reachable from the product: there is no way to get each Page's `doc` for a whole workspace, and no
dashboard affordance. Page bodies are not client-reachable in bulk (the `pages` table has no content
column; bodies live in encrypted snapshots only the sync server decrypts — S4 spec §5.5). Story 13
forbids a server export endpoint.

## 2. Scope

1. **Content source** — settle the §5.5 decision and implement it: local-first (`y-indexeddb`), gap
   sync over the collab server, bounded concurrency, per-Page timeout, progress. Recorded as
   **ADR 0006** (`docs/adr/0006-vault-export-content-source.md`).
2. **Yjs → Tiptap JSON** — `MarkdownEngine.yjsStateToJson` (inverse of `seedToYjsBase64`), on the
   engine per ADR 0005.
3. **Loader** — `lib/markdown/vault-export-loader.ts`: pure orchestration (`loadVaultPageDocs`,
   `toVaultPage`) with the read injected; `lib/markdown/vault-export-source.ts`: the browser glue.
4. **Dashboard trigger** — `components/vault-export-dialog.tsx` (confirm → progress → download →
   report), wired into `components/dashboard.tsx` next to Import.
5. **Symmetric report** — reuse `FidelityReportCard` (export direction), with direction-aware warning
   copy; `services/graph.fetchWorkspacePageTags` for frontmatter tags.
6. **Analytics + UX parity (#79)** — `export_vault_started/completed/failed` + the card's
   `export_report_viewed`; copy states "compatible, not synced".

## 3. Non-goals

- No server export endpoint (story 13). No live/continuous sync.
- Freshness: a locally cached Page reflects this device's last synced copy (ADR 0006 consequences).
- Non-image attachments, Canvas, Dataview execution: unchanged (S4 engine owns those omissions).

## 4. Acceptance criteria (from the issue)

- From the dashboard, exporting a nested multi-page workspace with images yields a zip that drops
  into a real Obsidian vault cleanly (folders mirror nesting, wikilinks resolve, callouts/frontmatter/
  tags native, images load). Proven by QA drop-into-Obsidian dogfood + the S4 unzip-and-assert suite.
- No dedicated server export roundtrip; the zip is assembled in the browser.
- Export report uses the same `FidelityReport` card/shape as import.

## 5. Design

- **Engine** `yjsStateToJson(state)` applies the update to a fresh `Y.Doc` and reads the `default`
  `Y.XmlFragment` via `yXmlFragmentToProseMirrorRootNode(fragment, liveSchema).toJSON()` — the exact
  inverse of `seedToYjsBase64`.
- **Loader** `loadVaultPageDocs(pages, { loadDoc, concurrency = 4, onProgress })` runs `loadDoc` over
  non-folder Pages with a bounded worker pool; a failed/empty Page yields a `content`-stage
  `FidelityWarning` and a title-only note (never aborts the export).
- **Source** `createClientPageDocSource({ token, wsUrl?, timeoutMs? })` returns the injected
  `loadDoc`: try `IndexeddbPersistence(pageId)` first (local-first, offline-capable), else a
  short-lived `WebsocketProvider` gap sync; convert with the engine seam.
- **Dialog** resolves the Supabase access token, bulk-fetches tags, maps `Page[]` → `VaultPage[]`
  (`toVaultPage`, `isFolder` from `properties.importFolder`), loads docs with a progress bar, builds
  the files, downloads `lekhan-vault.zip`, and renders the report.

## 6. Test plan (seams)

- `tests/unit/vault-export-loader.test.ts` (new): engine `yjsStateToJson` round-trip (heading/marks/
  callout+tags+wikilinks/lists+tables); loader fills docs in order, bounds concurrency, skips
  folders, warns-and-continues on throw/null, reports progress, handles an empty workspace;
  `toVaultPage` maps metadata + the `importFolder` rule.
- `tests/unit/event-instrumentation.test.tsx` (+): export direction renders `export-report` and emits
  `export_report_viewed`; import expectation updated for the card's `omissions` field.
- Existing S4 `tests/unit/vault-export.test.ts` / `fidelity-report.test.ts` stay green.
- Browser glue (`vault-export-source.ts`) and the dialog are covered by typecheck/build + QA dogfood.

## 7. Definition of Done

`npm run typecheck && npm run lint && npm test && npm run build` green; ADR 0006 recorded; QA owns the
drop-into-real-Obsidian dogfood before REVIEW; clean-room review artifact `docs/reviews/pr-64-review.md`.
