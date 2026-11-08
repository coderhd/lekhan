# Clean-Room Review — SIL-225

Reviewed `git diff origin/main...HEAD` on 2026-11-06, focusing on the Brevo schedule and its source copy/templates. The diff is available and `git diff --check` passes.

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & domain compliance | PASS | The date-only confirmation field now gates calendar-date thresholds without claiming elapsed-hour guarantees; dry-run workflows explicitly target the test list. |
| 2. Frontend & accessibility | PASS | Not applicable to this documentation-only change. |
| 3. CRDT & storage | PASS | Not applicable to this documentation-only change. |
| 4. Backend security & errors | PASS | No credentials found; confirmed-only import, unconfirmed-contact guards, and human-only activation are specified. |

## Findings and resolution

### 💡 [MEDIUM] Date-only attributes do not guarantee elapsed-hour delay floors — resolved

- **File:** `docs/marketing/brevo-send-schedule.md` §§2, 2.1, 5.1, 6.2–6.3.
- **Resolution:** Reframed email 2 and 3 gates as 3- and 7-calendar-date thresholds using the IST date. The document explicitly says these are not 72/168 elapsed-hour guarantees. Email 3 retains its ≥48-hour floor after email 2.

### 🔍 [LOW] The test-list dry run does not name its required test triggers — resolved

- **File:** `docs/marketing/brevo-send-schedule.md` §§8.4, 9.E.
- **Resolution:** Added explicit cloned test workflow instructions, changed all list triggers/filters to `founding_waitlist_test`, restricted sends to the internal test address, and kept production workflows inactive and unchanged.

## Acceptance notes

- The schedule table, segment conditions, weekday/window rules, tags/attributes, manual email 4, named Harsh Dave activation, and rollback/export steps are present.
- The unconfirmed-contact safety boundary is explicit across imports and email 2–4 filters.
- No API keys or credentials appear in the reviewed artifact.
- Follow-up clean-room review confirmed both findings resolved; `git diff
  --check` passes on the corrected working tree.

## Changes-requested follow-up — 2026-11-06

An independent re-review evaluated the three changes requested on SIL-225 and
then checked one timing adjustment for internal consistency. Final status:
**PASS**.

| Finding | Resolution | Result |
|---|---|---|
| Email 1 could resend to a contact whose stage was already advanced | Added the `FC_STAGE` empty-or-`confirmed` conditional split before send; dry run now checks an already-advanced contact receives no email and is not reset | PASS |
| 47-hour delay plus the next 10:00 check did not enforce 48 hours | Changed the timer to 49 hours after email 2; aligned the attribute registry, automation steps, schedule, and checklist | PASS |
| Path B import while `FC-01` was inactive would not enroll contacts retroactively | Required approval and activation of all three workflows before confirmed-only import; added manual reconciliation for any prior imports without stage resets or forced re-entry | PASS |
| 48-hour timer could become ready at the exact same time as Thursday's scheduled check | Added a one-hour buffer, changed the realistic email 3 arrival range to calendar day 8–14, and corrected the examples to wait for the next later Tue–Thu check | PASS |

The final reviewer confirmed no stale 47-hour references remain and that the
remaining 48-hour mentions describe the minimum gap. `git diff --check` passes.
The review remains documentation-only; production workflows were not built or
activated.

## Latest Tech Lead findings — 2026-11-08

The latest review requested three additional safeguards. The revised schedule
was independently re-reviewed after the final consistency edit and passed.

| Finding | Resolution | Result |
|---|---|---|
| Email 2 could follow email 1 on the same day when importing an older confirmation | Added the date-only `FC_EMAIL1_SENT_AT` gate; manual reconciliation records the verified send date; added an older-confirmation boundary test | PASS |
| Path B could overwrite advanced or activated contact state | Import map leaves workflow-managed fields unmapped, reconciles existing list members and activation records, adds a preservation test, and aligns rollback recovery | PASS |
| Corrected spec was not committed and must retain human gates | Final document and this review report are committed together; human approval and activation requirements remain explicit | PASS |
| §3 described both calendar-date gates as comparisons against `CONFIRMED_AT` | Clarified that email 2 compares `FC_EMAIL1_SENT_AT` and email 3 compares `CONFIRMED_AT` | PASS |

Four-axis summary: spec/domain **PASS**; frontend/accessibility **N/A**;
CRDT/storage **N/A**; backend/security **N/A** (documentation-only). No Brevo
workflow was built, activated, or sent.
