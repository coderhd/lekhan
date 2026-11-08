# Execution ledger — SIL-294 plan, continuation SIL-298

Foundation/workspace commits a680dbe, 8b781ea, d4ad101 are complete and reused.
The approved task plan remains authoritative; no selection or approval is reopened.

Pre-flight: editor, graph and settings consume the committed WorkbenchShellProps;
page lists/permissions stay caller owned. Public anonymous readers bypass the shell.
Overlay open() hooks stay unchanged. No service/schema/storage changes planned.

## Search increment

- RED: retryable-error assertion failed because errors rendered “No pages match”; stale Enter test navigated to the previous recent page during a new query.
- GREEN: retained query, inline alert/retry, cancelled-request invalidation and guarded navigation. 14 search-palette tests passed, including a response arriving after reauth lock.
- Presentation uses scoped overlay CSS, an explicit close control, description and return focus. Browser/mobile checks remain pending.

## Editor and legacy increment

- RED: workspace navigation trigger absent from editor; preservation test failed before shell integration.
- GREEN: 7 suites / 26 tests passed (editor anonymous/member/editor, formatting, clipboard, version integration, legacy route, hydration, sync indicator). Unsaved content and the exact ProseMirror node survive navigation open/Escape, with focus returned. Anonymous editor is non-editable and has no workspace navigation.
- Legacy route-level test confirms awaited params redirect the same UUID to /page; existing destination guards are unchanged.
- Editor uses scoped styles, in-flow chrome, wrapped full formatting controls and writing title. Existing panes, services, editor hooks and Yjs ownership remain intact. Graph/settings and visual context comparison remain pending.

## Graph increment

- RED: graph route had no shared main navigation; integration assertion failed.
- GREEN: 6 suites / 54 tests passed: route loading/error/retry/no-workspace, graph map/navigation, filters, layout and serialization.
- Uses the real loaded workspace name. A visible page list and map/list control share the renderer's already-filtered nodes; unresolved targets remain non-navigable. No graph writes or new data owner.

## Settings increment

- RED: arrow navigation changed selection without moving focus; confirmation assertions found direct nomination requests and no recoverable inline error.
- GREEN: settings, ownership confirmation and capture recovery checkpoint: 4 suites / 22 tests passed. Earlier settings/provider/BYOK/unified suites: 6 suites / 41 tests passed before confirmation addition.
- All current settings tabs retained, with roving tabindex, arrow/Home/End focus and panel associations. Provider registry/vault, billing and ownership API contracts remain owned by existing components. Ownership confirmation cancel sends no request; failure retains successor and shows an alert.

## Capture increment

- RED: failed capture had only a toast; a capture continued appending after reauth locked during destination preparation.
- GREEN: 16 capture-palette tests passed in the 22-test checkpoint above, including retained draft/retry and lock during destination lookup. Operation generations now invalidate preparation and stale success UI; existing appendCaptureBlock remains authoritative. An append already sent to the CRDT service cannot be retroactively cancelled by chrome.
- Scoped Radix sheet, explicit close/return focus, input remains disabled while submitting, destination-search error/retry and stale-result guards; Cmd/Ctrl+Shift+C and Enter contract preserved.

## Access routes increment

- RED: signup/reset controls lacked associated labels; unavailable invites had no inspectable unavailable state; failed acceptance had only a toast.
- GREEN: 5 suites / 18 tests passed for signup/reset retained input and service-confirmed success, login failures/hydration, invitation pending/failure/unavailable, public denial and anonymous editor permissions.
- AccessFrame provides the approved in-flow two-column desktop/single-column mobile treatment, theme and legal links. Invitation retains page-scoped handlers and the existing pending-token/login and accepted-page destinations. Unavailable/failure views now remain inspectable without leaking a title.

## Responsive editor refinement

- RED: narrow formatting disclosure did not exist; wide backlinks did not provide a non-modal complementary region.
- GREEN: 4 suites / 37 tests passed covering full formatting disclosure, unchanged live editor, wide non-modal context, existing backlink drawer and capture behavior.
- Writing title precedes actions/toolbar. At 1280+ the existing backlink query docks in a 272px context column; below that it keeps the existing named modal behavior. The formatting dialog discloses the original commands and preserves the editor subtree. Capture now uses the annotated four-row text area with Enter submission and Shift+Enter text entry.
- Browser launch rechecked: macOS MachPort rendezvous denied bootstrap_check_in; Chromium exited SIGTRAP before about:blank. No visual/responsive/browser a11y/performance acceptance is claimed. Issue workspace reports no managed runtime.
