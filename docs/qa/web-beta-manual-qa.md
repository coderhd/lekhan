# Lekhan web beta — Manual QA handoff

Lekhan is a web workspace for writing and organizing linked notes. A **workspace** holds your pages. Pages can link to other pages or be shared with collaborators. Lekhan supports importing an Obsidian vault and exporting notes as Markdown. Workbench is the interface for finding, editing and managing those pages.

Your assignment is to test the web beta from a new user's perspective. Start with signup, import, collaboration and export. Then check Workbench on desktop and Android. The release owner will tell you which build to test and where to submit results.

## Before testing

- Ask the release owner for the QA or preview URL, build ID or commit, and two test accounts or an approved signup method. Use separate browser profiles for the owner and collaborator so their sessions stay independent.
- Use a synthetic Obsidian vault with two linked Markdown notes, one nested folder and one small image. Include a heading, checklist and code block. Keep the original files to compare against the export.
- Start in Chrome desktop. Repeat the core flow on Android Chrome where supported. Record the device, OS, browser, viewport, theme and build. Use TalkBack on Android or a desktop screen reader for the accessibility pass.
- Use only the assigned environment and synthetic data. Leave paid checkout, external integrations and production account changes to separate assignments. If setup is missing, mark the affected cases **Blocked** and keep testing the rest.

## P0 — Run first

| ID | What to do | Expected result |
|---|---|---|
| B01 Signup | Open the candidate in a fresh browser profile. Sign up with the approved method, complete confirmation if prompted, sign out and back in. | Confirmation instructions are clear and the account can reach its own workspace after sign-in. |
| B02 Import | Import the synthetic vault. Read the import summary. Open both notes, follow their internal link, and inspect the nested note and image. | Supported content and links survive. The summary accurately reports skipped or failed items. |
| B03 Collaborate | As owner, invite the second account as an editor. Open the same page in both profiles, make different edits, then reload both. Repeat with a viewer on a separate test page. | Both editor sessions converge and edits survive reload. The viewer can read and cannot edit. |
| B04 Offline and reconnect | On an already opened test page, disconnect one editor, type a unique marker, reconnect, then check both profiles and reload. | The sync indicator reflects connectivity and pending changes. The marker appears once and survives reload. |
| B05 Export | Export the test vault as Markdown after collaboration. Open the exported files locally and compare headings, checklist, code, links and image references with the source and the latest edits. | The export opens, includes the latest content and preserves supported structure. Any omissions are reported clearly. |
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
