# Lekhan web beta — Manual QA handoff

Lekhan is a web workspace for writing and organizing linked notes. A **workspace** holds your pages. Pages can link to other pages or be shared with collaborators. Lekhan supports importing an Obsidian vault and exporting notes as Markdown. Workbench is the interface for finding, editing and managing those pages.

Your assignment is to test the web beta from a new user's perspective. Start with signup, import, collaboration and export. Then check Workbench on desktop and Android. The release owner will tell you which build to test and where to submit results.

## Before testing

- Ask the release owner for the QA or preview URL, build ID or commit, and two test accounts or an approved signup method. Use separate browser profiles for the owner and collaborator so their sessions stay independent.
- Use a synthetic Obsidian vault with two linked Markdown notes, one nested folder and one small image. Include a heading, checklist and code block. Keep the original files to compare against the export.
- Start in Chrome desktop. Repeat the core flow on Android Chrome where supported. Record the device, OS, browser, viewport, theme and build. Use TalkBack on Android or a desktop screen reader for the accessibility pass.
- Use only the assigned environment and synthetic data. Leave paid checkout, external integrations and production account changes to separate assignments. If setup is missing, mark the affected cases **Blocked** and keep testing the rest.

Before each run, write down the build, URL, browser and test roles. Start with an empty QA workspace for the owner and a separate browser profile for the collaborator. Use a new workspace or clearly labeled disposable pages for retests. Confirm the owner can receive mail at the approved test address before starting signup.

Create this fixture folder locally and keep an untouched copy:

```text
QA Vault/
  Start.md
  Topics/
    Field Notes.md
  Assets/
    sample.png
```

In `Start.md`, add a heading, a checkbox, a fenced code block, `#qa`, `[[Field Notes]]`, and `![[sample.png]]`. In `Field Notes.md`, add a heading, a table, and `[[Start]]`. Use a small image you created. Add a unique text marker per run to distinguish current data from earlier imports.

## P0 — Run first

| ID | What to do | Expected result |
|---|---|---|
| B01 Signup | Open the candidate in a fresh browser profile. Sign up with the approved method, complete confirmation if prompted, sign out and back in. | Confirmation instructions are clear and the account can reach its own workspace after sign-in. |
| B02 Import | Import the synthetic vault. Read the import summary. Open both notes, follow their internal link, and inspect the nested note and image. | Supported content and links survive. The summary accurately reports skipped or failed items. |
| B03 Collaborate | As owner, invite the second account as an editor. Open the same page in both profiles, make different edits, then reload both. Repeat with a viewer on a separate test page. | Both editor sessions converge and edits survive reload. The viewer can read and cannot edit. |
| B04 Offline and reconnect | On an already opened test page, disconnect one editor, type a unique marker, reconnect, then check both profiles and reload. | The sync indicator reflects connectivity and pending changes. The marker appears once and survives reload. |
| B05 Export | Export the workspace as Markdown after collaboration. Open the exported files locally and compare headings, checklist, code, links and image references with the source and the latest edits. | The export opens, includes the latest content and preserves supported structure. Any omissions are reported clearly. |
| B06 Access | Open a private page URL in a fresh signed-out profile. If public sharing is part of this build, check a separately published synthetic page. | The private page reveals no note content. The published page renders read-only. |

## P1 — Workbench and accessibility

| ID | What to do | Expected result |
|---|---|---|
| W01 Navigation | Open the workspace, editor, graph and settings. Navigate back and forth and follow a page link. | Navigation reaches the intended page and preserves edits. Graph links open the correct notes. |
| W02 Search and capture | Open global search and quick capture from desktop shortcuts and the mobile menu. Search for a fixture note. Close each panel with Escape on desktop. | The correct result opens. Focus returns to the trigger on close. An unsaved capture draft survives reopening. |
| W03 Editing | On Android, open More formatting and try heading, color and link actions. Open the keyboard and check panel scrolling. On wide desktop, inspect the editor and its context panel. | Nested controls remain visible and tappable. The keyboard leaves a usable editor and the context panel does not overlap text. |
| W04 Layout | Check light and dark themes at desktop and mobile sizes. Spot-check widths of 320, 375, 414, 768, 1024 and 1440 px in browser emulation. | Primary controls and content stay reachable without clipping or unintended horizontal scrolling. Record deviations with screenshots. |
| W05 Accessibility | Use keyboard-only navigation, 200% browser zoom, reduced motion and a screen reader. Open and dismiss menus and dialogs. | Focus stays visible and returns sensibly on close. Controls have useful spoken names. Text and controls stay legible and usable. |
| W06 Responsiveness | Record slow startup, search, page opening or typing. Include whether it was the first load, the device and approximate timing. | Note repeatable delays and capture a recording where possible. Engineering can compare measured traces with the release performance budgets. |

## P1 — Failure and recovery checks

| ID | What to do | Expected result |
|---|---|---|
| R01 Sign-in errors | Submit a wrong password in the test profile. Retry correctly. | The failure is clear, inputs remain usable, and the correct retry succeeds. |
| R02 Re-import | Import the same fixture twice in a disposable workspace. Compare page counts and the two reports. | Import reports whether pages were added, skipped, or replaced. Existing edits are never silently overwritten. |
| R03 Invitation states | If the owner provides fixtures, open a pending invitation while signed out, then an expired or revoked one. | Sign-in continues the valid invite flow. The unavailable invite gives a recovery message without leaking a private page title. |
| R04 Save and retry | Edit a synthetic page, open and close navigation, search and history, then reload after sync confirms. | Editor content survives UI changes and reload. A disconnected client shows a pending or offline state until sync recovers. |
| R05 Settings and keyboard | Open settings, move across tabs using arrows, then navigate a graph link via its list. | Selected tab and keyboard focus agree. The list provides a keyboard path to open the page. |

## Evidence and exit criteria

1. Run B01–B06 on desktop Chrome. Run the core flow, W03, and mobile navigation on physical Android Chrome. Use emulation for the other requested widths and record which widths were emulated.
2. Run W01–W06 and R01–R05 for the Workbench candidate. Capture matching desktop and mobile screenshots in both themes. For screen reader checks include the actual device, screen reader and any missing names or announcements.
3. Record the observed result for each role, platform and case. A **Fail** means you executed the case and observed a mismatch. A **Blocked** case has a missing prerequisite, such as mail, a second account or a fixture. Use **Not run** for work you did not attempt.
4. A candidate is ready for release review when the P0 cases pass on the assigned platforms and there are no unresolved release-blocking findings. Record any remaining P1 findings and their disposition. Retest fixes on the new build, rerun related P0 cases, and keep previous evidence tied to its original build.

## Report your results

Send a run summary with the build ID and each case marked **Pass**, **Fail**, **Blocked** or **Not run**. Include a reason for blocked or unrun checks. Flag data loss, unintended access, and a broken core flow to the release owner as soon as you reproduce them.

Use one report per defect:

```text
Title:
Case ID and build:
Environment (URL, device, OS, browser, viewport, theme):
Test role and setup:
Steps to reproduce:
Expected:
Actual:
Frequency:
Impact:
Evidence (screenshot or recording):
```

Remove credentials, session tokens, invitation URLs and personal information from evidence before sharing it.

## Detailed end-to-end coverage

Run Go/No-Go cases against a deployed release candidate with real QA mail, database and sync services. Fixture-driven tests may cover errors, loading states and visual variants. Label those results **fixture** and rerun the applicable core path against the deployed stack. Use separate accounts for permission checks and a signed-out profile for public routes.

| Project ticket | Cases | Required environment |
|---|---|---|
| QA-E2E-01 Account and first run | B01, A01–A04, R01 | QA inbox and new account |
| QA-E2E-02 Import and export | B02, B05, I01–I04, R02 | Disposable workspace and synthetic vault |
| QA-E2E-03 Sharing, sync and permissions | B03, B04, B06, C01–C05, R03–R04 | Owner, editor and separate signed-out profile |
| QA-E2E-04 Workbench and editor | W01–W02, W07–W12, R05 | Workbench candidate with seeded pages |
| QA-E2E-05 Mobile and accessibility | W03–W05, M01–M03 | Physical Android, desktop, screen reader |
| QA-E2E-06 Performance and resilience | W06, P01–P04 | Instrumented candidate and representative fixtures |
| QA-E2E-07 Public surfaces and optional integrations | X01–X05 | Approved preview and any explicitly enabled sandbox services |
| QA-E2E-08 Release evidence and retest | All in-scope cases | Final build, defect log and evidence index |

### Account and first run

| ID | Steps | Acceptance criteria |
|---|---|---|
| A01 Public and signed-in entry | Visit the home page signed out. Sign in, return to the home page, then sign out and reload it. | Signed-out visitors see the public home page. Signed-in users reach their workspace. Sign-out removes access to private content. |
| A02 Confirmation and input errors | Submit invalid signup fields. Register a fresh approved address, then use its confirmation link. Replay the link from a fresh profile. | Validation is clear and preserves appropriate input. Confirmation reaches the intended destination. Reuse gives a safe result and creates no duplicate account or workspace. |
| A03 Recovery | For a disposable account, request a password reset through the QA inbox. Set a new password and verify sign-in. Test an expired or used link if a fixture is supplied. | A valid reset permits login with the new password. The old password fails. Invalid reset links offer a safe recovery path. |
| A04 Empty first run | Load a new workspace, create a page and reload. | Empty state offers a useful next action. Exactly one page is created and remains available after reload. |

### Import and export

| ID | Steps | Acceptance criteria |
|---|---|---|
| I01 Supported entry points | In separate empty workspaces, import a single Markdown file, a vault ZIP, and a vault folder on a supported desktop browser. | Each exposed mode imports the expected pages once. The report identifies deliberate limitations and failures. |
| I02 Failed import | Try an unreadable or invalid ZIP and cancel a file selection. Follow with a valid import. | Failure is actionable, cancellation leaves existing data intact, and retry succeeds without unexpected duplicates. |
| I03 Fidelity and round-trip | Add metadata, links, an unresolved link, an image, code, tasks and a table. Export after editing. Reimport supported output into a second disposable workspace. | Compare content, links and attachments by opening them. Supported content survives. Import/export reports account for degradation or missing content. |
| I04 Cold export | After edits have synced, close both editors. Use a clean browser profile and export the workspace without opening its pages first. | Export includes the latest text. An unavailable body is reported instead of silently exported as empty. |

### Sharing, sync and permissions

| ID | Steps | Acceptance criteria |
|---|---|---|
| C01 Invitation lifecycle | Invite the second account as editor. Follow the invite while signed out and complete sign-in. Reopen the same link. | The valid invite leads to the intended page. Reopening does not create a duplicate membership. |
| C02 Live convergence | Edit distinct paragraphs concurrently from two profiles and watch the remote profile before reload. Reload both afterward. | Both clients converge without reload and retain both edits afterward. |
| C03 Change or revoke access | Change the collaborator from editor to viewer, then revoke access on a disposable page. Check a fresh tab and an already-open tab after the documented refresh/reconnect behavior. | After the role change settles, viewer edits cannot persist. After revocation, the old collaborator cannot read newly saved private content or persist writes. Check owner state independently. |
| C04 Offline truthfulness | Disconnect an already-open page, edit, reconnect and follow the status through recovery. Repeat once with the peer editing while disconnected. | Offline or pending status stays truthful. Each unique marker appears once in the converged page and persists after reload. |
| C05 Public and legacy URLs | Open a public synthetic page signed out, then a private page. If the build supports legacy links, open the corresponding legacy route. | Public content is read-only. Private content and titles stay hidden. Legacy redirects preserve the page identity and access rules. |

### Workbench and editor

| ID | Steps | Acceptance criteria |
|---|---|---|
| W07 Workspace actions | Create, rename and open disposable pages. Cancel deletion once, then confirm deletion of a labeled throwaway page. | Each action targets the intended page. Cancel preserves it and confirmed deletion removes only that page. |
| W08 Links and navigation | Add a wikilink, follow it, open backlinks, and return using browser Back. Try an unresolved link. | Correct page opens, backlink points to its source, and unresolved links behave consistently with the UI affordance. |
| W09 Editor and history | Edit a page with formatting, tasks, a table and a code block. Open and close editor panels. If version history is available, preview and restore a disposable checkpoint. | Text survives panel changes and reload. Preview leaves current text intact. A confirmed restore produces the selected version and preserves recoverable history where supported. |
| W10 Dashboard states | With supplied fixtures, open loading, empty, populated and error states. Retry a failed read. | States have distinct labels. Retry succeeds when the fixture recovers and creates no extra pages. Controls remain usable at narrow widths. |
| W11 Search and capture errors | With fixtures, trigger a failed search, retry, and type a new query before the old result returns. Save a capture, then simulate a failed save and retry. | Stale results cannot navigate to the wrong page. Failed capture keeps the draft. A successful retry creates a single entry. |
| W12 Graph and settings | Navigate the graph through its visual and keyboard paths. Open settings, switch tabs, and exercise a safe preference. | Graph and list open the same intended page. Settings tabs retain focus and announce selection. Confirmed preference survives reload where designed to persist. |

### Mobile and accessibility

| ID | Steps | Acceptance criteria |
|---|---|---|
| M01 Physical Android | On Android Chrome, open navigation and editor sheets, type near the bottom using the real keyboard, and rotate or resize the viewport. | Caret and actions stay reachable. No usable control is clipped or covered. Text remains intact. |
| M02 Keyboard and announcements | Tab through signup, workspace, editor and settings. With TalkBack or a desktop screen reader, check labels, dialog names, errors and sync announcements. | No keyboard trap. Modal focus stays inside appropriately and returns on close. Spoken labels and errors identify the control or state. |
| M03 Visual matrix | Compare both themes at 320, 375, 414, 768, 1024 and 1440 CSS px. Check 200% zoom and reduced motion. Log route, state, role, viewport, screenshot and deviation. | Core actions remain usable without unintended overflow. Focus remains visible. Flag contrast failures with rendered color measurements when available. |

### Performance and resilience

| ID | Steps | Acceptance criteria |
|---|---|---|
| P01 Boot and page open | Measure boot to interactive, warm page open and cold browser-storage page open using the supplied instrumentation. Record hardware, cache state and raw samples. | Compare with targets of under 1 s boot, 100 ms warm open and 300 ms cold open. Mark unmeasured targets unverified. |
| P02 Typing and search | Capture typing latency on a representative page and search key-to-render latency in a seeded 10,000-page workspace. | Compare with targets of under 16 ms typing and 200 ms search. Record fixture size, timing boundaries, sample count and raw results. |
| P03 Network and session recovery | With an approved fixture, cause a read error or session expiry while editing. Recover using the visible retry or sign-in route. | The UI shows the failure honestly and keeps recoverable work. Recovery returns to the intended workspace without duplicate writes. |
| P04 Monitoring evidence | Give engineering occurrence time and sanitized request identifiers for a repeatable QA failure. Use a dedicated monitoring test fixture if supplied. | Engineering can correlate the QA event with the expected telemetry. Evidence contains no note contents or secrets. |

### Public surfaces and optional integrations

| ID | Steps | Acceptance criteria |
|---|---|---|
| X01 Public pages | Open home, early access, pricing if linked, help and legal links on desktop and Android. | Links lead to intended pages and remain usable. Public copy matches the enabled build. |
| X02 Early access | With approved QA mail and waitlist enabled, sign up and confirm. Retry with the same address. | UI states agree with confirmed status. A repeated signup does not create duplicate entries or misleading success. |
| X03 Billing sandbox | Only when assigned a sandbox, use the existing billing QA checklist for test checkout, entitlements, cancellation and failure recovery. | Status and access match provider test events. No production payments occur. See [billing manual QA](29-billing-manual-qa.md). |
| X04 AI sandbox | Only when assigned a test provider, request a small synthetic edit, preview it, reject once and apply once. Simulate an unavailable provider. | Rejection leaves content intact. Apply changes only the intended text. Failure is visible and leaves the editor usable. |
| X05 Notion sandbox | Only when assigned an authorized test integration, connect to a test workspace, push a synthetic page, then disconnect. | The intended page appears once in the selected location. Connection state reflects disconnection. Report unsupported or blocked live paths explicitly. |

### Release evidence and retest

Submit one row per case and environment using this shape:

| Case | Build | Browser/device and role | Result | Evidence or blocker | Defect and retest |
|---|---|---|---|---|---|
| B03 | Commit or build ID | Desktop Chrome, owner and editor profiles | Pass / Fail / Blocked / Not run | Redacted screenshot or recording | Private defect link and retest build |

Create or link a private project defect for each reproducible failure. Use `[QA][Case ID] Short symptom` as the title and the template above as the body. Note whether the issue blocks the release, the workarounds, and which other cases need rerunning. Keep workspace-specific evidence in the approved private location. A skipped or blocked core case remains unverified. Request release review only after the release owner can trace each required pass and retest to the candidate being shipped.
