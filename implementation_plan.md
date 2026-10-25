# Implementation plan — #30 H0 Public pages polish

Branch: `feat/30-public-pages-polish` (base: `origin/main`). Spec:
`docs/superpowers/specs/30-public-pages-polish-spec.md`.

## T1 — Anon injection point + P2 denied screen (RED first)

1. `components/public-access-denied.tsx` — presentational; props:
   `variant: 'public' | 'internal'`. Links per spec P2.
2. `tests/unit/public-access-denied.test.tsx` (new, RED first).
3. `app/page/[id]/page.tsx` — replace `router.push('/login')` (anon non-public, anon fetch error) and
   the `toast + push('/')` catch with the denied screen; keep loading + success flow unchanged.
   Track anon grant via `isAnon` state → pass `anonVisitor` prop to `EditorWorkspace`.

## T2 — Public reading chrome in `components/editor-workspace.tsx`

1. New optional prop `anonVisitor?: boolean = false`.
2. Anon visitor: hide SyncIndicator, collaborator avatars, global-search / history / settings /
   MobileHeaderMenu / ProfileMenu; show `Public · view-only` pill (Globe icon) beside title;
   theme toggle visible on mobile.
3. `components/public-page-footer.tsx` — "Anyone with the link can view this page. Create your own
   workspace →" → `/signup`; rendered under the editor scroll region only when `anonVisitor`.
4. Viewer banner copy: anon → "Anyone with the link can view this page."; member viewer →
   "You have viewing access to this page."
5. Export button `title="Export Document"` → `"Export page"`.
6. `tests/unit/editor-workspace-anon.test.tsx` (RED first; mock scaffold modeled on
   `tests/unit/clipboard-paste-editor.test.tsx`; render with `anonVisitor`, member-viewer, and
   editor variants; assert chrome hide/show + copy).

## T3 — Share modal copy + lint/typecheck clean

1. `components/share-modal.tsx` P3 copy changes.
2. Extend existing share-modal test? Check `tests/unit` for one; else assert strings exist
   (`grep`-level) — no behavioural change, so keep verification proportional.

## T4 — VERIFY → REVIEW → SHIP

1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. Clean-room adversarial subagent review of `git diff origin/main...HEAD`, 4 axes →
   `docs/reviews/30-public-pages-polish-review.md`; fix valid findings (mentoring: noticings not
   blockers) before PR.
3. Commit per TDD slice; PR; waits external review (Pullfrog + CodeRabbit) + CI green per merge gate.
