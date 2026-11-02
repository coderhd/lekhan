# Clean-Room Review — PR #187 (SIL-159 / #142 `[[` autocomplete popup)

**Branch:** `feat/93-wikilink-popup` · **Rev:** clean-room review rounds 1–3 · **Final verdict: APPROVE (merge gate: external reviews + CI)**

## Round 1 (diff f1bda62 vs main) — VERDICT: REVISE

| # | Axis | Finding | Severity | Disposition |
|---|------|---------|----------|-------------|
| 1 | Frontend | `allowedPrefixes: null` activation claim untested | ADVISE | Verified + test added (pullfrog MR comment) |
| 2 | CRDT | Popup commits `[[target]]` re-fires over inserted text | ADVISE (pre-guarded by prior run) | Guarded (exit meta + range guard) |
| 3 | A11y | Popup list had no listbox/option semantics | ADVISE | Added `role="listbox"`, `role="option"`, `aria-selected`, `aria-label` |
| 4 | CRDT | **Caret inside a closed `[[Link]]` activates popup; commit orphans `]]` tail into CRDT doc** | **BLOCKER** | FIXED (round 2) |
| 5 | Backend | Anon visitor create path silently no-ops | ADVISE | Guarded with visible toast (prior run) |

## Round 2 (fixes for #4) — VERDICT: REVISE (residual)

Fix: `isInsideClosedWikilink(doc, to)` forward scanner (256-char sniff window; first grammar char `[`, `]`]`, or `|` decides) composed into default `shouldShow`. Attack results: alias, junction links, multi-paragraph, doc-boundary positions — all correctly gated. Residual: `[[spaced target|alias]]` (the `|` branch opened unconditionally) — the only legal remaining corruption trigger.

Also closed in round 2: deletion-close regression test (criterion 2 tail), WikilinkList keyboard-nav tests (`ref.onKeyDown`: Enter/Tab commit, hint rows never commit), hint fallback for grammar-only queries.

## Round 3 (residual blocker) — VERDICT: APPROVE

`|` no longer short-circuits the scanner; only a closing `]]` ahead (or an opener) decides. Regression tests prove: caret in `[[te st|al]]` → popup never opens; open alias `[[te|al` → still opens.

## Known non-blocking notes (tracked, out of scope for SIL-159)

- Popup fires inside code fences (Obsidian suppresses; pre-existing design gap shared with decorations parsing).
- Cross-collaborator concurrent create of the same title can duplicate pages (pre-existing `createPage` path).
- Multi-word create affordance requires picking from the list (space closes popup; mention-parity tradeoff, documented inline).

## Verification

`npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓ (900 tests; only known flake `sync-snapshot-debounce` timing test under machine load, fails identically at clean HEAD) · `npm run build` ✓
