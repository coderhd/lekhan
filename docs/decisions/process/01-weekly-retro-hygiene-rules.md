---
tags: [decision, process, retro]
status: decided
date: 2026-10-27
---

# Weekly retro hygiene rules: blocked-column SLA, sprint-label integrity, bot-fixture parity

**Decision:** three process rules adopted at the 2026-10-27 weekly retrospective
(window 2026-10-20 → 2026-10-27, closing out `sprint:2026-W41`). Each rule exists
because the same failure class showed up at least twice this month and cost real
cycle time. Source: weekly retro [SIL-105](/SIL/issues/SIL-105).

## 1. Blocked-column SLA

A `blocked` issue is a promise about unblocking, not a parking spot.

- **Stale residue clears within 24h.** An issue is stale when its blockers are all
  `done`/removed (e.g. SIL-60 sat blocked behind the completed SIL-64) or when it is
  `blocked` with no first-class blocker at all (e.g. SIL-99). Re-dispatch it to `todo`
  or give it a real blocker — never leave it in limbo.
- **Blocked > 7 days ⇒ named unblock owner + concrete action.** Prefer first-class
  `blockedByIssueIds`; free-text "blocked by X" is not a path. At the retro the pile
  was 12 issues / ~102 issue-days, three of them ~20 days old.
- **No chain may block on unstarted work.** A blocker in `backlog` (SIL-61 blocking
  SIL-62/SIL-63) is a sequencing defect: either schedule the blocker or descope the
  dependent.

## 2. Sprint-label integrity

`committed vs done` is measured from labels only — so the labels must be real.

- An issue counts toward sprint commitment only with both `sprint:<YYYY-Www>` and
  `est:<1|2|3|5|8>`.
- The planning facilitator **verifies the labels actually landed** before closing the
  planning issue, with a retry loop for writes rejected by live-run checkout locks.
  Label writes collided with running agents twice (SIL-81 on 10-08, SIL-98 on 10-25)
  and the follow-up was cancelled instead of re-run, leaving estimates recorded only
  in comments.
- Label gaps found at retro are reported as a planning defect, not silently patched.

## 3. Bot-fixture parity in the definition of done

Review bots (CodeRabbit, pullfrog) must not be the first gate that can catch a
defect class.

- Before requesting review, the PR's own test suite covers the fixture classes the
  review bots check — content-loss at boundaries (frontmatter-only paste, direct text
  nodes in containers, per the 8 findings on PR #134 that survived dev self-check,
  QA dogfood, and clean-room review).
- Any bot finding class that escapes our internal gates **twice** becomes a permanent
  fixture in the suite and is added to `docs/agents/sdlc-workflow.md` DoD.

**Related:** [[README]], `docs/agents/sdlc-workflow.md`
