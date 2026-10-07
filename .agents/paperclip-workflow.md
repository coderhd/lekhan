# Paperclip Operating Cadence — Silent Whisper / Lekhan

How the virtual org runs day to day. Companions: `docs/agents/organization.md` (roles + SDLC) and
`CONTEXT.md` (domain model); `.agents/paperclip-org.md` (roster, models, skills) and
`.agents/model-routing.md` (model policy) are added by the Paperclip setup PR.
This file documents the **cadence** — standups, sprints, retros, and working sessions — all
implemented as Paperclip **routines** (scheduled issues), plus the team's conventions.

## Cadence at a glance

| When (Asia/Calcutta) | Routine | Facilitator | Participants |
|---|---|---|---|
| Mon–Fri 10:00 | **Daily Standup** | Product Owner | all agents |
| Mon 09:00 | **Sprint Planning** | Product Owner | TL, Designer, Dev, QA, DevOps |
| Tue 11:00 | **Spec & Planning Session** | Product Owner | Tech Lead, Designer |
| Wed 11:00 | **Build & Test Session** | Tech Lead | Dev, QA, DevOps |
| Fri 16:00 | **Weekly Retrospective** | CEO | all agents + board |
| Fri 18:00 | **Sprint Review & Rollover** | Product Owner | all agents |

Paperclip has no "meeting" primitive, so a *meeting* is a scheduled routine that opens a shared
issue and wakes the named participants — they collaborate on that issue's thread (structured
`@`-mentions), then hand off.

## Daily Standup (agenda)

1. **Shipped yesterday** — issues moved to `done` / `in_review` since the last standup.
2. **Today** — each agent's single top priority (one line).
3. **Blockers** — issue + owner + the help needed; unblock or escalate.
4. **Sprint burn** — points done / committed, working days left.
5. **Decisions needed** — anything for the board/CEO.

Rules: 3 lines max per agent; the facilitator @-mentions only agents with active work (each
mention costs a heartbeat); close with a summary + numbered blocker list with owners.

## Sprints (weekly, with estimates and rollover)

Paperclip issues have no points field, so a sprint is modelled with **labels**:

- `sprint:<YYYY-Www>` — the sprint an issue is committed to (e.g. `sprint:2026-W41`).
- `est:1|2|3|5|8` — Fibonacci story-point estimate.
- `rollover` — carried over from a previous sprint.

**Boundaries:** Monday 09:00 plan → Friday 18:00 review. One week, five working days.

**Planning (Mon):** pull the top of the backlog by priority until capacity is filled; estimate each
committed issue; label it with the sprint; state the sprint goal in one sentence. Capacity is
calibrated from measured velocity after 2–3 sprints.

**Review & rollover (Fri):** every **unfinished committed** issue is moved to the next sprint's
label, tagged `rollover`, and given a one-line reason it slipped. Record a **revised remaining-work
estimate** in the rollover note for the next sprint's planning — but leave the **committed**
estimate from planning unchanged, so the velocity baseline stays stable. **Velocity = the committed
points of issues that reached `done`** (not the revised remaining estimate), so re-estimation can
never inflate it. Nothing silently disappears.

## Weekly Retrospective (agenda)

1. **Metrics** — committed vs done (points), cycle time, rollover count, escaped defects, blocked
   time, model spend.
2. **What went well** — keep doing it.
3. **What didn't** — root cause, never blame.
4. **Action items** — owner + due date; each becomes an issue.
5. **Process changes** — recorded as an ADR/decision or a doc update.

## Working sessions

- **Spec & Planning Session** (Tue) — PO + Tech Lead + Designer work one issue through
  DEFINE + PLAN: PRD → interface contract/ADR → estimated task breakdown → handed to QA.
- **Build & Test Session** (Wed) — Dev + QA + DevOps (TL facilitating) sync in-flight PRs, pair on
  failing tests, run the clean-room verification gate, prep the release.

## Roster (current)

| Agent | Role | Model |
|---|---|---|
| OpenCode Agent | `ceo` | `opencode-go/qwen3.8-flash` |
| Product Owner | `pm` | `opencode-go/glm-5.3-flash` |
| Tech Lead | `cto` | `opencode-go/qwen3.8-flash` |
| QA Engineer | `qa` | `opencode-go/qwen3.8-flash` |
| Dev Engineer | `engineer` | `opencode-go/deepseek-v4.1-flash` |
| DevOps Engineer | `devops` | `opencode-go/deepseek-v4.1-flash` |
| Growth Lead | `cmo` | `opencode-go/glm-5.3-flash` |
| **UI/UX Designer** | `designer` | `opencode-go/glm-5.3-flash` |

Frontier / Tier S work (unspec'd design, ADR-governed systems, clean-room review) escalates to
`opencode-go/mimo-v2.6-pro` via per-issue override.

## PR merge gate (external review)

A PR is merged only after **both** reviews are complete — ours and the external one:

1. **Our review** — the internal clean-room REVIEW stage passed.
2. **External review** — the Pullfrog **and** CodeRabbit checks are **`success`** (a review actually
   ran), and every actionable finding is addressed or explicitly dismissed with a reason on the PR.
   A `failed`, `cancelled`, `skipped`, or missing check is **not** completion.
3. **CI green.**

Merging while the external reviewers are still running **wastes their tokens**: the review executes
against a PR that is already merged, so its findings arrive too late to act on. If a reviewer is
rate-limited or its check fails without producing a review, wait or re-run it. If it is **genuinely
unavailable** (persistent rate limit, service down), post an **explicit waiver** on the PR naming
the reviewer and the reason — **the waiver satisfies this gate for that reviewer**, so the merge may
proceed without it. A non-`success` check alone never counts as a completed review.

This is enforced socially (see `AGENTS.md` SHIP stage) and can be enforced technically with branch
protection requiring the `Pullfrog` and `CodeRabbit` status checks.

## Proposed next improvements (not yet built)

1. **Definition of Ready / Done as gates** — a checklist routine that refuses `in_progress` until
   an issue is DoR-complete, and refuses `done` until the clean-room gate passes.
2. **Blocker watchdog** — daily check for issues `blocked` for > 1 working day; ping the owner and
   escalate to the CEO.
3. **WIP limits per role** — cap concurrent `in_progress` issues per agent (e.g. 2) to protect focus.
4. **Release train** — a Friday DevOps routine that cuts a release, tags it, and updates the
   changelog; Growth drafts the announcement from the merged PRs.
5. **Defect triage** — a routine that classifies new `defect` issues, reproduces, and assigns.
6. **Budget & spend review** — weekly OpenCode-Go request spend vs the model budgets; auto-downgrade
   a role's model when a window is > 70% spent.
7. **UI review gate** — the Designer reviews every UI-affecting PR before merge (design system +
   a11y), mirroring the clean-room code gate.
8. **Metrics dashboard** — velocity, cycle time, escaped-defect rate, rollover rate, model spend,
   surfaced as a weekly document.
9. **Security review gate** — mandatory independent review for auth/payments/encryption changes
   (ADR 0001/0003/0004).
10. **Incident/on-call routine** — a webhook-triggered routine for production alerts that opens an
    incident issue and wakes DevOps + CEO.
11. **Agent onboarding doc** — one page every new agent reads first (identity, scope, escalation).
12. **Knowledge capture** — every retro action and ADR links from the sprint goal so decisions are
    searchable.
