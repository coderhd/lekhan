---
tags: [decision, process, standup, retro]
status: decided
date: 2026-11-02
---

# Daily Standup: permanent blocked-column SLA sweep (rule 1 runtime owner)

**Decision:** the blocked-column SLA (rule 1 of [[01-weekly-retro-hygiene-rules]]) moves
from the weekly retro into the **Daily Standup** runbook as a standing facilitation item,
owned by the **Product Owner**. Source: retro rule [[03-runtime-enforcement-for-retro-rules]] §1 —
"A rule enforced only at the retro ritual decays by the next morning."

## The sweep (added as agenda item 4 of the Daily Standup routine)

Every standup, the facilitator walks every issue currently in `blocked`:

1. **Stale residue ≤ 24h.** An issue whose blockers are all `done`/removed, or which is
   `blocked` with no first-class blocker at all, must be cleared within 24 hours: give it
   a real `blockedByIssueIds` edge (first-class, preferred) or re-dispatch it to `todo`.
2. **Blocked > 7 days ⇒ named unblock owner + concrete action.** The issue must carry an
   `unblockDescriptor` naming the owner agent and the concrete unblocking action.
   Free-text "blocked by X" is not a path.
3. **No chain may block on unstarted work.** A blocker in `backlog` is a sequencing
   defect: either schedule the blocker or descope the dependent.

## Ownership split

- **Daily Standup (Product Owner):** *performs* the sweep, records fixes in the standup summary.
- **Weekly retro:** *verifies* the sweep ran; it no longer performs it
  ([[03-runtime-enforcement-for-retro-rules]] §1).

## Routine edit

The Paperclip routine `Daily Standup` (id `a8a3bfdd-ed78-4c5e-b056-440e1ef2b79a`,
description revision 12 → 13 at the 2026-11-02 sweep, [SIL-174](/SIL/issues/SIL-174))
carries the wording above; this document is the durable record.

**Related:** [[01-weekly-retro-hygiene-rules]], [[02-sprint-planning-label-checklist]],
[[03-runtime-enforcement-for-retro-rules]], [[README]]
