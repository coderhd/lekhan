# SIL-279 — App redesign: Workbench

## Decision update — 2026-11-08

The user selected **Workbench** after reviewing the three Open Design alternatives. The prototype is saved in the Open Design project [Lekhan Design Directions](od://app/api/projects/9fa925fe-a46d-45ce-97b0-e5038bb1e37a/preview/bb6eeba9-b75f-4acb-9f7a-4c8d4a3d3d2c/). Treat it as visual direction and interaction reference; its sync, sharing, and AI behavior are simulations.

Design-system decision: retain Lekhan's established identity and semantic light/dark color tokens, Inter app typography, spacing/radius foundations, and existing Tailwind/Radix component setup. Refine and consolidate the app-specific tokens and component treatment for Workbench. Rebuild the application layouts over existing routes and feature behavior; do not replace the design system wholesale or recreate business/data flows.

## Outcome and boundaries

Redesign the existing Lekhan application's visual and interaction layer using the selected Workbench direction. Preserve routes, content and feature ownership, editor behavior and shortcuts, keyboard accessibility, sync/collaboration, storage, authentication, and backend/data contracts. No production deployment.

## Product constraints

`CONTEXT.md` defines a workspace as the ownership and collaboration boundary and pages as graph nodes. Preserve those terms and affordances. ADR 0003 specifies desktop markdown plus Yjs sidecar; ADR 0004 specifies hub-mediated CRDT replication and offline merge. The redesign must not imply that a local edit is synced before the existing system reports it, conceal sync or error states, or modify these contracts. Existing dark mode is first-class; cream, ink, and teak are established identity evidence, not a mandate to retain every current style.

## Acceptance and evidence

1. Use the saved Open Design prototype as reference for Workbench screens and tradeoffs. Prototype states for sync, sharing, and AI are illustrative only.
2. Document the app-specific semantic light/dark tokens, type and spacing, existing-component reuse, Radix mapping, interaction states, accessibility rules, and route-by-route migration. Validate contrast and focus in both themes. Do not add another component library without justification.
3. Incrementally implement the selected direction on current application surfaces without deleting routes or feature components. Preserve editing, keyboard shortcuts, navigation, auth, collaboration, sync, and data flows.
4. Record keyboard, screen-reader and responsive checks at 320, 375, 414, 768, 1024 and 1440 px, both themes, and reduced motion. Run the repository's required verification commands when allowed by the active session instructions.
5. Compare the final implementation against the Workbench prototype and document deviations, risks, and follow-ups; review migrated flows independently.

## Scope inventory (initial; confirm by code and runtime audit)

- `/` dashboard/workspace for signed-in users and public landing for visitors; shared global header, search, quick capture, profile, import/export, invitations and sync states.
- `/page/[id]` graph page editor; `/doc/[id]` is a legacy redirect to it. Preserve the redirect, existing permissions, sharing, version history, editor menus and collaboration behavior.
- `/graph` graph view and filters; `/settings` settings, providers, billing and ownership controls.
- `/login`, `/signup`, `/forgot-password`, `/invite/[token]` auth and invitation paths, including failure and session recovery states.
- Public `/about`, `/contact`, `/faq`, `/early`, `/privacy-policy`, `/terms-of-service` remain functional; establish whether the requested app visual system applies without silently changing their content or contracts.

## State and accessibility contract

Each flow must cover default, hover, visible focus, active, disabled, loading, success and error states where applicable; preserve input on recoverable errors. Search must support keyboard operation, empty results and escape/return focus. Dialogs need named controls, focus containment and restoration. Do not rely on color alone; respect reduced motion and test zoom/reflow. Mobile navigation must retain access to all existing actions without obscuring the editor or virtual keyboard.

## Outstanding implementation gates

- GitHub CLI authentication is currently invalid, so the GitHub issue/project-board status cannot be updated from this session. Reconcile SIL-279 with GitHub once `gh auth` is restored.
- The checkout contained unrelated pre-existing edits. The implementation is on `feat/sil-279-workbench-redesign`; avoid touching those unrelated paths.
- Verify public and anonymous page chrome separately from the signed-in Workbench so the redesign does not imply access or sync capabilities they do not have.

## SIL-8 standing quality gate

Paperclip SIL-8 mirrors GitHub #79. Preserve its measurable targets: warm page open <100 ms, cold IndexedDB open <300 ms, typing latency <16 ms, boot to interactive <1 s, and 10k-page search <200 ms keystroke-to-render. Measure and document method, environment and results rather than assuming the visual conversion meets them. Every primary action needs a keyboard path; audit command palette, wikilinks and slash menu. Design partial/offline states, truthful known sync state, no-data-loss recovery, and import/export progress plus fidelity reporting. Explicit board direction for SIL-279 expands SIL-8's prior visual-polish anti-scope; its functional quality gates still apply.

## Existing component preservation map (source inventory)

- `components/dashboard.tsx` owns workspace loading/error, owned and shared pages, invitations, filtering/sorting, page creation/rename/deletion, quick capture, search, import and vault export. Its existing Radix dropdown and confirmation dialog provide reuse starting points. A shell conversion must retain each handler and its existing error/retry behavior.
- `components/editor-workspace.tsx` owns the editor surface and embeds sync indicator, sharing, version history, export/copy, preview mode, search and the shared editor extensions. Treat its Yjs/editor lifecycle and serialization as protected seams; compare behavior before changing chrome.
- `components/global-search-palette.tsx`, `components/quick-capture-palette.tsx`, and editor slash/wikilink menus remain distinct interactions; do not collapse their keyboard semantics into an untested generic menu.
- `components/settings-client.tsx` composes BYOK, billing and ownership transfer; redesign presentation without moving ownership of sensitive operations.
- `components/graph-page.tsx` and graph filters need their own responsive and keyboard checks; a dashboard/editor-only migration does not satisfy route coverage.

## Approved Workbench handoff

The board selected Workbench on 2026-11-08 and directed the team to retain and refine the existing dark-first cream, ink and teak foundation, Inter/Geist application type, semantic tokens, Tailwind and installed Radix primitives. The approved [page mockups](od://app/api/projects/9fa925fe-a46d-45ce-97b0-e5038bb1e37a/preview/222f49aa-228c-4707-a433-fdd3160e20e4/workbench-mockups/index.html) and [implementation handoff](od://app/api/projects/9fa925fe-a46d-45ce-97b0-e5038bb1e37a/preview/222f49aa-228c-4707-a433-fdd3160e20e4/workbench-mockups/handoff.md) are authoritative design references. The board selection supersedes the earlier pending-direction statement.

This session exposes no Open Design tools and `codex mcp get open-design --json` reports no registered server. Review and export of the linked artifact, including its detailed state and responsive annotations, remain pending. Preserve the selection while obtaining access; do not claim the implementation matches an uninspected handoff.

## Access handoff update (2026-11-08)

SIL-293 records an authenticated operator report that a separately restarted designer session read the handoff and route index. It reports 1440 px desktop and 375 px mobile frames and the listed route families and states. That report establishes a usable path in the other session; the actual handoff content or export is not present in this workspace and this background session still has no registered Open Design server. SIL-294 is already assigned to implement the approved direction; do not duplicate its work. The UI/UX review must compare its delivered implementation with the actual approved artifact after access or an export is available.
