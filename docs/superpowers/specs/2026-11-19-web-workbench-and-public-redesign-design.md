# Lekhan web redesign proposal

The selected scope is the broader Workbench redesign and a new public-site design before manual QA. The user chose direct implementation without a mockup review.

## Public site

Lead with a real Lekhan workspace and the journey from a Markdown vault to shared writing. The landing page should explain that journey in its first screen, then show evidence from the app. Carry the same typography, spacing and navigation into About, FAQ, Contact and legal pages, with simpler layouts for reading. Apply the same visual language to sign-in and signup.

Give Early Access one clear action and explain what happens after submitting and confirming an email. Preserve referral attribution, confirmation, error states and privacy links. Describe the browser beta accurately. A local Markdown vault on macOS is a separate milestone.

## Workbench

Recover the preserved Workbench candidate and reconcile it with current main before extending it. Use a clear workspace rail and a content area that emphasizes the selected page or folder. Put **Browse** first for navigation. It uses the existing parent relationships to display expandable nested pages. **Recent** provides fast access across folders. Shared pages remain visible without requiring access to their ancestors.

Folder headings should show clear expansion affordances, and opening a page should remain a separate action. Keep the current selection visible while browsing. If a listed page has a missing or inaccessible parent, render it where the user can reach it without exposing a parent title. On narrow screens, the named navigation drawer offers Browse. Choosing it closes the drawer and moves focus to the dashboard’s in-page tree.

## Import

Group choices by source and describe the accepted input up front. Preserve the existing Obsidian folder and ZIP, Notion ZIP and Markdown handlers and browser picker fallbacks. Distinguish source selection, reading, saving, completion and error. The report should put imported pages, preserved hierarchy and warnings where testers can find them. From a completed import, provide a path back to Browse and show the imported location when the app can identify it reliably.

## Acceptance

- Compare desktop and Android screenshots of Home, Early Access, Browse and Import, including empty, loading, error and completed states where applicable.
- Import a nested synthetic vault, navigate each level, reload, and verify Recent and Shared continue to work. Verify an inaccessible parent reveals no private data.
- Run the existing signup, confirmation, import, collaboration and export scenarios on the same staging build. Include keyboard focus, responsive layout and real-device checks.
- Pass the repository verification and review gates before moving the candidate to manual QA.

## Approaches considered

The small refresh could ship a tree and improve the import picker quickly, but it leaves the public site and the authenticated experience visually disconnected. The broader approach selected here recovers the existing Workbench implementation and updates the public site as a system. It requires a full regression pass across entry, navigation, import and editing.
