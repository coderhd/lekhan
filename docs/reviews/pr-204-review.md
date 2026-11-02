# PR #204 — Clean-Room Review (DN-T2, epic #39)

**Date:** 2026-11-02
**Reviewer:** independent clean-room reviewer subagent (fresh context, read-only)
**Scope:** DN-T2 commits on `feat/204-dn-t2-quick-capture` (stacked on PR #182 / DN-T1)
**Spec:** `docs/superpowers/specs/2026-11-02-h1-daily-notes-quick-capture-inbox-design.md` §DN-T2

## Verdict

**Initial: REVISE** — one blocker (viewer-target captures silently dropped but reported as
successful) plus spec/a11y/security medium findings.
**After fixes: APPROVE** — the blocker and every accepted medium finding are fixed; findings that
remain are documented limitations or follow-ups. Full suite, typecheck, lint, and build re-run green.

## Findings and disposition

### BLOCKER

1. **Viewer-target captures are silently discarded but reported as successful.**
   The page picker surfaces shared read-only pages; the sync hub admits viewers and drops their
   update frames without closing the socket, so `flush` returned, the palette closed, and the toast
   said "Captured to …" for a lost write.
   **Fixed:** the palette resolves the chosen page's owner/role (`fetchPageDetails` +
   `fetchPageMemberRole`) and refuses capture with a `forbidden` message before opening the socket;
   the draft stays in the input for retry. Covered by a new component test. The daily-page path is
   unaffected (the page is created by the acting user's workspace).

### MEDIUM

2. **Capture was a second, hand-rolled writer of the editor's Yjs schema; the plan described a
   headless-editor design that was not built.**
   **Partially fixed / documented.** A headless Collaboration editor was implemented first and
   rejected: y-prosemirror appends its required leading block into the fragment on creation
   (`_forceRerender` → `replaceWith` with a doc node), which would inject artifact headings on
   every capture. The shipped path writes the same Y tree (`heading`/`bulletList`/`listItem`/
   `paragraph` + `Y.XmlText`) in one transaction; the undocumented `tight` attribute was removed.
   A unit test binds a real `@tiptap/y-tiptap` Collaboration editor to the result and asserts the
   bullets render, guarding the schema contract. The plan was rewritten to describe the shipped
   design and the reason for it.
3. **Seeding the page title into the body H1 duplicates the title in markdown exports.**
   **Fixed:** an empty page now seeds an empty leading heading, matching `EMPTY_PAGE_DOC` and
   `stripAutoHeading`; the title stays in `pages.title`/frontmatter.
4. **10s sync timeout is shorter than the documented ~50s hub cold start.**
   **Fixed:** the timeout is 60s (matching `useEditorCollab`'s grace), and a transient
   `connection-error` no longer rejects immediately — y-websocket retries and the timeout is the
   single failure seam. The palette announces that the sync server may be waking.
5. **Page picker used an invalid `listbox`/`option` pattern.**
   **Fixed:** dropped the listbox roles and kept plain labelled buttons, matching the existing
   global-search palette that passed the #79 bar. Arrow/Enter navigation and the visual highlight
   remain.
6. **The "two-collaborator" e2e uses one account; the production socket path has no always-on test.**
   **Partially fixed / documented.** The spec now carries an explicit `limitation` annotation and a
   comment explaining that it proves live CRDT visibility, not `page_members` admission (a second
   seeded account plus a share step is required for that). The production connector contract
   (room, token/documentId params, sync wait, teardown) is now covered by an always-on unit test
   with a mocked `y-websocket`.

### LOW

7. **Pick mode left an active Capture button that ignored the pending target.**
   **Fixed:** the footer hides Capture while the picker is open; a test asserts it.
8. **Concurrent first captures can duplicate the title/Inbox heading.**
   **Accepted (documented).** Yjs cannot make a check-then-insert atomic across clients. This is
   the same convention-level race as DN-T1's duplicate-daily-page window; the epic's normal path
   (the page exists after the first capture) is single-section.
9. **`server/persister.js` `getText('default')` throws for editor documents, so nothing is
   graph-indexed.**
   **Fixed:** the persister now falls back to walking the `XmlFragment` (structural checks, so CJS
   and ESM builds of yjs agree) and joins block text with newlines; a regression test persists a
   Collaboration-style doc and asserts `#inbox`/`[[links]]` reach the indexer. This is required for
   DN-T3's inbox count and for the spec's "graph index derives links/tags as usual".
10. **Committed plan was stale.**
    **Fixed:** `docs/superpowers/plans/2026-11-02-h1-daily-notes-quick-capture.md` now matches the
    shipped code and records the headless-editor rejection.

## Verification after fixes

```text
npm run typecheck   ✅
npm run lint        ✅
npm test            ✅  (98 files, 902+ tests; see the PR run for the exact count)
npm run build       ✅
```

Playwright specs are env-gated (`E2E_EMAIL`/`E2E_PASSWORD`) and were not executed in this
environment; they are documented in the spec and are not part of `npm test`.

## Post-review fixes (external Pullfrog review on PR #185)

- **Inline finding (index spaces):** `sectionEnd` was an index into the filtered `Y.XmlElement`
  list but was passed to `fragment.insert`, which positions over all raw children. Fixed in
  `299a2e4` by carrying each element's raw index and adding a mixed-children regression test; the
  Pullfrog review otherwise reported "no critical issues".
- **Keyboard note:** Chrome honours the page's `preventDefault()` for `Ctrl+Shift+C`; Firefox
  reserves it for the node picker and may not allow the page to override it. The dashboard Capture
  button is the documented non-keyboard path; the shortcut itself is spec-locked.
- **CodeRabbit nitpicks (fixed):** Playwright `ControlOrMeta+Shift+C` replaces the manual
  `process.platform` branch; the palette shortcut now also matches `event.code === 'KeyC'` (non-Latin
  layouts) and rejects `AltGr` (`altKey`) combinations, with a regression test.

## Residual risks (accepted)

- Concurrent first captures on a brand-new page can seed two Inbox sections (finding 8).
- The capture is fire-and-forget after the socket flush: there is no per-update application-level
  acknowledgement. The pre-connect permission check removes the known silent-drop case (viewers);
  a role revoked mid-capture still relies on the hub's viewer guard.
- "Two collaborators" is exercised as two authenticated contexts on one account (finding 6);
  page_members admission remains covered by the existing editor-collaboration suite.
