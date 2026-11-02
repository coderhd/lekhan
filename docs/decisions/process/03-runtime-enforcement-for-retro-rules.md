---
tags: [decision, process, retro]
status: decided
date: 2026-11-02
---

# Runtime enforcement for retro rules: rule owners, label checklist on every commit path, executable commitment unit

**Decision:** three process rules adopted at the 2026-11-02 weekly retrospective
(window 2026-10-27 → 2026-11-02, closing out `sprint:2026-W44`). Each addresses a
way the 2026-10-27 rules ([[01-weekly-retro-hygiene-rules]],
[[02-sprint-planning-label-checklist]]) failed to survive the week between retros.
Source: weekly retro [SIL-168](/SIL/issues/SIL-168).

## Background

The 10-27 rules held where a runbook step existed and decayed where the rule had
no owner between retros:

- **Decayed — blocked-column SLA (rule 1).** Within 48h of the hygiene sweep
  ([SIL-113](/SIL/issues/SIL-113)), [SIL-4](/SIL/issues/SIL-4) and
  [SIL-93](/SIL/issues/SIL-93) entered `blocked` with **no first-class blocker at
  all** — the exact SIL-99 class rule 1 bans. [SIL-9](/SIL/issues/SIL-9) has sat
  blocked 26 days and still chains a `done` blocker
  ([SIL-58](/SIL/issues/SIL-58)) plus two `backlog` blockers
  ([SIL-62](/SIL/issues/SIL-62)/[SIL-63](/SIL/issues/SIL-63)) — against "no
  chain may block on unstarted work". Four of six blocked issues carry
  done-blocker residue (~52 issue-days total on the pile).
- **Decayed — sprint-label integrity (rule 2), via a new path.** The Observer
  sprint top-up ([SIL-151](/SIL/issues/SIL-151),
  [SIL-158](/SIL/issues/SIL-158)) committed SIL-93 and SIL-4 to
  `sprint:2026-W44` without `est:*`. The planning checklist binds the planning
  ritual only; commit writes from top-up/courier runs are unbound. Logged as
  planning defects on the retro record per the Retro DoR, not silently patched.
- **Held — where a runbook step existed.** Retro actions
  [SIL-112](/SIL/issues/SIL-112)–[SIL-116](/SIL/issues/SIL-116) all closed
  within three hours of creation; the planning-path label loop (02) landed its
  labels.

## 1. Every rule gets a runtime owner

A rule enforced only at the retro ritual decays by the next morning.

- The blocked-column SLA moves into the **Daily Standup checklist** (owner:
  Product Owner, weekly sweep): stale residue clears within 24h; blocked > 7d
  names an unblock owner + concrete action; no chain blocks on `backlog` work —
  schedule the blocker or descope the dependent.
- The retro **verifies** the sweep ran; it no longer *performs* it.

## 2. Label verification binds every commit path

`est:*` + `sprint:<YYYY-Www>` is required of **every** write that commits work to
a sprint — planning ritual, sprint top-up, courier pull, or manual update. One
checklist, all writers. A commit label without its estimate is a planning defect
wherever it lands.

## 3. Commitment unit is the executable issue

Epics carry `est` for sizing but may hold a `sprint:` label **only alongside at
least one committed child issue**. A sprint whose committed set is all-epics is a
planning defect: on 10-29 the Observer found "zero committed execution work" in
W44 while 21 of 24 committed points sat in epics that cannot close in a week.
W44 delivered 3/24 pts.

**Related:** [[01-weekly-retro-hygiene-rules]], [[02-sprint-planning-label-checklist]], [[README]]
