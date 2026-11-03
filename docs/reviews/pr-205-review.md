# PR #205 — Clean-Room Review (DN-T3, epic #39)

**Date:** 2026-11-02
**Reviewer:** independent clean-room reviewer subagent (fresh context, read-only)
**Scope:** DN-T3 commits `01f5e36`, `e838230`, `bfdab23` on `feat/205-dn-t3-inbox`
(stacked on DN-T2 PR #185 / DN-T1 PR #182)
**Spec:** `docs/superpowers/specs/2026-11-02-h1-daily-notes-quick-capture-inbox-design.md` §DN-T3

## Verdict

**Round 1: REVISE.**
**After fixes: APPROVE pending the external PR reviewers** — every BLOCKING/HIGH/MEDIUM finding
is fixed or explicitly scoped; the remaining items are documented limitations. Typecheck, lint,
full suite (103 files / 967 tests), and build are green.

## Round 1 findings and disposition

### BLOCKING

1. **Dialog test could not load without Supabase env.**
   **Fixed:** `tests/unit/inbox-triage-dialog.test.tsx` mocks `@/lib/supabase`; the file loads
   with all `NEXT_PUBLIC_SUPABASE_*` unset.

### HIGH

2. **Stale row identity could rewrite the wrong capture after a collaborator edit.**
   **Fixed:** `replaceInboxRowText` / `deleteInboxRow` require the row text at `pos` to match
   the captured text; `linkInboxRow` / `tagInboxRow` live in `lib/inbox-triage-actions.ts` with
   stale-row tests (`inbox-triage-actions.test.tsx`).
3. **`o` appended to the target before rewriting the row → duplicate back-reference on retry.**
   **Fixed:** the row is rewritten first; a failed target append restores it; the target append
   is idempotent by bullet text (`appendBulletToSectionToYDoc`), so retries cannot duplicate.
4. **Dashboard InboxCard did not refresh after a dashboard capture.**
   **Fixed:** the palette dispatches `lekhan:inbox-changed`; the card refetches immediately and
   retries at 2.5 s / 6 s (the hub indexes on its idle debounce), plus focus/visibility.

### MEDIUM

5. **H3 subheading inside Inbox disabled triage below it.**
   **Fixed by scoping:** triage is section-agnostic on `#inbox` list/task rows; the count and the
   keyboard actions now agree for bullets. The design/plan docs were corrected to say so.
6. **Count included prose/non-Inbox lines that cannot be triaged.**
   **Scoped:** the count is the `#inbox` line set in daily pages; the UI now triages every
   `#inbox` list/task row on any page. Prose `#inbox` remains countable/editable in the body.
7. **`#inbox` boundary differed from the graph tag grammar (`#inbox*`).**
   **Fixed:** `/(?:^|\s)#inbox(?![a-zA-Z0-9_\-/])/i`, with tests for `#inbox*`, `#inboxing`,
   `#inbox_notes`.
8. **Arrow-key page selection invisible / unannounced.**
   **Partly fixed:** the active row scrolls into view, carries `aria-current`, and an `aria-live`
   region announces it. The quick-capture palette deliberately avoids the invalid
   listbox/option pattern (see PR #204 review), so plain labelled buttons stay.
9. **Tag grammar was only validated after submit.**
   **Fixed:** the dialog disables Add tag, marks `aria-invalid`, shows the grammar hint, and
   Enter is a no-op for invalid input.
10. **An H3 `Inbox` heading was treated as the capture target.**
    **Fixed:** section matching requires heading level ≤ 2; a new test proves a new H2 section is
    created instead.
11. **No test covered the `o` write path.**
    **Fixed:** `tests/unit/inbox-triage-actions.test.tsx` covers happy path (row + target
    section), forbidden target, stale row, compensation on append failure, and tag add/reject.

### LOW (selected)

- Empty-state copy no longer claims tagging clears the inbox.
- Badge has an accessible label and reflects loading/error.
- `stripInboxTag` preserves intentional internal spacing (collapses runs, not newlines).
- Multi-paragraph rows are detected (`textBetween` with `\n`) and replaced whole.
- Duplicate tag reports "Already tagged" instead of a false success.
- Shift+Delete (cut) no longer deletes the row.
- `InboxPageRow` renamed to avoid shadowing the triage row type.

## Round 2 findings and disposition

12. **HIGH — refresh event raced the index write.**
    **Fixed:** the card retries at 2.5 s and 6 s after the event (cleared on unmount).
13. **MEDIUM — multi-block rows were undetectable because `textContent` concatenates blocks.**
    **Fixed:** rows use `textBetween(0, size, '\n', '\n')`; the guard and replace use the same
    text. Multi-paragraph and `taskItem` tests added.
14. **MEDIUM — count/actions "same set" claim was false.**
    **Fixed in docs:** spec/plan now state the count is daily-page `#inbox` lines while actions
    cover `#inbox` list/task rows on any page.
15. **MEDIUM — row-first link could lose a capture if the target append never lands.**
    **Mitigated:** target append is idempotent, so retries are safe; the row is restored on a
    rejected append. A flushed-but-lost write remains a general CRDT limitation (no server ack),
    shared with DN-T2 capture.
16. **MEDIUM — no progress state during `o`.**
    **Fixed:** the dialog takes `busy`, disables inputs/rows, and shows "Linking…".
17. **LOW — Enter bypassed tag validation.**
    **Fixed:** `submitTag` guards `tagValid`/`busy`.
18. **LOW — `ensureCanEdit` defaulted to permissive.**
    **Fixed:** it is now a required option.

## External review round (Pullfrog on PR #190)

19. **Triage matched `#inbox-2026` / `#inbox/foo` while the count did not.**
    **Fixed:** one shared matcher in `lib/inbox-marker.ts` now drives counting, triage, and
    capture. It mirrors the graph index boundary (`(^|[\s(])#inbox(?![a-zA-Z0-9_\-/])`), so
    `#inbox`, `#inbox.`, and `(#inbox)` match while longer names do not. Tests cover the
    marker directly, the count, the strip helper, and capture text.
20. **Retry button was ~24px tall.** **Fixed:** the card's retry button now uses `min-h-11`
    (44px), matching the `Open Inbox` control; the component test asserts it.

## Verification (final)

```text
npm run typecheck   ✅
npm run lint        ✅
npm test            ✅ 104 files, 974 tests
npm run build       ✅
```

Targeted clean-room reruns also pass with `NEXT_PUBLIC_SUPABASE_*` unset.

## Residual risks (accepted / documented)

- The CRDT append has no application-level acknowledgement; a flushed-but-lost target write
  leaves a linked daily row without its back-reference. The append is idempotent, so re-running
  `o` is safe, but the UI cannot detect the loss.
- Concurrent first-time links to the same target can still create two `Related actions`
  headings (convention-level race, same class as DN-T1/T2 heading races).
- Tagging a capture keeps it in the Inbox by design; triage is link/delete.
- `o`, `t`, and `Del` intentionally intercept those keys while the cursor is in a capture row.
