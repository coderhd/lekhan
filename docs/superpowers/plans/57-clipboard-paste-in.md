# Implementation Plan: SIL-57 — Clipboard paste-in

- **Spec:** [`docs/superpowers/specs/57-spec.md`](../specs/57-spec.md) · **Issue:** [SIL-57](/SIL/issues/SIL-57)
- **Branch:** `feat/57-clipboard-paste-in` · **Worktree:** `lekhan-worktrees/sil-57-clipboard-paste`
- **Lifecycle:** DEFINE ✅ → **PLAN** → BUILD → VERIFY → REVIEW → SHIP

## Interface contract (frozen before implementation)

```ts
// lib/markdown-paste.ts
export type ClipboardPasteKind =
  | 'obsidian-markdown' | 'notion-html' | 'markdown' | 'codeBlock' | 'default'
export function classifyClipboardPaste(plain?: string, html?: string): ClipboardPasteKind

// lib/obsidian-clipboard.ts
export interface ObsidianClipboard {
  properties: Record<string, unknown>
  tags: string[]
  body: string
}
export function splitObsidianFrontmatter(text: string): ObsidianClipboard
export function hasObsidianFrontmatter(text: string): boolean

// lib/notion-clipboard.ts
export function isNotionHtml(html?: string): boolean
export function notionHtmlToMarkdown(html: string): string
```

## Tasks (ordered by dependency)

### T1 — Retroactive resolution migration (seam 1)
- **Files:** `supabase/migrations/20261007000000_resolve_unresolved_page_links.sql`
- **Acceptance:** `normalize_page_title` + `resolve_unresolved_page_links` trigger creates;
  backfill resolves existing unresolved rows; scoped by `workspace_id`; `SECURITY DEFINER`.
- **Verify:** migration review + QA DB check (AC3). SQL not runnable in vitest.

### T2 — Obsidian frontmatter split (pure)
- **Files:** `lib/obsidian-clipboard.ts`, `tests/unit/clipboard-paste.test.ts`
- **Acceptance:** leading YAML → `{properties,tags,body}`; reserved keys excluded; string/array tags;
  no frontmatter → empty properties, body unchanged; a body `---` hr is not misread.
- **Verify:** `npm test -- clipboard-paste`.

### T3 — Clipboard classifier (extend, no regression)
- **Files:** `lib/markdown-paste.ts`, `tests/unit/clipboard-paste.test.ts`
- **Acceptance:** Notion HTML → `notion-html`; Obsidian markers → `obsidian-markdown`; existing
  markdown/codeBlock/default cases unchanged.
- **Verify:** new tests + existing `markdown-paste.test.ts` green.

### T4 — Notion HTML → markdown (pure DOM)
- **Files:** `lib/notion-clipboard.ts`, `tests/unit/clipboard-paste.test.ts`, fixtures
- **Acceptance:** headings/lists/tables/quotes/code/emphasis/links emit GFM; internal notion
  mention/URL → `[[Title]]`; external URL → `[text](url)`; empty/unparseable → `''` (caller falls back).
- **Verify:** fixture-driven tests.

### T5 — Recorded clipboard fixtures (seam 3)
- **Files:** `tests/fixtures/clipboard/obsidian-note.json`, `notion-page.json`
- **Acceptance:** each fixture holds `{ text/plain, text/html, expectations }`; committed to repo.
- **Verify:** fixtures consumed by T6.

### T6 — Paste routing in `handlePaste` + seam-3 integration tests
- **Files:** `components/editor-workspace.tsx`, `services/graph.ts` (add `updatePageProperties`),
  `tests/unit/clipboard-paste.test.ts`
- **Acceptance:** `handlePaste` routes `obsidian-markdown` (frontmatter→properties callback, body→parser)
  and `notion-html` (convert→parser, fallback to native HTML); code-block/default unchanged.
- **Verify:** integration tests build a Tiptap editor, feed fixtures, assert native nodes +
  resolved/unresolved/external states; existing paste suite green.

### T7 — Three link states test
- **Files:** `tests/unit/clipboard-paste.test.ts`
- **Acceptance:** resolved/unresolved `[[…]]` decorated; external URL stays a Link mark.
- **Verify:** decoration-class assertions.

### T8 — VERIFY + REVIEW
- `npm run typecheck && npm run lint && npm test && npm run build` green.
- QA Engineer reviews the fixture suite at seam (3); clean-room REVIEW gate on `git diff origin/main...HEAD`.

## Risk gates
- T1 is DB-only — cannot be unit-tested here; QA owns AC3 verification.
- T4 depends on Notion HTML shape; fallback preserves content if the shape shifts.
- T2/T3 must not change `decideMarkdownPaste`'s existing return contract.
