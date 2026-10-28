# Clean-Room Review — PR #157 / S4 vault export (SIL-60)

- **Branch:** `integration/60-vault-export` (S4 stack rebased onto `main` after S2/S3 landed)
- **Reviewer:** fresh-context Clean-Room Reviewer subagent (writer ≠ verifier)
- **Gate after fixes:** typecheck PASS · lint PASS · **92 files / 832 tests PASS** · build PASS

## Verdict

**APPROVE for QA dogfood after fixes.** Cycle 1 returned three blocking findings
around the export's honesty claims (resolved-link counting, folder link targets,
vanishing empty folders). All three are fixed with regression tests. Majors
were fixed where they were cheap and honest; the two structural ones
(pagination, worker offload) are deferred to named follow-ups below.

## Cycle 1 → disposition

| # | Severity | Finding | Disposition |
|---|---|---|---|
| B1 | BLOCKING | "Resolved links" counted titles while files were written as slugged/deduped basenames — `[[Q3 / 2026]]` was reported resolved but would not resolve in Obsidian. | **FIXED** — two-pass build maps each emitted note's real path; wikilinks are rewritten to `[[path\|Display]]` and only counted resolved when a note was actually emitted at that path. Tests: unsafe-title path, duplicate titles (first note wins). |
| B2 | BLOCKING | Folder pages seeded link targets but emit no note → false "resolved". | **FIXED** — only emitted notes enter the resolver map; folder links are reported unresolved. Test pins it. |
| B3 | BLOCKING | Folder pages emitted no file and the zip writer emitted no directory entries: empty folders vanished while the card claimed they were mirrored. | **FIXED** — explicit `dir/` entries are emitted for every folder and ancestor; `folderPages` counts materialized directories. Folder-only workspace test asserts a non-empty zip entry. |
| M1 | MAJOR | Remote (`https:`) images (e.g. expiring Notion S3 links) passed through unmentioned. | **FIXED as honesty** — they remain linked (cannot be bundled client-side without fetching an expiring URL) and are now named in the report as a `remote-images` omission. Test added. |
| M2 | MAJOR | `fetchWorkspacePages` has no pagination; PostgREST caps at 1000 rows, and orphaned children are silently hoisted to root. | **DEFERRED (follow-up)** — requires paginated graph reads + a container for pages whose parent was not loaded. Flagged on the PR; not a client-export regression. |
| M3 | MAJOR | One unserializable doc aborted the whole vault. | **FIXED** — per-page try/catch: the note is skipped, the page is named in the report warnings, the rest exports. |
| M4 | MAJOR | Vault build + `zipSync` run synchronously on the main thread. | **DEFERRED (follow-up)** — `lib/zip-write.ts` is worker-safe by design; moving the build into a Worker needs progress plumbing. Flagged on the PR. |
| M5 | MAJOR | Import omission counts rendered doubled (message already starts with the count); `report.warnings` was dead. | **FIXED** — import degradations map with `count: 0` (message keeps the count); export dialog now renders both loader and export warnings. |
| m1 | MINOR | Plain-object zip table: `__proto__` could bypass the duplicate guard. | **FIXED** — null-prototype table. |
| m2 | MINOR | 32-bit FNV attachment hashing collision risk. | **DEFERRED** — dedupe key is content-addressed; collision would reuse an image, not corrupt one. Follow-up. |
| m3 | MINOR | Failed tag read aborts the export. | **DEFERRED** — loader warning path already covers read failures; tag-query degradation is a follow-up. |
| m4 | MINOR | Nested notes use root-relative `attachments/…`; Obsidian relative-link mode resolves from the note folder. | **DEFERRED with M2** — path strategy should be decided with the nested-link test. |
| m5 | MINOR | a11y: focus not moved on done/error; progress text not `aria-live`; dashboard triggers title-only. | **DEFERRED** — dialog has real buttons, trap, Escape guard; polish follow-up. |
| m6 | MINOR | Object URL revoked synchronously. | **DEFERRED** — harmless for current sizes; revisit with worker offload. |
| m7 | MINOR | `[[Page#Heading]]` counted unresolved; wikilinks inside code fences counted. | **PARTIAL** — link rewriting and counting now skip fenced code; heading anchors in targets remain a follow-up. |

## What remains before merge

- QA Engineer drop-into-a-real-Obsidian dogfood (issue requirement).
- Follow-ups: paginated workspace reads (M2), worker offload (M4), nested
  attachment path strategy (m4), heading-anchor links (m7), a11y polish (m5).
