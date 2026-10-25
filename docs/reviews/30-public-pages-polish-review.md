# Clean-room review — `feat/30-public-pages-polish` (#30, SIL-31)

- Diff: `git diff origin/main...HEAD`
- Reviewer: independent fresh-context subagent (clean-room), 2026-10-26
- Tests re-run by reviewer: `tests/unit/editor-workspace-anon.test.tsx` + `tests/unit/public-access-denied.test.tsx` (5/5), `tests/unit/profile-menu-credits.test.tsx` (1/1); `tsc --noEmit` clean; eslint clean.
- **Verdict: APPROVED-WITH-NOTICINGS — no blockers.**

## Axis findings

### Axis 1 — Spec & acceptance criteria
All P1/P2/P3 requirements implemented and traceable (badge, banner variants, footer, per-chrome hiding, theme toggle un-gated for anon, denied screens for both signed-out and signed-in paths, share-modal copy pass). No requirement silently missed.

### Axis 2 — Frontend & accessibility
Hooks audit clean (no hooks moved inside the `anonVisitor` conditionals; cleanups intact). No ARIA name collisions.

### Axis 3 — CRDT & storage
No edit window for anon (`isViewer !== null` gate, `editable: !isViewer`, re-assert effect). Checkpoint timer early-returns on `isViewer` — no IndexedDB writes from anon. Bot/bubble/export/render gated. Ydoc/provider wiring untouched.

### Axis 4 — Backend & security
No auth bypass; behavior *narrows* (silent redirects → inline denied screens). Non-public/missing/error collapse to the same generic copy (no existence leak). Anon grant still requires RLS-visible `is_public`. All new gates key off `anonVisitor`, never `isViewer` alone (14 call-sites grep-verified). Share-modal behavior untouched.

## Findings & disposition

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| S1 | should-fix | Global keyboard shortcuts (Cmd/Ctrl+Shift+S history, Cmd/Ctrl+L bot) not gated for anon readers | **Fixed** — effect-level `if (anonVisitor) return` guard keyed so member-viewer behavior is unchanged (history button remains visible to member viewers) |
| S6 | should-fix | `loadMentionables`/`loadWorkspacePages` fire on anon mount — one guaranteed RLS-denied query + pointless public-page fetch | **Fixed** — effect guard `!anonVisitor`; deps updated |
| S2 | should-fix | ProfileMenu trigger lacked `aria-haspopup`/`aria-expanded` | **Fixed** (cheap half of the finding; `role="menu"` popup + Escape handling left for the wider a11y pass) |
| N4 | noticing | PublicPageFooter used raw `<a>` — full reload | **Fixed** — `next/link` |
| N1 | noticing | Spec-literal footer wording deviation (banner + CTA split) | **Documented** — spec amended inline |
| N3 | noticing | Share-modal toggle should be `role="switch"` + `aria-checked` | Deferred to wider a11y pass (behavior unchanged; label announces intent) |
| N5 | noticing | Avatar block wrapper still renders hidden for anon (dead DOM) | Accepted — activeUsers empty for anon; cosmetic |
| N6 | noticing | `window.location.origin` read during share-modal render | Pre-existing; fine client-side today |
| N7 | noticing | Signed-in transient fetch errors land on "isn't available" screen | Accepted for H0 |

Post-fix re-verification in this worktree: `npm run typecheck`, `npm run lint`, `npm test` (639 passed), `npm run build` — all green before this review's fixes; the four fixes re-verified via targeted suites below.
