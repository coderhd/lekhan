# SIL-230 / #144 — typing frame budget: before/after evidence

- **Issue:** [SIL-230](/SIL/issues/SIL-230) · coderhd/lekhan#144
- **Finding source:** `docs/qa/79-ux-parity-audit.md` §1 (AT RISK)
- **Branch:** `feat/sil-230-typing-frame-budget` (base `origin/main` @ `d9a2949`)
- **Date:** 2026-11-03
- **Scope:** perf hardening only — no UI redesign. #79 UX-parity gate applies.

## 1. Root cause

The audit measured **7,285 React renders over a 38-character burst** (~192 renders/char)
with 20 fps dips, and attributed the churn to the toolbar/dropdown scopes. The render storm
was real, but the trigger sat one layer below the toolbar:

1. `@tiptap/y-tiptap`'s `yCursorPlugin` rewrites the local awareness `cursor` field on
   **every ProseMirror view update**. While the editor is focused that is once per keystroke
   (`updateCursorInfo` compares the new anchor/head and calls
   `awareness.setLocalStateField('cursor', …)` whenever the selection moved).
2. `useEditorCollab`'s awareness `change` handler built a **fresh `activeUsers` array on every
   event** and called `setActiveUsers(users)` unconditionally — even though the presence list
   (who is here, name, colour) had not changed.
3. That state update re-rendered the whole `EditorWorkspace`: the ~1,760-line component owns
   the header, title, sync indicator, presence avatars, formatting toolbar, every Radix
   dropdown and the modals. One commit per keystroke × ~190 descendant fibers ≈ the audit's
   7,285 renders.

The toolbar was not the cause; it was the most visible victim.

## 2. Fix

| File | Change |
|---|---|
| `hooks/use-editor-collab.ts` | Publish a new `activeUsers` array only when the presence list actually differs (field-wise compare; keep the previous reference otherwise). Cursor-only awareness churn no longer re-renders the workspace at the source. |
| `components/editor-toolbar.tsx` (new) | Formatting toolbar extracted from `EditorWorkspace` and wrapped in `React.memo`; subscribes with `useEditorState` + a shallow equality selector, so parent-driven renders and non-formatting keystrokes cost zero toolbar renders. |
| `components/editor-workspace.tsx` | Renders `<EditorToolbar>`, passes a `useCallback`-stable link-prompt handler (an inline arrow would defeat the memo). |
| `components/ai-bubble-menu.tsx`, `components/code-block-language-select.tsx` | Do not publish a fresh `{top,left}`/`{top,right}` object on every transaction when the decoration did not move. |

## 3. Deterministic render budget (jsdom, real hook + real Tiptap + fake transports)

Instrumented with React `Profiler`, the real `useEditorCollab`, real `@tiptap/y-tiptap`
cursor plugin, fake WebSocket/IndexedDB providers, focused editor, 38 `insertContent`
transactions (mirrors a 38-character burst). The awareness counters prove the cursor
plugin actually fired per keystroke.

| | Workspace commits | Awareness writes | Awareness `change` events |
|---|---:|---:|---:|
| Before (`origin/main`) | **38** | 38 | 76 |
| After | **2** | 38 | 76 |

The two remaining commits are one-time: the first dirty-flag flip and the first presence
publish. They do not scale with characters. Guarded by
`tests/unit/editor-typing-renders.test.tsx`.

`tests/unit/editor-toolbar-renders.test.tsx` additionally proves the extracted toolbar makes
**0 commits** for a 38-character burst, **0 commits** for five unrelated parent re-renders, and
still re-renders when formatting actually changes (Bold toggled → active class updates).

## 4. Production-build browser measurement

- **Build:** `next build --webpack`, `next start` (production bundle, minified).
- **Chrome:** `agent-browser` + `open --enable react-devtools`, `react renders start/stop --json`
  (the same instrument as the audit; it records every React fiber commit from
  `onCommitFiberRoot`, plus frame cadence).
- **Workspace:** authenticated QA account, a real page seeded with a ~7,900-character document
  (120 × a 67-character sentence), so the editor is not measured empty.
- **Workload:** the same 39-character sentence typed as a fixed burst, repeated.
  Stress = 60 bursts (2,340 characters); human cadence = 120 characters typed one at a time
  with a ~60 ms gap (~6–8 chars/s effective).
- Baseline and fixed runs use the same browser profile, page size, seed and script; only the
  build differs.

### 60-burst stress run (2,340 characters)

| Metric | Baseline (`origin/main`) | Fixed | Delta |
|---|---:|---:|---:|
| React renders | **546,310** | **2,020** | **−99.63 %** (270×) |
| Renders / character | 233.5 | 0.86 | — |
| Recording wall time | 16.96 s | 11.95 s | −30 % |
| FPS avg / min | 60 / **9** | 60 / **20** | — |
| Sub-30 fps drops | 3 | 1 | — |

A second fixed 60-burst run measured 1,844 renders, min 7 fps, 2 drops — the isolated
single-frame outliers vary run to run; the render count does not. The fixed per-character
figure is an upper bound: roughly three quarters of the 2,020 renders are the page's
pre-existing periodic Radix/`Presence` churn (~9.5 renders/s, independent of typing), not
keystroke work.

### 20-burst stress run (780 characters) — closest to the audit's shape

| Metric | Baseline | Fixed |
|---|---:|---:|
| React renders | **181,993** | **1,410** |
| Renders / character | 233.3 | 1.81 |
| FPS avg / min | 59 / **4** | **60 / 60** |
| Sub-30 fps drops | **10** | **0** |

The fixed 20-burst run is the clean AC2 sample: **zero sub-30 fps frames**.

### Human-cadence run (120 characters, ~6–8 chars/s)

| Metric | Baseline | Fixed |
|---|---:|---:|
| React renders | **28,123** | **1,891** |
| Renders / character | 234.4 | 15.8 (mostly periodic, not keystroke) |
| FPS avg / min | 60 / 10 | 60 / 5 |
| Sub-30 fps drops | 9 | 2 |

At a human cadence the typing-specific work is gone; the residual renders are the page's
background `Presence`/dropdown activity that predates this ticket.

## 5. Honest limits

- **The 16 ms ideal is reachable for the React layer** at this document size: the fixed
  20-burst profile ran at 60 fps with no sub-30 fps frames. The React commit budget is no
  longer the bottleneck.
- **Isolated long frames still happen.** Longer stress runs occasionally show one or two
  single-frame drops (min 5–20 fps) in ~700 frames. They are not correlated with characters
  (the 20-burst run has none) and appear in both builds; they look like GC / profiler flush,
  not typing stutter. There is no sustained sub-30 fps segment.
- **The measurement itself has overhead.** `react renders` hooks every commit; typing is
  dispatched by CDP at ~200 chars/s in the stress run, far faster than a human.
- **Not measured here:** remote collaborators' cursors (single-user bench), very large
  documents (>100k chars), low-end hardware. #79's 10k-page workspace concerns page-open
  paths (#137/#139), not typing.

## 6. Verification

```
npm run typecheck   # exit 0
npm run lint        # exit 0
npm test            # full unit suite
npm run build       # next build (webpack) exit 0
```
