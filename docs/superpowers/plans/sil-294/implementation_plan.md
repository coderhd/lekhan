# SIL-294 Workbench Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` task by task; obtain independent clean-room review before creating the PR. This is the execution addendum to the SIL-279 plan, not a new design direction.

**Goal:** Implement the approved Workbench compositions over the existing Lekhan application behavior, with no deployment.

**Architecture:** Keep route guards, feature state, services, editor lifecycle, and storage in their current owners. Introduce shared presentation components only after reading the approved source annotations. Preserve the existing semantic light/dark tokens and installed Radix primitives.

**Tech stack:** Next.js (installed runtime reports 16.3.2), React 19.2, TypeScript, Tailwind 3, Radix, TipTap/Yjs; Vitest/Testing Library and Playwright.

**Spec:** `docs/superpowers/specs/sil-279-spec.md`; parent plan: `docs/superpowers/plans/sil-279/implementation_plan.md`.

## Readiness — 2026-11-08

- [x] Read the assignment, parent SIL-279 description and authenticated board approval, AGENTS.md, CONTEXT.md, DESIGN.md, SDLC workflow, and ADRs 0001/0003/0004/0005 (markdown engine)/0006.
- [x] Confirm scope: workspace, page editor, legacy redirect, graph, settings, auth/first-run/public access, global search and quick capture.
- [x] Confirm source-level route and feature ownership below.
- [x] Read the approved Open Design handoff, design-system/catalog, renderer source, tokens and reflow instructions.
- [x] Independent QA pre-build plan recorded in `qa-test-plan.md` (17 acceptance IDs).
- [x] Isolated local checkout at `.paperclip-scratch/sil-294/worktree`, branch `feat/sil-294-workbench-ui`. The sandbox denied linked-worktree metadata writes; the local clone preserves unrelated shared edits.

The authenticated board comment on SIL-279 (2026-11-08, `30c66686-a150-4dbc-ac87-feaf52aadc17`) approves the exact artifact below. Earlier parent-spec claims that selection is pending are stale; do not ask the user to select again. Likewise, the parent's old session-specific prohibition on running tests does not apply to this assignment, which explicitly requests the full verification command.

Approved index: `od://app/api/projects/9fa925fe-a46d-45ce-97b0-e5038bb1e37a/preview/222f49aa-228c-4707-a433-fdd3160e20e4/workbench-mockups/index.html`

Approved handoff: `od://app/api/projects/9fa925fe-a46d-45ce-97b0-e5038bb1e37a/preview/222f49aa-228c-4707-a433-fdd3160e20e4/workbench-mockups/handoff.md`

**Access resolved:** The operator registration is in the desktop Codex configuration while the background agent uses a separate configuration. Using the already configured signed local MCP executable with read-only `get_project`, `list_files` and `get_file` calls succeeded. The returned resolved project directory supplied the exact `workbench-mockups` sources. No configuration, account or generation mode was changed. A reference copy is at `.paperclip-scratch/sil-294/reference`.

**Implementation checkpoint:** `a680dbe` commits the shared shell/props and QA plan; `8b781ea` commits the workspace page-list composition and existing action wiring. These are local commits in the isolated checkout, not pushed or merged. Remaining route families and integrated review are still required.

## Global constraints

- Preserve routes, data/backend behavior, editing, sync, auth, keyboard shortcuts, access control, and storage.
- Match the exact 1440 desktop and 375 mobile compositions; follow each page state and 320/414/768/1024/1440 reflow notes.
- Reuse semantic tokens and installed Radix primitives; keep the existing cream/ink/teak identity and Inter/Geist app typography.
- Mockup samples simulate states: connect actual application behavior and do not replace product logic.
- Do not deploy. No database, transport, encryption, billing, tier-limit, or markdown-engine changes are needed for this presentation migration.
- Read the relevant installed guide under `node_modules/next/dist/docs/` before changing Next.js code.

## Source preservation map

| Surface | Current owner and boundary | Existing regression coverage to retain |
|---|---|---|
| `/` | `app/page.tsx` selects landing versus dynamically loaded `components/dashboard.tsx` after auth. Dashboard owns workspace fetch, owned/shared pages, invitations, create/rename/delete, daily strip/inbox, import/export, filters and sorting. Keep request cancellation and reauth refresh. | `workspace-views-nav`, `daily-strip`, `inbox-card`, `import-dialog`, `vault-export`, `session-reauth-provider` unit suites |
| Shared chrome | `app/layout.tsx` nests reauth, quick capture, search, then header-slot providers. `components/layout/global-header-context.tsx` owns `main`/`right` slot registration and cleanup. `global-header.tsx` hides itself for auth/editor routes. Avoid duplicate chrome or overlay providers. | `global-header.test.tsx`, `editor-route.test.ts`, `analytics-provider.test.tsx` |
| `/page/[id]` | `app/page/[id]/page.tsx` validates session/public access and consumes pending import exactly once. `components/editor-workspace.tsx` owns title, permission state, editing, TipTap/Yjs, sync/offline, sharing, history, backlinks, AI, copy/export, and mobile menus. Change presentation without remounting the editor on chrome toggles. | `editor-workspace-anon`, `use-editor-collab`, `sync-indicator`, `editor-formatting`, `backlink-pane`, `import-hydration`, `clipboard-paste-editor` unit suites; editor E2E |
| `/doc/[id]` | `app/doc/[id]/page.tsx` already awaits promised params and redirects to `/page/${params.id}`. Preserve this implementation rather than creating a second editor. `lib/routes.ts` recognizes both editor prefixes. | `editor-route.test.ts`; add a route-level redirect assertion if not covered |
| `/graph` | `components/graph-page.tsx` loads authenticated workspace graph/tags, serializes it, and preserves loading/error/no-workspace states and retry. `graph-view` and filters retain graph behavior. | `graph-page`, `graph-filters`, `graph-view-layout`, `graph-view-filters`, `graph-view-serialize` unit suites |
| `/settings` | `components/settings-client.tsx` composes provider registry/BYOK vault, billing, ownership, password and member controls. Keep handlers, role checks and error handling in these owners. | `settings-tabs`, `unified-settings`, `byok-settings`, `billing-ownership-transfer`, `provider-registry` unit suites |
| Auth/invite/public | `app/login`, `signup`, `forgot-password`, `invite/[token]`; `public-access-denied`, public page footer and `anonVisitor` editor prop. Anonymous reader is distinct from authenticated viewer. Marketing/legal routes remain reachable; do not import `/early` campaign typography into the app. | `login-failure`, `public-access-denied`, `editor-workspace-anon`, `session-reauth-provider` unit suites |
| Global search | `components/global-search-palette.tsx` already uses Radix Dialog, auth/reauth gating, request IDs/debounce, recent/search services, arrow/Enter navigation and Cmd/Ctrl+K. Retain `useGlobalSearch(): { open: () => void }`. | `global-search-palette.test.tsx`, `search.test.ts` |
| Quick capture | `components/quick-capture-palette.tsx` owns Radix Dialog, draft/target selection, permission checks and CRDT append. Retain `useQuickCapture(): { open: () => void }`, Cmd/Ctrl+Shift+C and recoverable failure input. | `quick-capture-palette.test.tsx`; `tests/e2e/quick-capture.spec.ts` |

The table names unit suites under `tests/unit/`; it records available coverage, not a claim that those suites were executed in this checkpoint.

## Shared interface boundary before dispatch

Implement sequentially until the handoff establishes a shared layout. Before any parallel implementation, define the concrete presentation props in `components/workbench/types.ts` and commit them first. Keep `Page`, `Workspace`, `MemberPageItem`, billing and sync types authoritative in their existing modules. The shell may receive navigation destination, children, optional contextual/action slots, and callbacks into existing handlers; it must not fetch product data or manufacture sync/access state. Do not prescribe new sidebar content or dimensions before reading the mockups.

Keep `GlobalHeaderSlotName = 'main' | 'right'` and the two overlay `open()` contracts stable unless the handoff requires an explicitly reviewed presentation adaptation. No shared service/schema changes are planned.

## Review focus

1. Public anonymous page versus authenticated viewer: editing/AI/capture actions must respect actual permissions, including expired sessions.
2. Chrome and panel toggles during typing/import: retain the Yjs instance, pending-import consumption and unsaved input.
3. Search/capture async races and reauth: stale results must not navigate or append after lock/sign-out; recoverable failures retain input.
4. Narrow viewport/zoom plus open menus or virtual keyboard: primary actions, close controls and focused inputs stay reachable with no hidden navigation.
5. Local/offline edits and exports: do not label unsynced content as synced or replace export fidelity/errors with sample success states.

## Ordered execution

### 0. Resolve source access and establish the baseline

- [ ] Consume the SIL-293 export/control path; read every listed mockup and handoff annotation, including light/dark and focus behavior. Save an artifact-to-route/state comparison table in this folder.
- [ ] Have QA record the concrete pre-build plan against that table. Preserve the current approved scope; request clarification only for a real contradiction.
- [ ] Use the worktree skill to establish `feat/sil-294-workbench-ui` isolation without moving or staging unrelated shared changes. Carry the parent spec/plan into the worktree as references if still untracked.
- [ ] Read installed Next.js guides for layouts, CSS, routing/redirects and client boundaries; run a baseline targeted suite before edits and distinguish existing failures.

### 1. Shared chrome and workspace vertical slice

**Files:** `app/globals.css`, `tailwind.config.js`, `components/layout/global-header.tsx`, `components/dashboard.tsx`; new `components/workbench/` files only where source reuse warrants them. Keep each commit focused on tokens, shell, or workspace.

**Interfaces:** Consume existing dashboard handlers, route links and overlay open callbacks. Produce presentation-only shared props before parallel work; no new data API.

- [ ] Add behavior assertions for keyboard navigation, current destination, mobile menu close/return focus, loading/retry, and an existing page action reaching its original handler.
- [ ] Run those tests and observe the intended failure for new behavior; preserve existing regression assertions.
- [ ] Apply the annotated tokens/layout and wire existing actions. Keep landing-page selection and auth listeners unchanged.
- [ ] Run affected header/navigation/dashboard tests; compare workspace at 1440 and 375 against the approved compositions, then inspect intermediate widths and both themes. Commit the verified slice.

### 2. Editor and legacy compatibility

**Files:** `components/editor-workspace.tsx`, `components/mobile-header-menu.tsx`, affected presentation components; preserve `app/page/[id]/page.tsx` and `app/doc/[id]/page.tsx` logic.

**Interfaces:** Consume unchanged `EditorWorkspaceProps`, `useEditorCollab`, sharing/history/backlink/AI components and actual sync status. Produce chrome without a new editor state owner.

- [ ] Pin panel toggle during editing, anonymous/member-viewer permissions, legacy redirect, keyboard paths, import hydration and unsynced/offline indicator behavior in affected tests before changing markup.
- [ ] Apply editor composition around the existing editor instance and callbacks, then run affected tests and editor E2E. Compare both exact compositions and mobile keyboard/panel behavior. Commit.

### 3. Global search and quick capture

**Files:** `components/global-search-palette.tsx`, `components/quick-capture-palette.tsx` and their unit suites.

**Interfaces:** Preserve the two `open()` hooks and independent state machines; consume existing search and capture services.

- [ ] Pin Escape/return focus, arrows/Enter, empty/error states, lock/sign-out during requests, and failed capture retaining text.
- [ ] Apply approved Radix dialog presentation; run both existing suites plus quick-capture E2E, inspect mobile viewport/keyboard and reduced motion. Commit.

### 4. Graph and settings (separate commits)

**Files:** `components/graph-page.tsx`, graph presentation/filters; then `components/settings-client.tsx` and affected presentation components.

**Interfaces:** Consume existing graph status/data and settings props. Keep providers, billing/ownership and member actions in their current owners.

- [ ] Pin graph loading/retry/filter/navigation and settings tab keyboard/confirmation/error behavior before composition changes.
- [ ] Apply approved shared shell and each route layout; run the graph and settings suites listed above plus relevant billing/provider tests. Compare compositions at both exact widths and record intermediate reflow. Commit each route separately.

### 5. Auth, first run, public access and supporting states

**Files:** auth/invite route presentation, `components/public-access-denied.tsx`, `components/public-page-footer.tsx`, affected loading/empty/dialog components.

**Interfaces:** Consume existing auth callbacks, invite token handling, `anonVisitor` and actual role checks. No backend/API/schema changes.

- [ ] Pin recovery input, invitation errors, first-run action, private-page denial and anonymous read-only behavior.
- [ ] Apply approved compositions without changing session/access contracts; run affected auth/public suites and manually exercise all route families, including legal/marketing reachability. Commit.

### 6. Verification, independent review and handoff

- [ ] Run `npm run typecheck && npm run lint && npm test && npm run build`; record actual output, failures and environmental limitations.
- [ ] Record screenshots and keyboard/screen-reader checks for 320/375/414/768/1024/1440, light/dark, reduced motion and zoom/reflow. Compare exact 1440/375 compositions against the source; document deviations individually.
- [ ] Measure the parent SIL-8 targets with method/environment: warm page <100 ms, cold IndexedDB <300 ms, typing <16 ms, interactive <1 s, 10k-page search <200 ms. Do not claim these from screenshots or mocks.
- [ ] Request fresh-context clean-room subagent review of `git diff origin/main...HEAD` on all four AGENTS.md axes and QA sign-off; save `docs/reviews/pr-<id>-review.md` and fix valid findings.
- [ ] Create the PR only after internal review; register PR/evidence in Paperclip. Respect Pullfrog/CodeRabbit and CI gates for any later merge. Do not deploy.

## Checkpoint evidence — foundation and workspace

- Baseline: header/navigation/search suites, 21 tests passed before edits.
- RED: shared shell module absent; then page-link regression failed against the old card markup; rename-input accessible-name regression failed before the label addition.
- GREEN: 5 suites / 38 tests passed (`workbench-shell`, `global-header`, `dashboard-refetch-on-auth`, `daily-strip`, `inbox-card`). Covers actual routes/current destination, mobile dialog Escape/focus and edit-subtree preservation, search action handoff, stale fetch/retry, real create/rename/delete IDs and non-destructive Cancel.
- `npm run typecheck` passed. Targeted ESLint on changed TypeScript files passed. `git diff --check` passed.
- Browser attempts: both installed Chrome and Playwright headless shell aborted before navigation (SIGABRT/SIGTRAP; process cleanup reported EPERM). The Next development server also hit EMFILE watcher limits; stopped through its managed exec session. No screenshots, composed-surface contrast, actual mobile keyboard or screen-reader results are claimed.
- DailyStrip and InboxCard remain in the workspace context, preserving features not illustrated in the sample. Date/title filters remain above the real list. These production-content adaptations require final design comparison.
- Full repository command, remaining route migrations, visual comparison, performance measurements, independent clean-room gate and PR remain pending.
