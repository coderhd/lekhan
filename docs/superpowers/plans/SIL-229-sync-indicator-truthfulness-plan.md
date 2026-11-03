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

## T4 — Review remediation (PR #200 clean-room findings)

- **MAJOR-1:** `hooks/use-editor-collab.ts` clears `isDirty` when a local update is flushed on an
  open, synced socket, and persists a per-document pending marker (`lib/local-edits-marker.ts`) so
  genuine pending edits survive reload; marker clears on hub sync and `isDirty` resets on unmount.
- **MAJOR-2:** light-mode text tokens darkened to `amber-800` / `emerald-700` / `red-700` (WCAG AA).
- **MINOR-2 / NIT-4:** `aria-hidden` icons + `sr-only` explanation inside the live region.
- **MINOR-3:** `isLocalSynced` gates the durability wording ("saved on this device" vs "still in
  this tab"); plumbed through both call sites.
- **MINOR-4 / MINOR-5:** new `mobile-header-menu.test.tsx` pins forwarding; no-spinner invariant
  pinned with negative assertions.
- **MINOR-1 / NIT-1 / NIT-2:** offline tooltip no longer asserts the user is offline; saving/synced
  copy describes the handshake honestly.
- **NIT-3:** `isDirty` reset on cleanup.

## T5 — Verification

- Focused test suite green.
- `npm run typecheck && npm run lint && npm test && npm run build`.
- Known baseline: `tests/unit/billing-gateway.test.ts` fails 3 tests on `origin/main` too
  (supabase mock lacks `.or`); out of scope, documented in the PR.

## T6 — Review & ship

- Clean-room adversarial review of `git diff origin/main...HEAD`.
- PR with spec, plan, tests; wait for Pullfrog + CodeRabbit + CI before merge.
