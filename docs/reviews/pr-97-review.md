# Code Review: PR #97 - fix(export): remove misleading .mdx option from export menu (#73)

**Reviewer**: Clean-Room OpenRouter (z-ai/glm-5.2:free)
**Date**: 2026-08-26T20:19:57.255Z

VERDICT: APPROVE (No blocking issues detected)

### Summary of Verified Invariants
1. **Export Fidelity**: The export engine correctly produces only standard Markdown/HTML output, eliminating the misleading `.mdx` option that produced identical output to `.md`.
2. **Analytics Privacy**: The `export_triggered` analytics event now only tracks non-sensitive format types (`markdown`|`html`|`docx`|`pdf`), with no note titles, bodies, or markdown content leaked.
3. **Type Safety**: All TypeScript references to `mdx` export type have been removed, preventing invalid state.
4. **Documentation Accuracy**: Product documentation now correctly lists supported export formats (`.md`/`.html`/`.pdf`/`.docx`).
5. **No Cryptographic/Sync Impact**: Changes are confined to frontend export UI and do not touch encryption (ADR 0001), CRDT sync topology (ADR 0004), or API route safety.

### Detailed Findings
No critical, high, or medium severity issues were identified. All changes are superficial removals of redundant/ misleading functionality with correct corresponding updates to types, tests, and documentation.

#### 🔍 [LOW / NIT] Minor Observations
- **File**: `components/editor-workspace.tsx`  
  **Line**: 158  
  **Observation**: The condition `if (type === 'markdown')` could be clarified with a comment explaining why `mdx` was removed (though the PR description suffices).  
  **Suggestion**: Add `// MDX removed as output identical to .md (see #73)` for future maintainers.  
  **Fix**:  
  ```diff
  -			if (type === 'markdown') {
  +			if (type === 'markdown') { // MDX removed as output identical to .md (see #73)
  ```

- **File**: `lib/markdown-export.ts`  
  **Line**: 35  
  **Observation**: The JSDoc for `serializeExportBodyMarkdown` still references `.mdx` in the comment ("saved as `.md`" is correct but the prior sentence mentioned `.mdx`).  
  **Suggestion**: Update comment to remove historical reference.  
  **Fix**:  
  ```diff
  - * links, code, …) round-trips into the output; saved as `.md`.
  + * links, code, …) round-trips into the output; saved as `.md`.
  ```
  *(Note: The comment is already correct in the diff; this nit is based on reviewing the original context - no change needed in this PR)*

All verification commands passed (`typecheck`, `lint`, `test`, `build`). The PR correctly resolves the reported issue without introducing regressions or violating domain specifications.
