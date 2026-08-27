---
name: clean-room-review
description: "Dispatches an independent, adversarial review subagent evaluating git diff origin/main...HEAD across 4 axes (Spec, a11y, CRDT/Storage, Backend/Security) with structured actionable feedback."
---

# Clean-Room Code Review Skill

Dispatches an independent clean-room subagent (`Model: 'pro'`) to audit unmerged branch changes against `origin/main` before opening a PR.

## Objectives & Multi-Axis Audit

### Axis 1: Spec & Domain Compliance
- Does the code fulfill all acceptance criteria in the GitHub issue?
- Does it adhere to `CONTEXT.md` architecture boundaries?
- Does it comply with ADR 0001 (encryption-at-rest), ADR 0004 (CRDT sync topology), and `lib/tier-limits.ts` (single source of truth for retention and collaborator quotas)?

### Axis 2: Frontend & Accessibility (a11y)
- Are clickable elements using native `<button>` or semantic interactive tags (no unadorned `div` / `span` with `onClick`)?
- Are ARIA roles, labels, and keyboard listeners (`onKeyDown`, `tabIndex`) properly declared?
- Are `useEffect` hooks cleanly unmounting timers, event listeners, and async promises (`isMounted` guards)?
- Are user actions acknowledged with clear, non-destructive feedback (toasts, confirmation dialogs)?

### Axis 3: CRDT & Local Storage Integrity
- Does IndexedDB logic use atomic transactions (`readwrite` / `readonly`) when performing batch deletions or updates?
- Is binary snapshot and delta compression lossless and performant?
- Are non-destructive forward restore mechanics preserving prior operational history?

### Axis 4: Backend Security & Error Seams
- Are database errors propagated instead of blindly defaulting to permissive fallback values?
- Are storage deletions atomic, and is database state rolled back if storage writes fail?
- Are WebSocket admission boundaries strictly enforced based on active plan tiers?

## Output Schema Format

```markdown
### 🔍 Clean-Room Review Summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | [PASS / FAIL] | Brief note |
| 2. Frontend & a11y | [PASS / FAIL] | Brief note |
| 3. CRDT & Storage | [PASS / FAIL] | Brief note |
| 4. Backend & Security | [PASS / FAIL] | Brief note |

---

### Actionable Findings

#### 🚨 [CRITICAL] / ⚠️ [HIGH] / 💡 [MEDIUM] / 🔍 [LOW]: Title
- **File**: `path/to/file.ts:123-145`
- **Issue**: Explanation of failure scenario.
- **Recommended Fix**:
```diff
- old
+ new
```
```
