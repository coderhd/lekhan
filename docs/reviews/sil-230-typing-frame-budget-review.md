# Clean-Room Review — SIL-230 / #144: typing frame budget

- **Ticket:** SIL-230 · coderhd/lekhan#144
- **Branch:** `feat/sil-230-typing-frame-budget` @ `83e3e6b` (base `origin/main` @ `d9a2949`)
- **Reviewer:** Clean-Room Reviewer (adversarial subagent), 2026-11-03
- **Scope reviewed:** `git diff origin/main...HEAD` (9 files, +709/−111)
- **Verdict:** **CHANGES-REQUIRED**

The performance fix itself is sound and its central number reproduces exactly. Two things
block: the new regression test does not fit inside its own 15 s timeout on this machine (the
branch's `npm test` is red), and the doc claims the suite is green. One visible UX-parity
regression (Align Left permanently active) also needs a one-line fix.

## Findings

| # | Severity | Location | Evidence |
|---|---|---|---|
| F1 | **major** | `tests/unit/editor-typing-renders.test.tsx:168` | The guard test sets `}, 15000)` but takes **14.5–15.1 s** here. Full suite run: `FAIL tests/unit/editor-typing-renders.test.tsx > ... Error: Test timed out in 15000ms`. Two consecutive isolated reruns also timed out at 15 s; the first 3-file focused run passed at **14,798 ms**, and a `--testTimeout=60000` run passed at **14,576 ms**. ~0.4 s of headroom is not a budget. `npm test` is not green (AC4) and CI will flake. Raise the timeout (30–60 s) and/or cut mount cost. |
| F2 | minor | `components/editor-toolbar.tsx:84` | Align Left is now highlighted for every default paragraph. The old inline toolbar used `editor.isActive({ textAlign: 'left' })`, which is **false** on default content because Tiptap `TextAlign` has `defaultAlignment: null`; the new selector falls through to `'left'`. Probe on a fresh editor: `isActive({textAlign:'left'}) = false`, `getAttributes('paragraph').textAlign = undefined`, yet `button[title="Align Left"]` has `text-primary bg-primary/10`. Visible change in a "no UI redesign / #79 parity" ticket. Fix: return `''` when none of center/right/left is active, and type `align` as `'left' \| 'center' \| 'right' \| ''`. |
| F3 | minor | `tests/unit/editor-toolbar-renders.test.tsx:26,95` | The "unrelated parent state changes" test asserts only `wrapperRenders`, which counts renders of the test's **own** `memo` wrapper (`CountedToolbar`), never `toolbarCommits`. If `memo` were removed from `EditorToolbar`, the wrapper would still bail and the test would still pass; test 1 also cannot catch it because the harness parent does not re-render during typing. The production memo boundary is therefore untested. Assert `toolbarCommits` too, or render `EditorToolbar` under a deliberately re-rendering parent without the extra memo. |
| F4 | minor | `docs/qa/sil-230-typing-frame-budget.md:129-132` | Verification block states `npm run typecheck # exit 0`, `npm run lint # exit 0`, `npm test # full unit suite`, `npm run build # next build (webpack) exit 0` as if all green. Reality: `npm test` fails 3 billing-gateway tests (pre-existing — confirmed identical on a clean `origin/main` copy) **and** the new typing test times out. The block also reports `npm run build` as webpack while `package.json` `build` is plain `next build` (Turbopack by default in Next 16.3); the webpack flag was a local workaround. Disclose known-red tests and the exact command. |
| F5 | noticing | `docs/qa/...md:60-105` | Production numbers (546,310 → 2,020 renders; 181,993 → 1,410; FPS) are self-reported; no raw `react renders` / vitals artifact is committed, so they cannot be re-derived in review. The deterministic §3 numbers *can* be and do reproduce exactly (below). |
| F6 | noticing | `docs/qa/...md:72-105` | AC2 "no sub-30 fps segments post-fix" holds in the 20-burst sample (0 drops, 60/60 fps) but not literally in the other fixed runs: 60-burst shows 1 drop (min 20 fps), a second 60-burst min 7 fps / 2 drops, human cadence min 5 fps / 2 drops. The doc discloses this and attributes it to GC/profiler outliers; honest, but the AC is met in spirit only. |
| F7 | noticing | `tests/unit/use-editor-collab.test.ts:230-263` | Dedupe test covers join and cursor-only churn, not name/colour change or leave. The implementation handles both (field compare + length compare), so this is coverage, not a defect. It also uses string Map keys where Yjs uses numeric clientIds; Map semantics make that immaterial. |
| F8 | noticing | `components/editor-toolbar.tsx` (all buttons) | Buttons carry `title` only — no `aria-label`, `aria-pressed`, or `type="button"`. The old inline toolbar had exactly the same 0 aria attributes and 16 titles, so this is **parity**, not a regression; the extraction was a missed a11y opportunity. |
| F9 | noticing | `components/ai-bubble-menu.tsx:23,40`, `components/code-block-language-select.tsx:38,58,72` | `setPos(prev => (prev === null ? prev : null))` is a functional no-op wrapper around `setPos(null)` (React's eager bail-out already handles the equal case). Harmless, slightly noisy. |

## Requested risk checks

| Risk | Result | Evidence |
|---|---|---|
| `onOpenLinkPrompt` is stable (memo not defeated) | **PASS** | `components/editor-workspace.tsx:380` — `useCallback(() => setIsLinkPromptOpen(true), [])`; call site `:1514`. The other props are `editor` (`useEditor` instance, deps `[ydoc, provider]`) and a primitive `disabled`. No inline arrow crosses the boundary. |
| `useEditorState` selector + shallow `equalityFn` per Tiptap v3.29 API | **PASS** | Installed `@tiptap/react@3.29.2`: `useEditorState` feeds `useSyncExternalStoreWithSelector(..., options.selector, options.equalityFn ?? deepEqual)`. `shallowEqualState(a, b \| null)` matches the declared `(a, b: T \| null) => boolean` signature and handles null. The selector's new object per transaction is discarded by the comparator, so no commit. |
| Typing test could pass vacuously if the cursor plugin never fired | **PASS (strong enough)** | Counters are reset after mount; the fake provider's `setLocalStateField` is only invoked by the real `yCursorPlugin` during typing (plus one setup call for `user`). Assertion `awarenessSets >= 38` and `changeEvents >= 38`; measured 38/76. Decisive extra evidence: the same test on a clean `origin/main` copy yields **38** workspace commits and fails the `<= 4` assertion. |
| Toolbar test's two counters are valid / non-flaky / not React-internals abuse | **PASS with F3** | `Profiler.onRender` counts real commits of `<EditorToolbar>` (child of the Profiler); typing → 0, toggle-bold → >0 plus `text-primary` on `button[title="Bold"]`; wrapper-body counter is a legitimate "did this component render" probe. Only weakness is F3 (parent-render assertion tests the harness memo). Measured deterministic across runs. |
| `sameCollabUsers` can miss a real presence change | **PASS** | Length compare catches join/leave; id/name/colour compare catches identity, rename and recolour; positional id compare catches reordering. The only case it keeps the old array is when the visible presence list is identical (e.g. same user reconnecting with a new clientId), where the DOM output is unchanged. `getStates()` values are the right source; cursor-only writes mutate the same state entry, so `user` is untouched during typing. Order is Map insertion order and is compared positionally — could cause an occasional spurious publish, never a missed one. |
| Tests exercise the cursor-plugin path, not a mocked no-op | **PASS** | Same provider fake increments inside `setLocalStateField` (the browser-side call the plugin makes); the plugin itself is the real `@tiptap/y-tiptap` one. |
| Yjs/IndexedDB transaction semantics unchanged | **PASS** | Diff touches only the awareness `change` handler body; `Y.Doc`, `IndexeddbPersistence`, provider construction, `doc.on('update')` dirty flag and cleanup are byte-identical. No schema/format change. |
| Error swallowing / state leakage / unbounded per-transaction work | **PASS** | No new `try/catch`; the dedupe is pure and O(clients) over a handful of entries. No new network calls (`git diff` has no `fetch`/provider changes; no `package.json` change). The toolbar selector performs ~16 bounded `isActive`/`getAttributes` reads per transaction — no DOM reads. |

## Axis verdicts

1. **Spec & acceptance criteria — partial.** AC1: numbers posted, and the deterministic table
   reproduces exactly (see below); production numbers unverifiable (F5). AC2: no stutter
   observed in the clean 20-burst run, residual single-frame dips disclosed (F6). AC3: met —
   toolbar commits 0 during a 38-char burst and does not follow presence churn. AC4: **not
   met** — `npm test` is red because the new guard test times out (F1) and the doc claims
   otherwise (F4); typecheck, lint and build pass.
2. **Frontend & accessibility — pass except F2.** Toolbar extraction preserves element order,
   all 16 `title` values, wrapper classes, and the `previewDoc` opacity/pointer-events
   behaviour (`disabled`). `ImageUploadButton`, `ColorHighlightPopover`, table and link are all
   present. All controls remain `<button>` (keyboard reachable), `useEffect` cleanups in the
   touched bubble-menu/select files are unchanged and still correct, no stale closures
   (`selectToolbarState` is module-level; no hooks added to the workspace). Memo cannot be
   defeated by the current props.
3. **CRDT & storage — pass.** Behaviour-preserving dedupe; no transaction, persistence or
   provider changes; cursor churn filtered without suppressing real presence updates.
4. **Backend security & errors — pass.** No backend/network surface change, no editor state
   leaked, no error path altered, bounded work per transaction.

## What was verified

```
npm run typecheck                     # exit 0
npm run lint                          # exit 0 (no output)
npx next build --webpack              # success, route table emitted (build script is `next build`)
npx vitest run tests/unit/editor-typing-renders.test.tsx \
  tests/unit/editor-toolbar-renders.test.tsx tests/unit/use-editor-collab.test.ts
                                      # 3 files / 12 tests passed (typing test at 14,798 ms)
npm test                              # 2 files failed / 140 passed: 3× billing-gateway + typing-test timeout
npx vitest run tests/unit/billing-gateway.test.ts   # 3 failed, identical on an origin/main copy
```

Deterministic before/after, measured with an instrumented copy of the new test (temporary
probe, removed; working tree left clean):

| Build | Workspace commits | Awareness writes | Awareness `change` events |
|---|---:|---:|---:|
| `origin/main` (`git archive`, fake transports) | **38** (test fails `<= 4`) | 38 | 76 |
| `83e3e6b` | **2** | 38 | 76 |

This matches `docs/qa/sil-230-typing-frame-budget.md` §3 exactly — the after-side numbers are
honest and reproducible. The before-side prod extrapolation (~190 descendant fibers × 38
commits ≈ 7,285) is arithmetically consistent with the #79 audit's 7,285 / 38-char figure.

Also confirmed: `TextAlign` in the installed version defaults to `null` alignment (source of
F2); prod bundle has no new dependency; only one formatting toolbar exists in the codebase
(`grep format_bold` → `components/editor-toolbar.tsx`).

## Recommendation

Fix F1 (timeout headroom — must, CI), F2 (align-left parity) and F4 (honest verification
block). F3 is a cheap test hardening and worth doing in the same pass. Then re-run the four
verification commands and re-submit.

## Disposition (post-review fixes)

| Finding | Disposition | Change |
|---|---|---|
| F1 major | **Fixed** | `tests/unit/editor-typing-renders.test.tsx` timeout raised 15 s → **60 s**; measured 8.3 s on the review host after the change. |
| F2 minor | **Fixed** | `selectToolbarState` now returns `align: ''` when neither center/right/left is active (and only reports `left` when `isActive({textAlign:'left'})` is true). `EMPTY_STATE.align = ''`; new test asserts Align Left is not lit by default. |
| F3 minor | **Fixed differently** | The reviewer's suggested assertion (`toolbarCommits` in the parent-render test) cannot work: React's `<Profiler onRender>` fires on the parent commit even when a memoized child bails out — verified empirically. Instead the misleading parent test was removed and replaced with a direct production-boundary guard: `expect(EditorToolbar.$$typeof).toBe(Symbol.for('react.memo'))`. The typing test still proves 0 Profiler commits and 0 wrapper renders. |
| F4 minor | **Fixed** | §6 now reports the exact commands, the 141/142 file result, the three pre-existing `billing-gateway` failures (reproduced on clean `origin/main`), and why `--webpack` is used in this worktree. |
| F5 noticing | **Dismissed with reason** | The raw `react renders` JSON lived in the run-scoped scratch dir and was removed by the harness. The deterministic §3 numbers are reproducible from the committed tests; the browser method is documented. No code risk. |
| F6 noticing | **Accepted / disclosed** | The 20-burst fixed profile has zero drops; longer runs show 1–2 isolated single frames. The doc states there is no sustained sub-30 fps segment and that the ideal is met for the React layer. |
| F7 noticing | **Fixed** | `use-editor-collab.test.ts` now also covers rename/recolour and leave, not just join + cursor churn. |
| F8 noticing | **No action** | Accessibility attributes are identical to the old inline toolbar; this ticket is perf-only. Noted as a future a11y ticket. |
| F9 noticing | **Fixed** | No-op `setPos(prev => prev === null ? prev : null)` wrappers reverted to `setPos(null)` in both decorations. |

Re-verification after the disposition: `npm run typecheck` exit 0, `npm run lint` exit 0,
`npx vitest run` on the three focused files 13/13 passed, `npx next build --webpack` exit 0.

## Second-round external review (PR #202)

Pullfrog: **pass**, "No critical issues — one minor parity suggestion inline". CodeRabbit: six
minor findings. All addressed:

| Reviewer finding | Disposition |
|---|---|
| Pullfrog: Undo/Redo lost `text-on-surface-variant hover:text-on-surface` | **Fixed** — restored the old classes instead of the generic idle button style. |
| CodeRabbit: `AIBubbleMenu` mark buttons can go stale because `setPos` dedupes on coordinates | **Fixed** — active marks now come from a separate `useEditorState` subscription; a mark toggle repaints even when the selection (and position) is unchanged. Regression test: `tests/unit/editor-decoration-refresh.test.tsx`. |
| CodeRabbit: `CodeBlockLanguageSelect` controlled value can go stale after undo | **Fixed** — language now comes from `useEditorState` instead of a render-time `getAttributes` read. Not unit-tested: jsdom's selection/DOM timing makes the decoration mount nondeterministic; the reactive subscription is the same mechanism proven in the bubble-menu test. |
| CodeRabbit: render-rate arithmetic ("three quarters", "9.5/s") | **Fixed** — removed the unsupported split; 0.86 renders/char is stated as a conservative upper bound because the total includes page-level mount/periodic renders. |
| CodeRabbit: test-coverage statement claimed five parent re-renders | **Fixed** — doc now describes the memo-boundary and default-alignment guards that actually exist. |
| CodeRabbit: do not infer a 16 ms budget from 60 FPS | **Fixed** — §5 now says frame cadence is a proxy, not an input-to-paint timing proof. |
| CodeRabbit: report typing latency in production results | **Addressed as a stated limitation** — the instrument reports frame cadence/commit counts, not INP; the audit had the same limitation. Documented in §5 instead of inventing a number. |
