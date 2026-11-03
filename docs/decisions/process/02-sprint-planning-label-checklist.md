---
tags: [decision, process, planning, sprint]
status: decided
date: 2026-10-27
---

# Sprint planning runbook: label integrity checklist

**Decision:** the sprint-label verification loop (rule 2 of
[[01-weekly-retro-hygiene-rules]]) is part of the sprint planning runbook itself.
Every Sprint Planning facilitator run executes this checklist; a planning issue
may not close until step 5 is green. Source: [SIL-114](/SIL/issues/SIL-114),
from the 2026-10-27 weekly retro.

## Background

Twice this month, label writes expressing the sprint commitment collided with
live assignee-run checkout locks and the follow-up was cancelled instead of
re-run — so the commitment lived only in a comment ([SIL-81](/SIL/issues/SIL-81)
on 10-08, [SIL-98](/SIL/issues/SIL-98) on 10-25). Committed-vs-done at retro is
measured from labels only, so an unlabeled commitment silently shrinks the
sprint.

## Runbook (executed every planning run)

1. **Estimate before comment.** For every issue committed to `sprint:<YYYY-Www>`,
   decide `est:<1|2|3|5|8>` and carryover status (`rollover` if it moved in
   unfinished) *before* posting the plan comment. The plan comment records the
   estimates for discussion — it is not the destination for them.
2. **Apply labels in-run, immediately after the commit list is fixed.** For each
   committed issue write the label ids directly (`est:*` + `sprint:<YYYY-Www>`
   [+ `rollover`] — never comments-only, never "label it later").
3. **Retry until the write lands.** A label write rejected by a live-run
   checkout lock (`403`/`409`) is a *pending write*, not a deferred decision:
   re-apply on the next heartbeat until the issue's label list shows the label.
   If a second planning object would supersede the label instead (e.g. a
   rollover at sprint review), record that on the issue as the new decision and
   apply the superseding labels — never leave the first estimate in a comment
   as the only record.
4. **Verify before closing the planning issue.** Check every committed issue's
   actual label list (via the tracker, not the plan comment): each committed
   issue carries `sprint:<YYYY-Www>` **and** one `est:*`. Use the label-scoped
   query to spot check:
   - filter by the sprint label (`issues?labelId=<sprint-label-id>`) and
     reconcile the returned set against the committed list — no extra, no missing.
5. **Close only when step 4 is green.** If any write is still failing, the
   planning issue stays `todo`/`in_progress` with a comment naming the exact
   pending write; it does not close with a "recorded in comments" note.

## Retro DoR

At the weekly retro, `committed vs done` counts **labeled issues only**. An
issue with an estimate recorded only in a comment or a document does not count
as committed; a discovered gap is reported as a **planning defect** on the retro
record, not silently patched at retro time.

## Failure precedent (log, do not repeat)

- **W41:** label writes collided with a running agent on 10-08
  ([SIL-81](/SIL/issues/SIL-81)); not re-run, introduced the comment-only gap.
- **W44:** planning on 10-25 ([SIL-98](/SIL/issues/SIL-98)) recorded
  [SIL-3](/SIL/issues/SIL-3) (est:3) and [SIL-70](/SIL/issues/SIL-70) (est:2)
  in the plan comment only; label writes were locked out, the follow-up was
  cancelled and the labels only landed on 10-27 (SIL-3 via retro action
  [SIL-114](/SIL/issues/SIL-114): est:3 + `sprint:2026-W44`; SIL-70 superseded by the
  sprint-review rollover to `sprint:2026-W45` / est:3).

**Related:** [[01-weekly-retro-hygiene-rules]], [[README]]
