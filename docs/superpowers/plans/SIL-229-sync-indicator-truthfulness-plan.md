# Implementation plan — SIL-229 sync indicator truthfulness

Branch: `feat/sil-229-sync-indicator-truthfulness` (base: `origin/main`). Spec:
`docs/superpowers/specs/SIL-229-sync-indicator-truthfulness-spec.md`.

## T1 — Extend indicator contract (RED first)

Update `tests/unit/sync-indicator.test.tsx` to encode the precedence table:
- offline + `hasUnsyncedChanges` → "Local edits only", and no "Offline" text
- connecting + `hasUnsyncedChanges` → "Local edits only"
- connecting without edits → "Connecting to hub..."
- connected + not synced + edits → "Saving..." (not "Local edits only")
- offline without edits → "Offline"
- synced → "Synced"
- `role="status"`, `aria-live="polite"`, cold-start `title`, durability `title`

Run `npx vitest run tests/unit/sync-indicator.test.tsx` → must fail.

## T2 — Implement component (GREEN)

- `components/sync-indicator.tsx`: optional `hasUnsyncedChanges`, state resolver, module-level
  appearance map (no inline component definitions), `role="status"` + `aria-live="polite"`,
  `title` copy using Hub/this-device vocabulary.
- Keep existing chip palette; amber "Local edits only" chip with `HardDrive` icon, no spinner.

## T3 — Prop plumbing

- `components/editor-workspace.tsx`: pass `hasUnsyncedChanges` to `SyncIndicator` and to
  `MobileHeaderMenu`.
- `components/mobile-header-menu.tsx`: accept optional `hasUnsyncedChanges` and forward it.

## T4 — Verification

- Focused test suite green.
- `npm run typecheck && npm run lint && npm test && npm run build`.
- Known baseline: `tests/unit/billing-gateway.test.ts` fails 3 tests on `origin/main` too
  (supabase mock lacks `.or`); out of scope, documented in the PR.

## T5 — Review & ship

- Clean-room adversarial review of `git diff origin/main...HEAD`.
- PR with spec, plan, tests; wait for Pullfrog + CodeRabbit + CI before merge.
