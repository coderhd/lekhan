### 🔍 Clean-Room Review Summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | PASS | Both facades (`lib/markdown-io.ts`, `lib/yjs-seed.ts`) are deleted and zero `@/lib/markdown-io` / `@/lib/yjs-seed` imports remain in `lib/ services/ components/ app/ tests/` (grep exit 1; `tsc` covers `**/*.ts(x)` incl. tests and is clean). No new wrapper module was introduced — `lib/markdown/` contains only `engine.ts`. ADR 0005's "sole seam + no re-wrap" invariant holds. |
| 2. Frontend & a11y | PASS | Diff touches no UI/JSX/route. Only UI-adjacent change is a one-line comment at `lib/editor-extensions.ts:35` (`markdown-io.ts` → `markdown/engine.ts`). No a11y or rendering surface affected. |
| 3. CRDT & Storage | PASS | `lib/markdown/engine.ts` is byte-unchanged by this branch (not in `--stat`), so `seedToYjsBase64` / `plainText` / `uint8ArrayToBase64` are identical. The Obsidian importer's seeding swap is a pure receiver rename: `contentToYjsBase64(fitted)`→`markdownEngine.seedToYjsBase64(fitted)`, `contentToPlainText(fitted)`→`markdownEngine.plainText(fitted)`, same argument/order. No data-integrity risk. |
| 4. Backend & Security | PASS | Error seams unchanged: `services/import.ts` still throws on empty file (L36-38), parses frontmatter/body before `createPage` (L40, L51, L53); `services/obsidian-import.ts` still throws on no-markdown (L470) and over-limit (L473). Only the call form changed. |

---

### Actionable Findings

None — no blocking findings.

Non-blocking observations (nits only, not defects):

#### 🔍 [LOW]: `callout.test.ts` places `import` statements after the `beforeEach`/`afterEach` block
- **File**: `tests/unit/callout.test.ts:1-13`
- **Issue**: The new `beforeEach`/`afterEach` hooks are inserted before the remaining `import { buildStandaloneHtml } …` lines. ES imports hoist so this is functionally correct, but it reads oddly and is inconsistent with the other migrated suites (which put imports first).
- **Recommended Fix** (optional):
```diff
-import { describe, it, expect, beforeEach, afterEach } from 'vitest'
-import { MarkdownEngine } from '@/lib/markdown/engine'
-
-let engine: MarkdownEngine
-
-beforeEach(() => {
-	engine = new MarkdownEngine()
-})
-
-afterEach(() => {
-	engine.destroy()
-})
-import { buildStandaloneHtml } from '@/lib/markdown-export'
+import { describe, it, expect, beforeEach, afterEach } from 'vitest'
+import { MarkdownEngine } from '@/lib/markdown/engine'
+import { buildStandaloneHtml } from '@/lib/markdown-export'
+// …other imports…
+
+let engine: MarkdownEngine
+beforeEach(() => { engine = new MarkdownEngine() })
+afterEach(() => engine.destroy())
```

#### 🔍 [LOW]: Tracked session transcript at repo root still greps as a facade reference
- **File**: `session-ses_fb82.md` (repo root)
- **Issue**: A committed OpenCode session transcript (pre-existing on `origin/main`, **not** added by this branch) contains many literal `@/lib/markdown-io` / `@/lib/yjs-seed` strings, so a naive repo-wide grep for the retired names is noisy. It is not an import and does not affect the build. ADR 0005 explicitly grandfathers historical documents.
- **Recommended Fix**: Out of scope for this PR — consider gitignoring/removing session transcripts separately. No action required here.

---

### Verification Evidence (independently reproduced)

- **Facade import grep**: `grep -rn "…" lib services components app tests` → exit 1 (no matches). `git grep markdown-io|yjs-seed` finds only `docs/`, the pre-existing `session-ses_fb82.md`, and `(migrated: markdown-io)`/`(migrated: yjs-seed)` describe labels in the new test file. No dynamic `import()`, no re-export.
- **Deletion**: `lib/markdown-io.ts` and `lib/yjs-seed.ts` both absent; `lib/markdown/` contains only `engine.ts`.
- **Engine unchanged**: `git diff origin/main...HEAD --stat -- lib/markdown/engine.ts` → empty. All facade delegations therefore target identical method bodies.
- **Call-site equivalence** (arguments / receiver / order):
  - `lib/import-hydration.ts:20` `markdownEngine.parse(initialContent)` ≡ old `parseMarkdown(initialContent)`.
  - `lib/markdown-export.ts:168` `markdownEngine.assembleMarkdownFile(meta, body)` ≡ old.
  - `services/import.ts:40,51` `markdownEngine.parseFrontmatter/parse` ≡ old.
  - `services/obsidian-import.ts:437,447,457,464,465` `seedToYjsBase64(EMPTY_PAGE_DOC)` / `parseFrontmatter(raw)` / `parse(processedBody)` / `seedToYjsBase64(fitted)` / `plainText(fitted)` ≡ old.
- **Assertion preservation** (mechanical): normalized facade calls to engine calls and compared `expect(...)` lines — markdown-io **57/57 identical**, yjs-seed **14/14 identical** (the only two apparent diffs were my regex double-prefixing `engine.`). Test titles: markdown-io **34/34**, yjs-seed **7/7**, none missing. Total migrated **41**; `markdown-engine.test.ts` = 9 pre-existing + 41 = **50** tests. The 9 pre-existing tests at lines 1-158 are unchanged except added imports (diff shows pure append).
- **Per-test instances**: `tests/unit/markdown-engine.test.ts`, `callout.test.ts`, `markdown-export.test.ts` all use `let engine; beforeEach(new MarkdownEngine()); afterEach(destroy())`. No test references the `markdownEngine` singleton (only a comment at `markdown-engine.test.ts:162`). `obsidian-import.test.ts` imports only `base64ToUint8Array` (top-level fn) and exercises the production importer as before.
- **Gates** (run in worktree, real `node_modules`):
  - `npm run typecheck` → **exit 0**
  - `npm run lint` → **exit 0**
  - `npx vitest run` on the 7 named suites → **7 files / 133 tests passed (exit 0)** — markdown-engine 50, markdown-export 35, callout 19, obsidian-import 10, obsidian-import-errors 3, import-hydration 6, markdown-import 10.
- **Lint fix** (`scripts/paperclip/assign-execution-gates.mjs`): removed `const names = (issue.labelIds ?? []).map(…)` from `gatesFor` (line 83), where it was dead. The separate `names` in `score()` (line 67) and `labelName` (line 61) are still present and used, so behavior is unchanged and no other symbol became unused. Correctly committed as a separate commit (`d7227cc`).

### Overall Verdict

**PASS — approve.** This is a genuine behavior-preserving receiver rename of a
delegation-only facade. The engine is untouched, every migrated call site maps
1:1, all 41 facade assertions were carried over verbatim, and the gate suite is
green. No blocking findings.
