# PR #134 bot-review findings → regression fixture parity map

Retro action from [SIL-105](/SIL/issues/SIL-105) (2026-10-27 weekly retro), rule 3 of
`docs/decisions/process/01-weekly-retro-hygiene-rules.md`. Each review-bot finding on
PR #134 (clipboard paste-in, [SIL-80](/SIL/issues/SIL-80)) is mapped to a **named,
green fixture** in the unit suite. Every one of the 8 retro-counted findings
(6 CodeRabbit + 2 pullfrog) plus the 2 pullfrog incremental deltas is locked by a
test that fails if the fix regresses.

Statuses verified 2026-10-27: `npx vitest run tests/unit/clipboard-paste.test.ts
tests/unit/clipboard-paste-editor.test.tsx` → 33/33 passed.

## CodeRabbit (6 findings)

| # | Finding (site) | Defect class | Fixture (named) |
|---|---|---|---|
| CR-1 | `editor-workspace.tsx` ~601 — deferred `applyPaste` replaces edits typed while the properties RPC is in flight | content loss (replace) | `clipboard-paste-editor.test.tsx` › `does not clobber edits typed while the properties RPC is in flight` |
| CR-2 | `lib/notion-clipboard.ts:5` — `NOTION_URL_RE` matched `notion.so/` anywhere in an `href` | misclassification | `clipboard-paste.test.ts` › `treats a URL whose path looks like Notion as an external link, not Notion content` |
| CR-3 | `lib/notion-clipboard.ts:60` — external `href` containing a space split the link destination | data corruption (markdown) | `clipboard-paste.test.ts` › `wraps an external href containing a space so it stays one link destination` |
| CR-4 | `lib/notion-clipboard.ts:70` — `data-type="date"` mention span became an internal `[[…]]` link | semantics corruption | `clipboard-paste.test.ts` › `keeps explicitly non-page mentions as plain text but still converts page mentions` |
| CR-5 | `lib/notion-clipboard.ts:139` — code containing ``` closed the generated fence early | content corruption | `clipboard-paste.test.ts` › `emits a fence longer than the longest backtick run in a code block` + `parses a code block containing a three-backtick line as a single code block` |
| CR-6 | `lib/notion-clipboard.ts:223` — container branch visited only element children, dropping direct text nodes | **content loss (silent drop)** | `clipboard-paste.test.ts` › `preserves direct text nodes beside converting children in a wrapper` |

## Pullfrog (2 findings in the first review)

| # | Finding (site) | Defect class | Fixture (named) |
|---|---|---|---|
| PF-1 | `editor-workspace.tsx:592` — frontmatter-only note (empty body) skipped `updatePageProperties`; raw YAML reached the document | **content correctness at boundary** | `clipboard-paste-editor.test.tsx` › `applies frontmatter properties and never pastes raw YAML for a frontmatter-only note` |
| PF-2 | `lib/notion-clipboard.ts:178` — wrapper traversal dropped direct text (same class as CR-6) | **content loss (silent drop)** | `clipboard-paste.test.ts` › `preserves direct text nodes beside converting children in a wrapper` (shared with CR-6) |

## Pullfrog incremental deltas (rounds 3–4)

| # | Finding (site) | Defect class | Fixture (named) |
|---|---|---|---|
| PF-3 | `editor-workspace.tsx:606` — body insert raced the 2s idle debounce, so graph indexing could still miss pasted tags | async ordering | `clipboard-paste-editor.test.tsx` › `waits for the properties RPC before inserting the body so the index reads them` |
| PF-4a | `editor-workspace.tsx:608` — editor destroyed + recreated by `useEditor` mid-RPC silently dropped the deferred body | **content loss (silent drop)** | `clipboard-paste-editor.test.tsx` › `keeps the deferred body when useEditor recreates the instance mid-flight` |
| PF-4b | `editor-workspace.tsx:608` — a page change while the RPC was pending redirected the body into another document | cross-document corruption | `clipboard-paste-editor.test.tsx` › `does not redirect a deferred paste into a different page` |

## Gap found and closed by this retro action

PF-4a/PF-4b (the round-4 fix, commit `e059101` on `feat/57-clipboard-paste-in`) had **not**
been merged to `main` at the time of the retro: `main`'s `applyBody` still bailed on
`currentEditor.isDestroyed` and had no page-change guard, so the content-loss class
was still live — with zero fixtures covering it. This retro action ports the fix and
its two fixtures to `main` and lands the DoD rule that keeps the next fixture class
from being bot-exclusive.

The two content-loss bugs the retro called out map to CR-6/PF-2 (dropped direct text)
and PF-4a (dropped deferred body).

## Pointers

- Source findings: PR #134 review threads (CodeRabbit 6 inline comments, pullfrog 1 initial + 2 incremental cyclic reviews).
- Process rule: `docs/decisions/process/01-weekly-retro-hygiene-rules.md` rule 3.
- DoD: `docs/agents/sdlc-workflow.md` §5.
