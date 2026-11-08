# SIL-279 implementation plan — Workbench

## Overview

Convert Lekhan's signed-in application UI to the user-selected Workbench direction. Keep the existing identity, tokens, Tailwind setup, and Radix primitives as the foundation, consolidating the app-specific layer where needed. Preserve all routes, data, auth, editor, collaboration, storage, and sync behavior.

Reference prototype: [Lekhan Design Directions](od://app/api/projects/9fa925fe-a46d-45ce-97b0-e5038bb1e37a/preview/bb6eeba9-b75f-4acb-9f7a-4c8d4a3d3d2c/). Its sync, sharing, and AI states are simulations and must not be copied as functional claims.

## Architecture decisions

- Keep the cream, ink, teak-orange, dark-first identity and Inter/Geist app typography. Do not mix the `/early` campaign Fraunces styles into the app.
- Establish semantic app tokens for workspace chrome, editor canvas, contextual panes, borders, focus, and status. Resolve existing light/dark inconsistencies instead of adding a second palette.
- Use existing Radix dialog, alert dialog, dropdown, avatar, label, and slot packages plus native controls. Add no component library or backend dependency.
- Recompose the visual hierarchy over the existing route and feature components. No route, editor model, auth flow, collaboration provider, sync contract, or storage format changes.
- Build sequentially in the current feature branch. The branch carries pre-existing unrelated working-tree edits; keep edits scoped to this plan.

## Task list

### Phase 1 — Foundation

- [x] **Task 1: Select Workbench and define design-system approach.** Record the direction, prototype reference, and decision to retain and refine the incumbent system. Acceptance: spec identifies scope, preserved contracts, states, and migration surfaces. Verification: review against `DESIGN.md`, `CONTEXT.md`, and ADRs 0003–0006.
- [ ] **Task 2: Consolidate Workbench semantic tokens.** Define the app's light/dark canvas, chrome, navigation, editor, contextual-pane, border, focus, and status tokens using current palette/type/spacing foundations. Acceptance: no duplicate competing palette; contrast and reduced-motion rules documented. Verification: inspect both themes and token usage.
- [ ] **Task 3: Add shared Workbench shell primitives.** Build the responsive app navigation and reusable page frame without moving data fetching or feature state. Acceptance: keyboard-operable navigation and focus states; mobile retains all core destinations. Verification: inspect 320, 375, 414, 768, 1024, and 1440 px layouts.

### Checkpoint — Foundation

- [ ] App shell uses the selected direction and incumbent identity.
- [ ] Existing routes and product contracts remain unchanged.
- [ ] No additional dependency is introduced.

### Phase 2 — Core workspace

- [ ] **Task 4: Recompose the signed-in workspace home.** Preserve owned/shared page filtering, capture, import/export, invites, inbox, and empty/error/loading states. Acceptance: page list and quick capture remain reachable; no fake metrics or card-grid dashboard. Verification: manually exercise create/open/search/capture/import/export and recovery states.
- [ ] **Task 5: Recompose page editor chrome.** Keep TipTap/Yjs setup, shortcuts, title editing, sharing, history, backlinks, AI, export, and truthful sync states intact. Acceptance: writing canvas leads; contextual panes remain optional; mobile keyboard/editor remains usable. Verification: manually inspect editing, links, toolbar, panel states, and sync/error indicators.
- [ ] **Task 6: Align global search and quick capture.** Preserve existing command shortcuts and result navigation. Acceptance: keyboard open/close, empty state, selection, and focus restoration work. Verification: manual keyboard path and mouse path.

### Checkpoint — Core workspace

- [ ] Home-to-page and page-to-search flows work with existing services.
- [ ] Sync and collaboration status continue to report actual state.
- [ ] No new local state shadows authoritative data.

### Phase 3 — Remaining application surfaces

- [ ] **Task 7: Migrate graph and settings surfaces.** Reuse graph filters, settings, billing, provider, and ownership flows. Acceptance: existing controls and permissions remain unchanged; navigation matches Workbench. Verification: inspect graph, settings, and destructive/confirmation controls.
- [ ] **Task 8: Migrate auth, onboarding, and public page chrome.** Keep auth, invitation, public-read-only, and legal routes functional. Acceptance: public visitor and signed-in states remain distinct; anonymous access is not overstated. Verification: inspect onboarding/empty/error states and route access.
- [ ] **Task 9: Align supporting dialogs, menus, and status components.** Reuse installed Radix primitives for dialogs, alert dialogs, dropdowns, labels, avatars, and slots where they fit. Acceptance: names, focus containment/restoration, keyboard handling, and reduced-motion behavior are consistent. Verification: keyboard and screen-reader-oriented inspection.

### Checkpoint — Surface migration

- [ ] All existing app routes remain present.
- [ ] Both themes and all requested widths have been reviewed.
- [ ] Loading, empty, offline, syncing, and recoverable error states remain truthful.

### Phase 4 — Review and verification

- [ ] **Task 10: Accessibility and responsive review.** Check keyboard, visible focus, labels, reduced motion, zoom/reflow, contrast, and widths 320/375/414/768/1024/1440 in both themes. Record findings in the review artifact.
- [ ] **Task 11: Build and quality review.** Run allowed typecheck/lint/build verification, inspect the diff, and obtain independent UI/UX and QA review. Fix valid findings before proposing merge.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Existing dashboard and editor components combine presentation with substantial behavior | A broad rewrite could regress editing, sync, or permissions | Preserve handlers and providers; change markup in small vertical slices |
| Existing light/dark tokens and ad-hoc colors disagree | Workbench can appear inconsistent across routes | Consolidate semantic tokens before the route migration |
| Public and anonymous routes have different capabilities | Shared chrome could imply unavailable features | Keep viewer and anonymous visitor conditions explicit |
| Working tree contains unrelated changes and GitHub CLI auth is invalid | Accidental scope expansion and stale board status | Keep edits scoped to listed files; update GitHub when auth is restored |

## Verification commands

Repository gate: `npm run typecheck && npm run lint && npm test && npm run build`. The current session instruction disallows running tests unless the user asks for testing/verification; do not run `npm test` in this session. Run the remaining requested build checks only when implementation reaches its review checkpoint.

## Current state

- Workbench selected by the user on 2026-11-08.
- Design-system decision accepted: preserve and refine the incumbent identity/system; rebuild app layouts over existing behavior.
- Feature branch: `feat/sil-279-workbench-redesign`.
- Phase 1 Task 1 complete. Implementation has not yet changed app source files.
- GitHub issue/project board cannot be updated until CLI authentication is restored.
