# SIL-294 — QA pre-build test plan

Prepared independently by `/root/qa_prebuild` on 2026-11-08 before application implementation. This is the pre-build test contract required by `docs/agents/sdlc-workflow.md`, not verification sign-off. The implementer should publish/link this plan on SIL-294 before product edits.

## Sources and scope

Read the SIL-294 implementation plan, CONTEXT.md, SDLC workflow, relevant storage/sync ADRs, and the approved Open Design `workbench-mockups/` handoff, catalog, renderer, responsive CSS and tokens. Read existing route/component behavior and the affected unit/E2E suites. The source set is in Open Design project `9fa925fe-a46d-45ce-97b0-e5038bb1e37a`; the approved preview conversation is `222f49aa-228c-4707-a433-fdd3160e20e4`.

Scope covers workspace home, editor, legacy redirect, graph, settings, auth/invitation/first run/public access, and global search/capture. Preserve backend, editing, sync, storage, keyboard and permission behavior. No deployment or new component library. Fixtures below supply deterministic application state; never render the mockup's sample users, billing values, sync acknowledgment or page content as product state.

## Acceptance and regression matrix

All existing suite paths below are under `tests/unit/`. Add tests to the indicated suites or a focused new suite when the production seam is new. Use rendered behavior and service calls rather than class-string snapshots.

| ID | Given / when / then contract | Required evidence |
|---|---|---|
| W1 | Given a signed-in workspace, when opening `/`, show approved Workbench chrome and actual pages; signed-out `/` still renders the landing page. Loading, successful empty results, and rejected fetch are distinct. | Existing header/navigation suites; add dashboard integration coverage with delayed, empty, populated and rejected workspace/page responses. Assert retry reruns the read and does not create a page. |
| W2 | Given owned/shared pages and a pending invitation, when using create/open/rename/delete, filtering/sorting, daily Inbox, invitations, import/export or capture, invoke the existing operation for the correct entity. | Add `dashboard-workbench.test.tsx` for handler wiring and owned/shared/invitation separation. Retain `daily-strip`, `inbox-card`, `import-dialog`, `vault-export`, `workspace-views-nav` coverage. Cancel deletion must not call delete; failed rename/import/export must not imply success. |
| W3 | Given Workbench chrome, when using keyboard or mobile navigation, all destinations/actions remain reachable; one route header exists, current location is announced, Escape closes a named navigation dialog and focus returns to its trigger. | Extend `global-header.test.tsx`, `workspace-views-nav.test.tsx`; new shared-shell tests if a shell is introduced. Browser assertions for real focus containment/return and tab order. Keep header-slot cleanup across route changes. |
| E1 | Given an editable page with unsaved text, when opening/closing navigation, backlinks, history or AI context and switching themes, preserve the same editor/Yjs document, selection and text. Formatting actions still invoke TipTap commands. | Extend `editor-workspace-anon.test.tsx` or add `editor-workspace-workbench.test.tsx`; retain `editor-formatting`, `persistent-selection`, `editor-ai-integration`, `backlink-pane`, `use-editor-collab` suites. Assert no additional collaboration initialization on presentation toggles. |
| E2 | Given connecting, connected-unsynced, hub-synced and offline states, show the corresponding real status. Connected alone must show Saving, never Synced. Offline wins even when an old sync flag is true. | Retain all `sync-indicator.test.tsx` cases and `use-editor-collab.test.ts` grace/recovery cases; exercise status through the redesigned editor chrome. No new hook union state or reconnect API should be inferred from the error mockup. |
| E3 | Given owner/editor, authenticated viewer and anonymous public visitor, render role-appropriate chrome and editor editability. Anonymous readers see public labeling/footer/theme only; no workspace navigation, capture, editor actions, presence or sync claim. Authenticated viewers retain viewing banner and read-only history. | Retain/extend `editor-workspace-anon.test.tsx`; assert absence of privileged actions plus non-editable editor, not merely a banner. Test both mobile and desktop disclosures. Private-page denial must reveal no private title. |
| E4 | Given pending imported content or a version, opening chrome must neither consume import twice nor overwrite content; restore retains existing read-only guards. Markdown, links, tables and clipboard content survive migration. | Retain `import-hydration`, `markdown-engine`, `table-persistence`, `wikilink`, `clipboard-paste-editor`, `version-history-engine`, `version-history-storage`, `vault-export-source` and `vault-export-cold-room` suites. Real-editor browser round-trip fixture below. |
| R1 | Given `/doc/<id>`, await params and redirect to `/page/<same-id>`; destination retains normal public/private/viewer checks. | Add a direct route-module test mocking Next redirect and asserting exact destination for a representative UUID. `editor-route.test.ts` only tests pathname classification and is insufficient for redirect behavior. |
| G1 | Given graph loading/no-workspace/read failure, show truthful states with retry; given title and multiple tag filters, map and list derive from the same visible set. Clear restores input focus, selection and page navigation remain usable. | Retain `graph-page`, `graph-filters`, `graph-view-filters`, `graph-view-layout`, `graph-view-serialize`; add shared map/list visible-ID assertion if presentation adds a list toggle or secondary list. Browser test keyboard selection and clear-focus restoration. No graph writes. |
| S1 | Given settings, keyboard and pointer navigation reach every current surface, including AI Usage if present. Profile validation, BYOK/provider vault, billing entitlement and member handlers keep current behavior. | Extend `settings-tabs.test.tsx` and `unified-settings.test.tsx` with arrows plus focused active tab and associated panel. Retain `byok-settings`, `provider-registry`, `billing-ownership-transfer`, billing summary/entitlement suites. Errors retain form values and remain announced. |
| S2 | Given ownership transfer, nominate only an existing eligible collaborator, keep outgoing cancellation-at-period-end handling and successor acceptance. Confirmation/cancel must not silently prepare or accept a transfer. Prepared/accepted UI follows successful server responses only. | Retain existing ownership integration/unit tests; if confirmation chrome changes, test Cancel/no request, confirmed/single request, rejected request/no prepared success, and in-flight double-submit prevention. Never infer a price or eligibility from mockup text. |
| A1 | Given login/signup/reset/invite flows, retain real fields, handlers and auth destinations. Loading disables submission, recoverable failure retains input, reset success follows successful request, and unavailable invite is distinct from accepted. | Retain `login-failure.test.tsx`, `session-reauth-provider.test.tsx`, `public-access-denied.test.tsx`. Add focused signup/reset/invite tests for touched presentation/branching; assert no private title exposure and no success before service completion. |
| O1 | Given authenticated unlocked state, Cmd/Ctrl+K and the visible trigger open the named search dialog; arrows/Enter select the correct result, Escape restores trigger focus. Signed-out or locked sessions do not open it or swallow the native shortcut. | Retain `global-search-palette.test.tsx`; add actual focus restoration, no-result Enter/no navigation, and sign-out/lock while a deferred search completes. Test stale response after a newer query. |
| O2 | Given rejected search, show a recoverable error distinct from no matching pages; retry/requery can recover. Recent, loading, results and empty states remain distinct. | Change/add a behavioral assertion in `global-search-palette.test.tsx`: error content/alert visible, no empty-success claim; successful zero rows shows no-match copy. Current implementation emits a toast then renders empty results, so its existing failure test must not be treated as this criterion passing. |
| O3 | Given authenticated unlocked state, Cmd/Ctrl+Shift+C opens capture. Enter appends through the existing CRDT capture path to today's daily Inbox or an editable chosen page. Failed append retains text/target and produces no success. Viewer denial differs from lost-token reauth. | Retain `quick-capture-palette.test.tsx` and `tests/e2e/quick-capture.spec.ts`. Add sign-out/lock during pending destination search/append if touched. Preserve physical C-key/non-Latin and AltGr behavior; Shift+N is not the shortcut. |
| V1 | Given every authored route/state at 1440 and 375, match approved composition, semantic identity, content hierarchy, dimensions and action availability. Intermediate widths reflow according to source, without lost actions or horizontal page overflow. | Browser screenshots and state matrix below. Use actual content fixtures, not sample prototype HTML. Record each accepted deviation explicitly. |
| V2 | Given light/dark, keyboard, reduced motion and zoom, text/control contrast, visible focus, named inputs/dialogs and reading order remain accessible. | Browser/manual evidence below. JSDOM presence assertions cannot prove layout, contrast, screen-reader behavior or keyboard-safe mobile editing. |

## Visual and responsive evidence

Capture one route-family/state matrix with these columns: route, real fixture/state, role, width, theme, screenshot path, reference variant, pass/fail, deviation/defect. Obtain images from both the approved reference and application at the same CSS width; use a documented consistent viewport height and settled fonts. Artboard labels and sample annotation text are reference UI, not production content.

At **1440** and **375**, inspect all catalog variants: workspace (5), editor (12), legacy destination (4), graph (6), settings (9), auth/access (10), overlays (8). Shared state specimens cover hover/focus/pressed/disabled/loading/error/success. Equivalent production states must be driven through real components and deterministic mocked/seeded services; variant switches alone are not behavioral proof.

At **320/414/768/1024**, inspect every route in its default state, editor public/viewer/writing states, both overlays, an error with retained input, and navigation/context dialogs. Expand the matrix for any state whose structure changes at a breakpoint. Both themes are required at every listed width.

Source-specific geometry checks:

- 1440: 224px workspace rail; optional editor context pane 272px. Broad writing measure, 40px writing title and 32px route headings; 16px body text, 14px controls.
- 1024: 200px rail; editor context becomes a named disclosure. Home's context column is 248px in `screen.css`.
- 768: compact 184px rail; all navigation destinations and actions remain available.
- 375/320: single content column, named navigation/context dialogs; writing title 36px. No fixed bottom control covers the caret. At 414, content gutters can grow to 24px.
- Long real page titles, long emails, multiple tags and translated/browser-enlarged text must wrap or truncate accessibly without forcing document-width overflow. Graph canvas and deliberately scrollable toolbar/list regions may scroll within their own labeled region.

Test 200% zoom at desktop and a 320 CSS-pixel reflow equivalent (400% on a 1280px viewport). No clipped focused control, missing primary action or overlapping error. Use an actual mobile virtual keyboard for editor/capture: focus near the bottom, type several lines, select text, open/close contextual controls and verify the caret remains reachable through normal document scrolling. A reduced-height desktop screenshot is not mobile keyboard evidence.

## Keyboard, screen reader and contrast checklist

- Tab/Shift-Tab through workspace, editor, graph, settings and auth. Visible focus is immediate and not color-only; semantic native buttons/links activate through their standard keys.
- For navigation, search, capture, share, history/context and destructive confirmation: accessible name/description, correct modal semantics, focus containment, Escape where allowed and restoration to the invoking control. Never nest an interactive element within another interactive element.
- Settings tab arrows move focus together with selected state; tab/panel IDs remain associated. Menus support arrow navigation and return focus on close. Graph's accessible list supports equivalent navigation.
- Use a screen reader to inspect headings/landmarks, input labels/errors, loading and result announcements, dialog names, permission banners and sync labels. Record browser/OS/screen reader and concrete observations. DOM ARIA inspection alone is not a screen-reader pass.
- Measure rendered light/dark foreground/background pairs, including muted metadata, selected results, error panels, focus outlines and primary actions. Target WCAG AA: 4.5:1 normal text; 3:1 large text and essential non-text UI. Token-pair calculations do not establish composed-surface contrast.
- Respect reduced-motion preference for dialogs, chrome movement and smooth scrolling; menu/dialog state and focus remain functional without animation.

## Real editor and service-boundary fixtures

Use a designated test workspace/account. Do not send real reset emails, make payments, accept ownership, or call paid AI providers merely to obtain screenshots. Mock deterministic service boundaries for destructive/paid/security variants and separately retain the established service tests.

1. Create a page containing paragraphs, a heading, marks, list/task list, table, code, image, callout, `[[page link]]`, `#tag` and properties. Type, navigate via search, return, reload and export/reimport through the existing markdown seam. Compare semantic document content, not merely the title.
2. Two browser contexts: edit the same page, toggle redesigned chrome, confirm live convergence without reload. Separately verify a real collaborator admission fixture; two contexts using the same account do not prove page-member permissions.
3. Make an offline local edit, verify truthful Offline/Saving labels, reconnect and verify content convergence without a new editor instance. Preserve failed/unavailable export content reporting.
4. Open the same public page signed out, as a viewer and as an editor, including via `/doc/<id>`. Assert each capability set and deny unshared pages without leaking titles.

## Commands and evidence boundaries

During slices, run only the affected Vitest files plus their behavior dependencies. Before review, run the mandated gate once against the final candidate:

```sh
npm run typecheck && npm run lint && npm test && npm run build
```

Run relevant browser coverage against the real development stack:

```sh
npx playwright test tests/e2e/quick-capture.spec.ts
```

That suite skips without `E2E_EMAIL`/`E2E_PASSWORD`; a skip is recorded as **unverified**, never success. `tests/e2e/editor.spec.ts` currently checks obsolete login/“Your Documents” copy and does not establish the editor fixture above. Replace/extend its assertions to current behavior if using it as migration evidence. Do not retain a vacuous branch that passes without opening the editor.

Measure the standing SIL-8 targets with recorded hardware/browser, fixture size, network/cache state, timing boundaries, sample count and raw results: warm page open <100ms, cold IndexedDB open <300ms, typing latency <16ms, boot-to-interactive <1s, 10k-page search keystroke-to-render <200ms. `npm run test:perf` currently contains graph performance coverage; it does not prove these five targets. Any unmeasured target remains unverified.

## Final review gate

The implementation author may run checks but cannot issue independent acceptance. A fresh reviewer receives the final diff, these acceptance IDs, reference source and deterministic outputs; assesses Spec, a11y, CRDT/storage and backend/security; and reports PASS/FAIL per criterion with file/test/output evidence. Record limitations, blockers and all valid findings in `docs/reviews/pr-<id>-review.md`. Require separate QA sign-off and the repository's external review/CI gates before merge. This pre-build plan approves no implementation and claims no tests have passed.
