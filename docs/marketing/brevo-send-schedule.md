# Brevo Send Schedule — Founding Cohort

Build spec for the four-email founding-cohort welcome sequence: the entry
trigger, delays, send windows, segments, tags, exit rules, and the human
send/approval gate.

**This document builds nothing and sends nothing.** No automation is created,
activated, or sent from this task. There are no API keys, tokens, SMTP
passwords, or account identifiers in this file.

| | |
|---|---|
| Copy of record | [`brevo-welcome-sequence.md`](brevo-welcome-sequence.md) — SIL-223, PR #199 (in review) |
| Templates | [`brevo/templates/`](brevo/templates/) — SIL-224, PR #201 (merged into the SIL-201 branch; issue still blocked) |
| This deliverable | SIL-225 — send schedule + automation wiring |
| Tracking contract | SIL-226 — must use the attribute names and values in §5 verbatim |
| Programme | SIL-201 |

**Dependency state (read before building).** The copy and templates are
available on the current SIL-201 work branch. Before building or activating,
confirm SIL-223 copy approval and the SIL-224 template verdict are both
resolved. The build may be prepared inactive against those files, but
**activation waits** until both dependencies are `done` and copy approval is
recorded. If either changes wording or links, re-check the templates and this
schedule before activating.

---

## 1. Non-negotiables

1. **A human activates. No automation sends without a human.** The named
   activator is **Harsh Dave (Founder, Lekhan)**. Agents may draft, review, and
   verify; they may not activate, pause, or send from the Brevo account.
2. **Double opt-in is the only entry.** A contact enters the sequence only when
   the app has recorded `CONFIRMED_AT` and the contact is on the
   `founding_waitlist` list. `FC-01` also requires `FC_STAGE` to be empty or
   `confirmed`; an already-advanced contact cannot receive email 1 again.
   Unconfirmed contacts never enter emails 1–4.
3. **Email 4 is never automated.** It carries a per-contact invite link and is
   sent by a human, in batches, from the Brevo UI.
4. **No credentials in this document.** Brevo access stays in the founder's
   account; secrets belong in the secret manager, never in the repo.
5. **One email, one job, one button.** The copy and templates already enforce
   this; the automation must not add a second CTA.

---

## 2. Sequence at a glance (the schedule)

All times are **Asia/Kolkata (IST, UTC+5:30)**. The Brevo campaign time zone
must be set to Asia/Kolkata (§9 step 1); the account setting alone does not
control campaign sends.

| # | Email | Delay from previous | Send window (IST + recipient local) | Weekday rule | Segment / condition | Exit rule |
|---|---|---|---|---|---|---|
| 1 | Spot confirmed | **0** — entry send | **Immediate** after `CONFIRMED_AT` (24/7, any hour). Recipient local = the moment they confirm. | Any day. | On `founding_waitlist`; `CONFIRMED_AT` is not empty; `FC_STAGE` is empty or `confirmed`. | Activated · unsubscribed · hard bounce · `FC_STAGE` already advanced · `CONFIRMED_AT` empty |
| 2 | The import story | **At least 3 calendar dates after the actual email 1 send date** (date gate, not a 72-hour elapsed-time guarantee), then the next eligible window | **10:00–11:00 IST** = 04:30–05:30 UTC = 05:30–06:30 CET = 23:30–00:30 ET (previous day) = 20:30–21:30 PT (previous day) | **Tue–Thu only.** A due date on Fri, Sat, Sun, or Mon waits for the next Tuesday. | `FC_STAGE = welcome_1_sent`; `FC_EMAIL1_SENT_AT` is at least 3 calendar dates before today's IST date; `CONFIRMED_AT` is not empty; `ACTIVATED_AT` empty; on `founding_waitlist`. | Activated · unsubscribed · hard bounce · stage changed · invite already sent |
| 3 | The AI stance | **≥ 49 h** from email 2 (48 h safety floor plus 1 h to avoid a same-time trigger race) **and calendar day 7+ after confirmation** (date gate, not a 168-hour elapsed-time guarantee), then the next eligible window | **10:00–11:00 IST** (same local conversions as email 2) | **Tue–Thu only.** Same next-Tuesday rule. | `FC_STAGE = welcome_2_sent`; `FC_EMAIL3_READY = true`; `CONFIRMED_AT` date is at least 7 calendar dates before today's IST date; `ACTIVATED_AT` empty; on `founding_waitlist`. | Activated · unsubscribed · hard bounce · stage changed · invite already sent |
| 4 | Your invite | **Event-driven**, no fixed delay: the next Tue–Thu window after an invite token is issued | **10:00–11:00 IST**, manual batch (same local conversions) | **Tue–Thu only.** Never Fri–Mon. | `FC_STAGE = welcome_3_sent`; `CONFIRMED_AT` not empty; `ACTIVATED_AT` empty; invite token issued. | Activated · unsubscribed · hard bounce · no token · already invited |

### 2.1 What the delays actually produce

The calendar-date check is a **floor**, not an exact send time or elapsed-hour
guarantee. `CONFIRMED_AT` and `FC_EMAIL1_SENT_AT` are date-only fields; Brevo
cannot use them to enforce 72 elapsed hours from an arbitrary confirmation or
send time. Email 2 is gated from the actual email 1 send date, including manual
reconciliation, so an older confirmation imported just before a scheduled
check cannot receive emails 1 and 2 on the same day. Expected arrivals:

| Email | Calendar-date floor | Realistic arrival |
|---|---|---|
| 1 | none | within minutes of confirmation |
| 2 | Email 1 send date ≤ today's IST date − 3 calendar days | **calendar day 3–7** after email 1 (weekend shift; elapsed time can be under 72 hours) |
| 3 | Confirmation date ≤ today's IST date − 7 calendar dates, plus ≥49 h after email 2 and the next later scheduled check | **calendar day 8–14** after confirmation (elapsed time from confirm can be under 168 hours) |
| 4 | invite issued | **0–4 calendar days** after the token is issued, on the next Tue–Thu window |

Examples: email 1 Monday → email 2 Thursday (day 3); if email 1 is manually
reconciled on Friday for a contact confirmed weeks earlier, email 2 still waits
until the next eligible Tue–Thu check after the three-calendar-date floor. If
email 2 arrives Tuesday, its 49-hour timer completes Friday, after the Thursday
check, so email 3 waits until the next Tuesday.

### 2.2 Recipient-local conversion table

Fixed at 10:00–11:00 IST. DST shifts the local hour by one in the affected
zones; the IST window does not move.

| Recipient zone | Local window |
|---|---|
| Asia/Kolkata (IST) | 10:00–11:00 |
| UTC | 04:30–05:30 |
| Europe/London (GMT, winter) | 04:30–05:30 |
| Europe/Berlin (CET, winter) | 05:30–06:30 |
| Asia/Dubai (GST) | 08:30–09:30 |
| Asia/Singapore (SGT) | 12:30–13:30 |
| Australia/Sydney (AEDT, summer) | 15:30–16:30 |
| America/New_York (EST, winter) | 23:30–00:30, previous day |
| America/Los_Angeles (PST, winter) | 20:30–21:30, previous day |

The IST window is deliberate: the founding cohort is India-first, and the copy
is written by an IST-based founder. It is **not** a claim that 10:00 IST is
ideal in every zone. Do not enable Brevo "Send at best time" for this sequence
— it needs campaign history this list does not have yet. If the non-IST share
of the list exceeds 15%, split email 2/3 into two windows in a later revision;
do not do that in v1.

### 2.3 Weekday and stacking rules

- Emails 2–4 go **Tuesday, Wednesday, or Thursday**, in the 10:00–11:00 IST
  window.
- A due date that lands on Friday, Saturday, Sunday, or Monday waits for the
  **next Tuesday**.
- **Never two sequence emails on the same calendar day (IST).** Email 2 sets a
  49-hour timer after its send action and flips `FC_EMAIL3_READY`; email 3 can
  only enter on a later Tue–Thu 10:00 check. The extra hour avoids relying on
  ordering when a 48-hour timer and scheduled filter check would be due at the
  same time. The 7-calendar-date confirmation gate is not an elapsed 168-hour
  promise.
- If the window falls on a public holiday in the recipient's country, the
  operator may skip to the next Tue–Thu window. This is a manual judgment, not
  an automation rule.

---

## 3. Why this is three automations plus one manual send

Brevo's **Time delay** rule is a fixed duration (minutes/hours/days/weeks/
months); it cannot wait for 10:00, and it cannot skip a weekend. Brevo's
**Wait until an event happens** waits for a contact action or a time limit, not
for a clock time. A single "delay 3 days → send" chain would therefore drift
with the confirmation time and send on weekends.

The buildable primitive is the **scheduled filter trigger** ("Contact matches
custom filters"): Brevo checks the filter at a frequency and time you choose,
and every contact matching at that moment enters. Three weekly triggers — Tue,
Wed, Thu at 10:00 IST — with the same filter give the weekday rule and the
window exactly, without any per-contact date math.

| Approach | Window-exact? | Weekend rule? | Verdict |
|---|---|---|---|
| One automation, `Time delay` 3 d / 7 d | No — drifts to confirmation time | No | Rejected |
| `CONFIRMED_AT` + Anniversary trigger (day offset) | Entry time can be set; no day-of-week control | No | Rejected |
| Scheduled filter trigger, Tue/Wed/Thu 10:00 IST | Yes | Yes | **Chosen** |
| Manual batch every week | Yes | Yes | Only for email 4 (per-contact link) |

So the sequence is:

| Workflow | Type | What it does |
|---|---|---|
| `FC-01 confirm` | Automation, list trigger | Sends email 1 immediately, records stage |
| `FC-02 import story` | Automation, scheduled filter trigger (Tue/Wed/Thu 10:00 IST) | Sends email 2 when the floor and window are met |
| `FC-03 ai stance` | Automation, scheduled filter trigger (Tue/Wed/Thu 10:00 IST) | Sends email 3 when the floor and window are met |
| `FC-04 invite` | **Manual batch**, Brevo UI | Human sends email 4 with the per-contact link |

No `Time delay` node controls the **send window** — that is the weekly schedule.
The only delay node is a fixed **49-hour** timer inside `FC-02` after email 2;
it flips `FC_EMAIL3_READY` after the 48-hour minimum plus a one-hour scheduling
buffer. Email 3 can enter only at a later Tue–Thu check. The
3-calendar-date email 2 threshold compares `FC_EMAIL1_SENT_AT` with today's
IST date; the 7-calendar-date email 3 threshold compares `CONFIRMED_AT` with
today's IST date.
This is intentional; putting the window itself on a delay node would
reintroduce the drift.

---

## 4. Entry trigger and consent

### 4.1 The only valid entry

A contact enters `FC-01 confirm` when all of these are true:

1. The contact is on the `founding_waitlist` list.
2. `CONFIRMED_AT` is set (the app's double-opt-in timestamp).
3. `FC_STAGE` is empty or `confirmed` (the contact has not already received
   email 1).

Because every later workflow requires `FC_STAGE` to be `welcome_1_sent` /
`welcome_2_sent` and `CONFIRMED_AT` to be non-empty, **an unconfirmed contact
cannot reach emails 2–4** even if someone imports a bad row. The stage is the
gate; the list is the convenience.

### 4.2 Brevo native double opt-in stays off

The app runs its own double opt-in (`services/waitlist.ts` sends the
confirmation email; `/api/waitlist/confirm` flips `confirmed_at`). Brevo native
DOI is `doubleOptin: false` by design (P5 in the copy doc). **Do not enable
Brevo DOI** — contacts would be asked to confirm twice, and the second email
would not match the app's consent record.

### 4.3 Two entry paths

**Path A — target state (automatic).** On a successful confirmation, the app
updates the Brevo contact and adds it to `founding_waitlist`:

```
PUT /v3/contacts/{email}
{
  "attributes": {
    "CONFIRMED_AT": "2026-11-06",
    "FOUNDING_POSITION": 37,
    "SIGNUP_SOURCE": "early_page",
    "UTM_CAMPAIGN": "phase2_founding",
    "FC_STAGE": "confirmed"
  },
  "listIds": [<founding_waitlist id>]
}
```

`CONFIRMED_AT` is a **date** attribute: send the date part (`YYYY-MM-DD`), not a
timestamp. Brevo ignores values that do not match the attribute type. The full
timestamp stays in the database as the consent record. If the contact does not
exist yet, use the existing create-or-update path (`POST /v3/contacts` with
`updateEnabled: true`) and include the same `attributes` and `listIds`.

Code touchpoints: `app/api/waitlist/confirm/route.ts` (call the sync after the
RPC succeeds), `services/waitlist.ts` (payload builder), `lib/brevo.ts` (the
existing contacts wrapper). This is P1 in the copy doc. Until it ships, use
Path B.

**Path B — wave-1 bridge.** Export **only confirmed rows** and import them into
`founding_waitlist`. Production ordering is mandatory: first pass G0–G4, then
Harsh activates the approved `FC-01`, `FC-02`, and `FC-03` workflows and records
the activation times; only after all three are active does the operator import
the confirmed-only CSV. Brevo's list-add trigger is not retroactive, so an
import while `FC-01` is inactive will not enroll those contacts later. Do not
import early and assume activation will catch them.

```sql
select email, utm_source, position, referred_by, confirmed_at
from waitlist
where confirmed_at is not null
order by position;
```

Then import with the column map in §5.4. Do **not** import `confirmed_at is
null` rows. The import itself fires Brevo's "Contact added to list" trigger, so
active `FC-01` enrolls the contact and sends email 1; that is correct — the
person already confirmed, even if the confirmation happened days earlier.

**Reconciliation before import:** compare the export count with
`select count(*) from waitlist where confirmed_at is not null;` and record both
numbers in the activation log. If they differ, stop and fix the export; do not
"fill in" missing rows by hand.

### 4.4 Test contacts

Use a **separate list**, `founding_waitlist_test`, for all test sends. Never put
a test address on `founding_waitlist`; that would trigger the real email 1 and
pollute the cohort counts. Delete the test list and test contacts after the
dry run.

---

## 5. Contact attributes and tags

### 5.1 Attribute contract

These names are canonical. SIL-226 must use them verbatim; no aliases,
no free-text variants.

| Attribute | Type | Example | Written by | Used by | Required? |
|---|---|---|---|---|---|
| `CONFIRMED_AT` | Date | `2026-11-06` | App on confirm (Path A) or manual import (Path B) | Consent entry guard | **Yes** |
| `FC_EMAIL1_SENT_AT` | Date | `2026-11-06` | `FC-01 confirm` after email 1; Harsh after a verified manual send | Email 2's three-calendar-date floor, measured from the actual email 1 send date | **Yes before email 2** |
| `FOUNDING_POSITION` | Number | `37` | App/import from `waitlist.position` | Ops ordering, reporting; **not used in copy** | Optional (P2) |
| `SIGNUP_SOURCE` | Text | `early_page` · `x_bio` · `linkedin_bio` · `referral` · `manual_import` | App/import from `waitlist.utm_source` / `referred_by` | Acquisition reporting; not a send condition | Yes, default `early_page` |
| `UTM_CAMPAIGN` | Text | `phase2_founding` | App/import from the signup URL's `utm_campaign` | Cohort reporting; **not a send condition** | Optional |
| `FC_STAGE` | Text | `confirmed` · `welcome_1_sent` · `welcome_2_sent` · `welcome_3_sent` · `invited` · `activated` · `exited` | The automations, human operator | Duplicate prevention, segments, exit | **Yes** |
| `FC_EMAIL3_READY` | Boolean | `true` | `FC-02 import story`, after a 49 h delay | No-stacking gate for email 3 | **Yes** |
| `INVITE_URL` | Text | `https://lekhan.online/invite/<token>` | App invite flow (P3) | Email 4 merge tag | Only after P3 |
| `ACTIVATED_AT` | Date | `2026-11-08` | Product event or human operator | Exit from every workflow | Yes, best-effort |
| `USECASE` | Text | `research notes` | App at signup | Optional segmentation | No |
| `UTM_SOURCE` | Text | `x` | App at signup (legacy) | **Do not use in new automations** | Legacy |

**`SIGNUP_SOURCE` vs `UTM_SOURCE`:** the app today writes `UTM_SOURCE`
(`services/waitlist.ts` → `buildBrevoPayload`) and does not write
`SIGNUP_SOURCE`. `SIGNUP_SOURCE` is the canonical reporting name from this
point on; rename the write (one line) or keep both in sync for one release
before SIL-226 freezes the registry. Nothing in the send path branches on
`SIGNUP_SOURCE`, so a missing value cannot cause a wrong send. Do not repurpose
`UTM_SOURCE` as an automation condition.

**`UTM_CAMPAIGN` is inbound, not outbound.** It records the campaign that
brought the contact to `/early` (for example `phase2_founding`). It is **not**
the outbound email `utm_campaign` (`founding_welcome` / `founding_invite`) in
the links. Do not write outbound values onto the contact; that would corrupt
acquisition reporting.

### 5.2 Stage machine

Only move forward. An automation sends only when the stage is exactly the
expected previous state.

| From | Event | To | Writer |
|---|---|---|---|
| — | Confirmed and added to `founding_waitlist` | `confirmed` in Path A; empty is valid in Path B | App (Path A) / import (Path B) |
| empty / `confirmed` | Email 1 sent; set `FC_EMAIL1_SENT_AT` to current date in the same workflow | `welcome_1_sent` | `FC-01 confirm` |
| `welcome_1_sent` | Email 2 sent | `welcome_2_sent` | `FC-02 import story` |
| `welcome_2_sent` | 49 h after email 2 (not a stage change) | `welcome_2_sent` + `FC_EMAIL3_READY=true` | `FC-02 import story` |
| `welcome_2_sent` + ready | Email 3 sent | `welcome_3_sent` | `FC-03 ai stance` |
| `welcome_3_sent` | Email 4 sent | `invited` | Human operator (bulk update after the batch) |
| `invited` | First workspace activation | `activated` | Product sync (ideal) / human operator (until then) |
| any | Unsubscribe, hard bounce, manual suppression | `exited` | Brevo / human operator |

`FC_EMAIL1_SENT_AT` prevents email 2 from following email 1 on the same day
when a contact has an old confirmation date or email 1 was manually reconciled.
It is intentionally date-only, so the three-date floor is not a 72-hour
promise. `FC_EMAIL3_READY` is the separate no-stacking gate: email 2 sets it
only after its 49-hour timer; email 3's filter requires it at the next later
Tue–Thu check. This guarantees at least a 48-hour gap without a same-time
trigger race.

### 5.3 Tags

Brevo tags label **campaigns, templates, and automations**; contact state is the
`FC_STAGE` attribute above, so automations can read and write it.

| Tag | Applied to | Purpose |
|---|---|---|
| `founding-cohort` | All four templates, all three automations | Group reporting |
| `welcome-sequence` | All three automations | Distinguish from broadcast campaigns |
| `fc-welcome-1` | `FC-01-confirm` template | Per-email reporting and segment filter |
| `fc-welcome-2` | `FC-02-import-story` template | Per-email reporting |
| `fc-welcome-3` | `FC-03-ai-stance` template | Per-email reporting |
| `fc-invite-4` | `FC-04-invite-wave` template | Per-batch reporting |

### 5.4 Import column map (Path B)

| CSV / SQL column | Brevo attribute | Note |
|---|---|---|
| `email` | Email | Lowercase; dedupe before import |
| `confirmed_at` | `CONFIRMED_AT` | Date only; the app timestamp is the consent record |
| `position` | `FOUNDING_POSITION` | Number; may exceed 500 for the soft-cap overflow |
| `utm_source` | `SIGNUP_SOURCE` | Map `null` → `early_page`; keep the literal value otherwise |
| `referred_by` | `SIGNUP_SOURCE` | Only when `utm_source` is null: map to `referral` |
| — | `UTM_CAMPAIGN` | From the signup URL if available; otherwise leave empty |
| — | `FC_EMAIL1_SENT_AT` | Do not map or set on import; preserve existing value. Only record the actual send date after a verified email 1 send. |
| — | `FC_STAGE` | Do not map or set on import; preserve existing state. New contacts may remain empty and pass the `FC-01` empty-or-`confirmed` guard. |
| — | `FC_EMAIL3_READY` | Do not map or set on import; preserve existing value. `FC-02` sets it after email 2's 49-hour delay. |
| — | `ACTIVATED_AT` | Do not map or set on import; preserve existing value. |

Do not import `confirmed_at is null` rows, and do not import the `token` column —
it is a live confirmation credential and must never leave the database.
Before the import, compare the confirmed-only export with current Brevo contacts
and the activation source. Keep workflow-managed attributes (`FC_STAGE`,
`FC_EMAIL1_SENT_AT`, `FC_EMAIL3_READY`, `ACTIVATED_AT`) unmapped for every row;
an import must never initialize, clear, or reset them. Existing contacts already
on the list are not re-added to force a trigger. For an existing contact that
needs an update, update only acquisition fields and leave workflow-managed
attributes untouched. Preserve and exclude activated contacts from the send
audience.

For a previously sent email 1, record its actual send date in
`FC_EMAIL1_SENT_AT` only after verifying the send. If email 1 has not been sent,
the human operator may send it only after the approval gate, then record the
date and set `FC_STAGE=welcome_1_sent`. If the send date or activation state is
unknown, keep the contact out of the send audience until reconciled; never infer
it from `CONFIRMED_AT`.

---

## 6. Automation build spec

Build all three workflows **inactive**. "Save" is not "activate."

### 6.1 `FC-01 confirm` — email 1, immediate

| Field | Value |
|---|---|
| Trigger | **Contact added to list** → `founding_waitlist` |
| Re-entry | Off (a contact enters once) |
| Exit conditions | `ACTIVATED_AT` is not empty; `FC_STAGE` is `activated` or `exited` |
| Tag | `founding-cohort`, `welcome-sequence` |

Steps:

1. **Conditional split** — `CONFIRMED_AT` **is not empty**.
   - **No** → exit. This is the hard guard against a bad import.
   - **Yes** → continue.
2. **Conditional split** — `FC_STAGE` **is empty OR exactly `confirmed`**.
   - **No** → exit without sending or changing attributes. This prevents an
     already-advanced contact from receiving email 1 again if re-added.
   - **Yes** → continue.
3. **Send an email** — template `FC-01-confirm`, tag `fc-welcome-1`.
4. **Update contact attribute** — `FC_EMAIL1_SENT_AT` = current date (Brevo
   account timezone set to Asia/Kolkata), recording the actual email 1 send
   date.
5. **Update contact attribute** — `FC_STAGE` = `welcome_1_sent`.
6. End.

### 6.2 `FC-02 import story` — email 2, day 3+

| Field | Value |
|---|---|
| Triggers | **Contact matches custom filters**, scheduled **Tue 10:00**, **Wed 10:00**, **Thu 10:00** IST. If the UI allows multiple weekdays in one trigger, use one trigger for Tue/Wed/Thu; otherwise add three triggers with the same filter. |
| Re-entry | Off |
| Exit conditions | `ACTIVATED_AT` is not empty; `FC_STAGE` is `activated` or `exited` |
| Tag | `founding-cohort`, `welcome-sequence` |

Filter (all must match):

- Contact is in list `founding_waitlist`
- `CONFIRMED_AT` **is not empty**
- `FC_EMAIL1_SENT_AT` **is at least 3 calendar dates before today's IST date**
  (date ≤ today's IST date − 3; the UI may label this "more than 2 days ago"
  or "at least 3 days ago"). This is a calendar-date threshold from the actual
  email 1 send, not a 72-hour elapsed-time floor.
- `FC_STAGE` **is exactly** `welcome_1_sent`
- `ACTIVATED_AT` **is empty**

Steps:

1. **Send an email** — template `FC-02-import-story`, tag `fc-welcome-2`.
2. **Update contact attribute** — `FC_STAGE` = `welcome_2_sent`.
3. **Time delay** — **49 hours**, starting after the email 2 send action
   completes. This includes the 48-hour minimum plus a one-hour buffer so a
   timer due at 10:00 cannot race that same day's scheduled filter check.
4. **Update contact attribute** — `FC_EMAIL3_READY` = `true`.
5. End.

### 6.3 `FC-03 ai stance` — email 3, day 7+

| Field | Value |
|---|---|
| Triggers | Same Tue/Wed/Thu 10:00 IST scheduled filter triggers as 6.2 |
| Re-entry | Off |
| Exit conditions | `ACTIVATED_AT` is not empty; `FC_STAGE` is `activated` or `exited` |
| Tag | `founding-cohort`, `welcome-sequence` |

Filter (all must match):

- Contact is in list `founding_waitlist`
- `CONFIRMED_AT` **is at least 7 calendar dates before today's IST date**
  (date ≤ today's IST date − 7). This is a calendar-date threshold, not a
  168-hour elapsed-time floor.
- `FC_STAGE` **is exactly** `welcome_2_sent`
- `FC_EMAIL3_READY` **is** `true`
- `ACTIVATED_AT` **is empty**

Steps:

1. **Send an email** — template `FC-03-ai-stance`, tag `fc-welcome-3`.
2. **Update contact attribute** — `FC_STAGE` = `welcome_3_sent`.
3. End.

### 6.4 `FC-04 invite` — email 4, manual

Not an automation. The human operator:

1. Builds the segment `FC - invite wave`:
   `FC_STAGE = welcome_3_sent` AND `CONFIRMED_AT` not empty AND
   `ACTIVATED_AT` empty.
2. Exports the segment with email, name (if any), and invite token from the app.
3. Sends `FC-04-invite-wave` on the next Tue–Thu 10:00 IST window, in batches
   (start with 25–50), pasting the per-contact invite link into
   `{{contact.INVITE_URL}}` or into the body placeholder per recipient.
4. After the batch, bulk-updates `FC_STAGE` to `invited`.
5. Excludes anyone who replies "already activated" or asks to stop.

Do **not** add email 4 to any automation while `INVITE_URL` is unwritten (P3).
A literal `[INVITE LINK]` in a real send is a defect, not a test.

---

## 7. Exit rules

### 7.1 Global exits

| Condition | Effect | Where |
|---|---|---|
| `ACTIVATED_AT` is not empty | Exit all three workflows; do not delete the contact | Automation Settings → exit conditions |
| `FC_STAGE` = `activated` | Same | Exit conditions |
| Unsubscribed | Brevo suppresses marketing sends automatically; mark `FC_STAGE=exited` in the weekly review | Brevo suppression + human |
| Hard bounce | Brevo suppresses; mark `FC_STAGE=exited` | Brevo suppression + human |
| Manual suppression (`FC_STAGE=exited`) | Exit all | Exit conditions |
| Stage advanced past the expected step | Exit that workflow (prevents a duplicate) | Filter + exit conditions |
| Invite already sent (`FC_STAGE=invited`) | Exit emails 2 and 3 | Filter |
| Replied to an email | **Do not auto-exit.** A human reads and decides | Human |

### 7.2 Why both a filter and an exit condition

The filter decides who *enters* at the scheduled check. The exit condition
removes someone who is *already inside* when they activate or unsubscribe
between steps. Use both; neither alone is sufficient.

### 7.3 Contacts who activate early

If a contact activates before email 2 or 3 (for example, a manual invite), set
`FC_STAGE=activated` and `ACTIVATED_AT` before the next window. Until the
product writes `ACTIVATED_AT` automatically, this is a manual step in the
weekly review; email 4 batches are manually filtered, so the risk is contained.

---

## 8. Human send / approval gate

### 8.1 Who can do what

| Action | Growth Lead (agent) | Harsh Dave (Founder) |
|---|---|---|
| Write/revise this spec | Yes | Review |
| Create list, attributes, tags, templates | No (no Brevo access) | Yes |
| Build automations in inactive state | No | Yes |
| Send internal test emails | No | Yes |
| Approve copy + sender + activation | No | **Yes** |
| Activate / pause / stop automations | **Never** | **Yes** |
| Send email 4 | **Never** | **Yes** |
| Export the contact list during a rollback | No | Yes |

The agent's job ends at a reviewed spec and a verification record. The Brevo
account is the founder's; no agent credential is created for this sequence.

### 8.2 Gate sequence

| Gate | What must be true | Evidence |
|---|---|---|
| **G0 — copy approved** | SIL-223 approval card resolved; signatory and sender mailbox confirmed | Approval record on SIL-223 |
| **G1 — templates imported** | All four templates in `Founding Cohort`; subject, preview, plain text, sender, reply-to, postal address set | Templates README checklist signed |
| **G2 — preflight** | Test sends pass: links/UTM, unsubscribe, `{{senderAddress}}`, 320/600 px, dark mode, plain text, no literal merge tag | Test-message screenshots or email source saved |
| **G3 — dry run** | One test contact goes through A1 and the test copies of A2/A3; stage moves correctly; no real contact in the list | Dry-run log below |
| **G4 — written approval** | Harsh posts "approved to activate A1/A2/A3" on SIL-225 (or the PR), naming the copy revision and template revision | Comment link |
| **G5 — activation** | Harsh activates A1, then A2, then A3, and records the time | Activation log below |
| **G6 — first 24 h** | Bounces, unsubscribes, replies, link errors checked; thresholds in §11 applied | Watch note on SIL-225 |

**No gate can be skipped because "the copy is already approved."** G3 and G5
are about wiring, not wording.

### 8.3 Activation log (fill in, keep in this doc or the issue)

| Automation | Activated by | Date/time IST | Copy revision | Template revision | Notes |
|---|---|---|---|---|---|
| `FC-01 confirm` | | | | | |
| `FC-02 import story` | | | | | |
| `FC-03 ai stance` | | | | | |

The activator is **Harsh Dave**. If he delegates the build, the delegate may
click through §9 but may not activate; the activation row still names Harsh.
If Harsh is unavailable, the board must name a substitute in writing on SIL-225
before activation. No agent may self-authorize.

### 8.4 Dry-run log (fill in)

| Check | Expected | Actual | Pass? |
|---|---|---|---|
| Confirmed test contact added to `founding_waitlist_test` and enters cloned test `FC-01` (whose list trigger targets only the test list) | Email 1 arrives within 15 min | | |
| `FC_STAGE` after email 1 | `welcome_1_sent` | | |
| Already-advanced test contact (`FC_STAGE=welcome_2_sent`) added to the test list with `CONFIRMED_AT` set | No email 1; stage remains `welcome_2_sent` | | |
| Older confirmation (`CONFIRMED_AT` 30 calendar dates ago) with verified email 1 just before a scheduled check (`FC_EMAIL1_SENT_AT` today) | No email 2; wait until the actual email 1 date is at least 3 calendar dates old | | |
| Confirmed test contact in `founding_waitlist_test` matches cloned `FC-02` with `FC_EMAIL1_SENT_AT` 4 calendar dates ago and `FC_STAGE=welcome_1_sent` | Email 2 test arrives; stage `welcome_2_sent` | | |
| Existing imported test contact has `FC_STAGE=welcome_2_sent`, `FC_EMAIL1_SENT_AT` set, and `ACTIVATED_AT` populated | Import leaves all three unchanged; no email 1; activated contact stays excluded | | |
| Import row contains old `CONFIRMED_AT`, but no verified `FC_EMAIL1_SENT_AT` | No email 2 until a human verifies/records the actual send date | | |
| Email 3 test copy with `CONFIRMED_AT` 8 calendar dates ago, stage `welcome_2_sent`, `FC_EMAIL3_READY=true` | Email 3 arrives; stage `welcome_3_sent` | | |
| Email 3 test with `FC_EMAIL3_READY=false` | No send | | |
| Unconfirmed contact on the test list | No email 1; no entry to 2–4 | | |
| Unsubscribe link in each email | Resolves; contact suppressed afterwards | | |
| Every button URL | Matches §5 of the templates README exactly (UTM case-sensitive) | | |

---

## 9. Step-by-step Brevo UI build checklist

Brevo moves labels between releases. The **step** is the contract; if a label
differs, find the equivalent control and note the difference in the activation
log.

### A. Account and data setup

- [ ] **1. Time zone.** Settings → General → Time zone = `Asia/Kolkata`.
      Then Settings → Campaigns → Default settings → time zone =
      `Asia/Kolkata`. The campaign setting is the one used for sends; the
      account setting alone is not enough.
- [ ] **2. List.** Contacts → Lists → Create list `founding_waitlist`
      (and a separate `founding_waitlist_test` for the dry run).
- [ ] **3. Attributes.** Contacts → Settings → Contact attributes → create
      `CONFIRMED_AT` (date), `FC_EMAIL1_SENT_AT` (date), `FOUNDING_POSITION` (number), `SIGNUP_SOURCE`
      (text), `UTM_CAMPAIGN` (text), `FC_STAGE` (text), `FC_EMAIL3_READY`
      (boolean), `INVITE_URL` (text), `ACTIVATED_AT` (date). Keep `USECASE`
      and `UTM_SOURCE` as they are.
- [ ] **4. Tags.** Automations → Tags (or the tag manager) → create
      `founding-cohort`, `welcome-sequence`, `fc-welcome-1`, `fc-welcome-2`,
      `fc-welcome-3`, `fc-invite-4`.
- [ ] **5. Sender.** Senders & IPs → sender name `Lekhan`; sender email =
      the `WAITLIST_CONFIRM_FROM` address; reply-to = the monitored human
      inbox; postal address filled in. Confirm the mailbox actually receives
      mail.

### B. Templates (consume SIL-224)

- [ ] **6. Import.** Marketing → Templates → Create template → Start from
      scratch → HTML custom code. Import `01-confirm` … `04-invite-wave` from
      `docs/marketing/brevo/templates/`. Name them `FC-01-confirm` …
      `FC-04-invite-wave`; folder `Founding Cohort`.
- [ ] **7. Subject and preview.** Paste the four subject lines and preview
      texts from the templates README §2. Do not retype; copy.
- [ ] **8. Plain text.** For each template, open Design → ··· → View the plain
      text version → Edit, and paste the matching `.txt` file.
- [ ] **9. Links.** Confirm the button URLs match the templates README §5
      exactly, including `utm_campaign` and `utm_content` case. Email 4 keeps
      `{{contact.INVITE_URL}}`; it is not sent by automation.
- [ ] **10. Footer.** `{{unsubscribe}}` is a link in every HTML footer; if
      `{{senderAddress}}` renders literally in the test send, replace it with
      the hard-coded postal address and re-test.

### C. Segments

- [ ] **11. `FC - ready email 2`.** List `founding_waitlist`; `CONFIRMED_AT`
      not empty; `FC_EMAIL1_SENT_AT` at least 3 calendar dates before today's
      IST date;
      `FC_STAGE` = `welcome_1_sent`;
      `ACTIVATED_AT` empty.
- [ ] **12. `FC - ready email 3`.** Same list; `CONFIRMED_AT` at least 7
      calendar dates before today's IST date; `FC_STAGE` = `welcome_2_sent`;
      `FC_EMAIL3_READY` = `true`;
      `ACTIVATED_AT` empty.
- [ ] **13. `FC - invite wave`.** `FC_STAGE` = `welcome_3_sent`;
      `ACTIVATED_AT` empty.
- [ ] **14. `FC - activated` and `FC - suppressed`.** For reporting and
      manual review; not used as send audiences.

### D. Automations (build inactive)

- [ ] **15. `FC-01 confirm`.** Trigger "Contact added to list" →
      `founding_waitlist`; conditional split `CONFIRMED_AT` is not empty, then
      split `FC_STAGE` is empty OR exactly `confirmed`; otherwise exit without
      sending or changing attributes. Send template `FC-01-confirm`; set
      `FC_EMAIL1_SENT_AT` to the current date in Asia/Kolkata; then set
      `FC_STAGE=welcome_1_sent`; exit conditions from §7; re-entry off. **Save,
      do not activate.**
- [ ] **16. `FC-02 import story`.** Trigger "Contact matches custom filters"
      with the §6.2 filter, scheduled Tue/Wed/Thu 10:00 IST (one multi-day
      trigger if available, otherwise three triggers). Send template
      `FC-02-import-story`; update `FC_STAGE=welcome_2_sent`; add a
      **49-hour Time delay**; update `FC_EMAIL3_READY=true`; exit conditions;
      re-entry off. **Save, do not activate.**
- [ ] **17. `FC-03 ai stance`.** Same trigger pattern with the §6.3 filter;
      send `FC-03-ai-stance`; update `FC_STAGE=welcome_3_sent`; exit
      conditions; re-entry off. **Save, do not activate.**

### E. Test and activate

- [ ] **18. Test sends.** Send all four templates to the internal test address.
      Check 320/600 px, dark mode, plain text, every button/UTM, the
      unsubscribe link, and that no `{{…}}` is visible.
- [ ] **19. Dry run.** Clone `FC-01`, `FC-02`, and `FC-03` as test workflows;
      change each list trigger/filter to `founding_waitlist_test` and restrict
      sends to the internal test address. Keep production workflows inactive
      and unchanged. Harsh Dave may temporarily activate only these test copies
      for the dry run. Verify the unconfirmed and already-advanced guards. Test
      an older `CONFIRMED_AT` date with `FC_EMAIL1_SENT_AT` set to the day of a
      just-sent email 1 before the scheduled check; email 2 must wait until the
      three-calendar-date floor. Import an existing test contact with
      `FC_STAGE=welcome_2_sent`, a sent-date value, and populated `ACTIVATED_AT`;
      confirm the import preserves all workflow-managed fields and the contact
      receives no email 1. Deactivate/delete the test copies and test contacts.
- [ ] **20. Approval.** Harsh posts written approval on SIL-225, naming the
      copy revision and template revision. **Stop here until it is posted.**
- [ ] **21. Activate.** After G0–G4 are complete, Harsh activates `FC-01
      confirm`, then `FC-02 import story`, then `FC-03 ai stance`, in that
      order. Record each activation in §8.3. Do not activate email 4; it stays
      manual. For Path B, all three must be active before the confirmed-only
      import begins.
- [ ] **22. Path B import (manual bridge only).** Reconcile the confirmed-only
      export count as specified in §4.3, reconcile existing Brevo list members
      and activation records, then import with only acquisition/consent fields
      mapped. Leave `FC_STAGE`, `FC_EMAIL1_SENT_AT`, `FC_EMAIL3_READY`, and
      `ACTIVATED_AT` unmapped. Confirm a new contact entered `FC-01`, and record
      counts and completion time. If any rows were imported before activation,
      stop and reconcile list members against stage, actual email 1 send dates,
      and activation records; do not re-import the whole CSV, reset a stage, or
      remove/re-add contacts to force the trigger. For a confirmed contact whose
      email 1 is not recorded as sent, Harsh must verify consent and send the
      email 1 template manually, then set `FC_EMAIL1_SENT_AT` to the verified
      send date and `FC_STAGE=welcome_1_sent`; do not enroll that contact in
      `FC-01`. Preserve any existing state for previously sent or activated
      contacts. If send date or activation state is unknown, exclude the contact
      until reconciled. Record all counts and actions before proceeding.
- [ ] **23. First 24 h.** Watch bounces, unsubscribes, replies, and link
      errors against §11. If a threshold is crossed, use §10.

---

## 10. Rollback and kill switch

### 10.1 Brevo status semantics (important)

- **Pause** — new contacts stop entering, but contacts already inside keep
  progressing and may still receive the next email.
- **Stop / Deactivate** — new contacts stop entering **and** active contacts are
  removed from the workflow.

So "pause" is not a full kill switch. Use **Stop/Deactivate** when a send must
not go out; use Pause only when you want to stop new entries while allowing
in-flight contacts to finish.

### 10.2 Kill-switch procedure

1. **Stop the bleeding.** Automations → `FC-01`/`FC-02`/`FC-03` → **Stop**
   (or Deactivate). If a scheduled email-4 batch is queued, cancel it in
   Campaigns.
2. **Export the list.** Contacts → select `founding_waitlist` → Export CSV.
   Include email, `CONFIRMED_AT`, `FOUNDING_POSITION`, `SIGNUP_SOURCE`,
   `UTM_CAMPAIGN`, `FC_EMAIL1_SENT_AT`, `FC_STAGE`, `FC_EMAIL3_READY`,
   `ACTIVATED_AT`. Store the
   export in the founder's restricted drive, **not** in the repo.
3. **Snapshot the config.** Save the automation settings, segment definitions,
   template names, subject/preview text, and the current copy/template
   revisions.
4. **Record it.** Post on SIL-225: time (IST), action, scope, reason, number of
   contacts affected, and the export filename/location. Do not paste the CSV.
5. **Fix and verify.** Correct the copy/template/filter, re-run the §8.4 dry
   run, and get a fresh written approval before reactivating.
6. **Reactivate carefully.** Reconcile contacts removed by Stop against actual
   send history, `FC_EMAIL1_SENT_AT`, `FC_STAGE`, and activation records.
   Preserve those values. Do not re-add an advanced contact as `confirmed` or
   allow a CSV import to reset its state; keep unknown send dates or activation
   state excluded until the human operator verifies them.

### 10.3 Rollback triggers

Stop immediately if any of these is true:

- A link is broken, has the wrong UTM string, or points to the wrong page.
- A merge tag renders literally (`{{contact.…}}`, `[INVITE LINK]`).
- The wrong sender or reply-to is used.
- An unconfirmed contact receives any email.
- Unsubscribes exceed **2%** on any single email.
- The same person receives two sequence emails on the same day.
- A contact receives email 2 or 3 after activating.

### 10.4 Rollback log

| Time IST | Action (pause/stop/export) | By | Scope | Reason | Contacts affected |
|---|---|---|---|---|---|
| | | | | | |

---

## 11. Monitoring and thresholds

| Signal | Where | Healthy first-cohort signal | Action if missed |
|---|---|---|---|
| Email 1 delivered / opened | Brevo | > 95% delivered; opens are advisory | Check sender auth and bounces |
| Email 2/3 click-through | Brevo + GA4 UTM | 8–15% | Review subject/CTA after 48 h |
| Unsubscribe per email | Brevo | < 1% | > 2% → stop and review |
| Hard bounce | Brevo | < 2% cumulative | Clean the list; do not re-send |
| Replies | Human inbox | Any substantive reply is a win | Log per contact; reply personally |
| Invite → first import | Product (#83) | The real activation number | Do not optimize on opens alone |

Do not use open rate as the primary success metric: Apple Mail Privacy
Protection inflates it. Click, reply, and activation are the honest signals at
this list size.

---

## 12. Open questions and decisions

| # | Question | Default in this spec | Owner |
|---|---|---|---|
| Q1 | Confirm the signatory name and the monitored sender mailbox (P4) | "Harsh, Lekhan"; `WAITLIST_CONFIRM_FROM` | Harsh |
| Q2 | Ship the confirm→Brevo sync (Path A) before wave 1, or run wave 1 on the manual import (Path B)? | Path B for wave 1; Path A before wave 2 | Tech Lead / Growth Lead |
| Q3 | Is `FOUNDING_POSITION` personalisation worth the engineering change (P2)? | No — copy does not use it | Harsh |
| Q4 | When does `INVITE_URL` become a contact attribute (P3)? | Not in v1; email 4 stays manual | Tech Lead |
| Q5 | Is the fixed 10:00 IST window acceptable for non-IST recipients? | Yes for v1; revisit above 15% non-IST | Harsh |

---

## 13. Acceptance-criteria map

| Issue criterion | Where it is satisfied |
|---|---|
| Table with email, delay, send window (IST + local), weekday rule, segment/condition, exit rule | §2, §2.2, §2.3 |
| Double opt-in is the entry trigger; unconfirmed never enter 2–4 | §4.1, §4.2, §6.1 guard, §6.2/6.3 filters |
| Email 2 waits from the actual email 1 send date and cannot follow a late import the same day | `FC_EMAIL1_SENT_AT` in §5.1–5.2, §6.1–6.2, §8.4 and §9.E boundary tests |
| Path B import cannot overwrite stage, send date, email 3 readiness, or activation state | §5.4 unmapped fields and reconciliation; §8.4 preservation test; §9.E import steps; §10.2 recovery |
| Attributes/tags defined and consistent with tracking | §5.1–§5.4; SIL-226 consumes §5 verbatim |
| Step-by-step Brevo UI build checklist ending at a named human | §9, §8.3 (Harsh Dave) |
| Rollback/kill-switch (pause, export contact list) | §10 |
| No API key or credential in the doc | Header and §1 item 4; no secret values anywhere |

---

## 14. Sources

- Copy: [`brevo-welcome-sequence.md`](brevo-welcome-sequence.md) §1 timing,
  §2 P1–P4, §9 checklist.
- Templates: [`brevo/templates/README.md`](brevo/templates/README.md) —
  merge tags, field map, link registry, known gaps.
- Code: `app/api/waitlist/confirm/route.ts`, `app/api/waitlist/route.ts`,
  `services/waitlist.ts`, `lib/brevo.ts` — confirmation state, current Brevo
  payload, and the P1 gap.
- Brevo Help Center:
  - [Available triggers, actions, and rules in an automation](https://help.brevo.com/hc/en-us/articles/15445989568402)
    — "Contact added to list", "Contact matches custom filters", scheduled
    checks, "Time delay", "Update contact attribute", exit conditions.
  - [Differences between Time delay and Wait until an event happens](https://help.brevo.com/hc/en-us/articles/27438224109074)
    — fixed delays vs event waits.
  - [Overview of the new automation editor](https://help.brevo.com/hc/en-us/articles/15445936637330)
    — Paused vs Inactive/Stopped semantics.
  - [When I'm programming my campaign, what is the time zone?](https://help.brevo.com/hc/en-us/articles/208699769)
    — campaign time zone is set under Settings → Campaigns, not the account
    time zone.
- Launch context: `docs/marketing/founding-cohort-launch.md`;
  `.agents/product-marketing.md`.
