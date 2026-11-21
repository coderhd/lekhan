# Settings and Workbench implementation plan

Spec: docs/superpowers/specs/settings-workbench-polish-spec.md

## Global Constraints

Keep real settings sections, billing and transfer entry URLs, editor and access behavior, and Lekhan's Astryx identity. Reuse existing primitives, with CSS scoped to the affected surfaces. User references are functional and visual inspiration.

## Task 1: Workspace settings dialog

Replace the full-page Settings experience with a Radix dialog over the active Workbench. Use the real existing settings panels with left-aligned navigation and a scrollable content area. Remove the AI Usage tab and informational banner while preserving Sarvam key management in AI & Models. Cover all settings entry points, direct billing/transfer links, and mobile menu handoff. Update existing behavioral tests and add focused regressions when needed. Own SettingsClient, dialog styling, route and dialog wiring, and related tests. Coordinate shared WorkbenchShell changes by leaving visual-only styles to Task 3.

## Task 2: AI and model controls

Restyle AIProviderSettings and BYOKSettings. Address the cramped select arrow, button colors, inconsistent sizes, wrapped inputs/actions, excessive borders and warning fills, and redundant disabled active model button. Use a compact active model summary with its display name, then surface provider and model controls before hardware and local troubleshooting. Keep provider and model persistence and local connectivity behavior. Use the shared dialog surface from Task 1, scoped control styles, and verify the existing AI and BYOK tests.

## Task 3: Workspace rail, editor and search

Improve the page browsing rail and editor reading surface using the workspace reference. Use a quiet reading column and neutral document headings. Give the editor’s page-level language and voice panel a specific label so Workspace Settings remains clear on desktop and mobile. Refine the search overlay field, results, empty state and keyboard help. Preserve existing keyboard navigation and command behavior. Own the visual Workbench CSS, editor presentation, global search palette and its tests. Verify desktop and narrow viewport affordances.

## Task 4: Integrate and verify

Review each task against the spec and code quality, then run typecheck, lint, tests, and production build. Exercise authenticated browser flows with synthetic data, capture evidence, and dispatch independent whole-branch review.
