# Brevo Welcome Sequence — Founding Cohort

Send-ready copy for the four-email founding-cohort sequence. Written with the
`emails` skill pass against `.agents/product-marketing.md` and
`docs/marketing/founding-cohort-launch.md`.

**Draft only.** Campaigns are only ever *sent* from the Brevo UI by a human
(`ops/n8n/README.md`). This document contains no credentials and triggers no
sends.

Part of SIL-201. Templates: SIL-224. Send schedule/automation: SIL-225.
Tracking: SIL-226.

---

## 1. Sequence overview

| Field | Value |
|---|---|
| Name | Founding Cohort Welcome |
| Trigger | Waitlist email confirmed (double opt-in) |
| Audience | Obsidian users who claimed a founding spot and confirmed |
| Goal | Activate: vault imported and workspace ready before the invite wave |
| Length | 3 scheduled emails + 1 event-triggered invite email |
| Timing | Instant → day 3 → day 7 → on invite issuance |
| Primary conversion | First successful vault import (activation proxy) |
| Secondary | Reply rate (real signal at this list size), FAQ click-through |
| Exit | Invite activated · unsubscribed · hard bounce · sequence complete |

One email, one job. Every email has exactly one button. No first-name
personalisation: signup collects email only, and `FIRSTNAME` is not synced to
Brevo (`services/waitlist.ts`, contact attributes). The copy is written to read
correctly with zero custom attributes.

### Timing

| # | Email | Send | Purpose |
|---|---|---|---|
| 1 | Spot confirmed | Immediately after confirm | Set expectations, explain founding status |
| 2 | The import story | Day 3, 10:00 IST | Show what survives a vault import |
| 3 | The AI stance | Day 7, 10:00 IST | Remove the "AI subscription creep" objection |
| 4 | Your invite | On invite issuance (event, not day 10) | Activate the workspace |

Weekday rule: send Tue–Thu where possible; if a delay lands on a weekend, shift
to the next Tuesday. Do not stack two emails on the same day.

---

## 2. Before a human can send (current-state gaps)

These are verified against the code, not assumptions. Each needs an owner
before the sequence runs end-to-end.

| # | Gap | Evidence | Owner / resolution |
|---|---|---|---|
| P1 | Confirmation never reaches Brevo, so Brevo cannot trigger on "confirmed" | `app/api/waitlist/confirm/route.ts` only calls the `confirm_waitlist` RPC; contact sync happens at signup (`app/api/waitlist/route.ts` → `lib/brevo.ts`) | For wave 1: export confirmed rows manually (§7 step 2). Permanent fix: write `CONFIRMED_AT` to the Brevo contact on confirm — tracked in SIL-225 |
| P2 | `FOUNDING_POSITION` is not a Brevo attribute | `services/waitlist.ts` sends only `UTM_SOURCE` and `USECASE` | Optional. Copy deliberately does not depend on it. Add later if personalisation is wanted |
| P3 | No per-contact `INVITE_URL` attribute | Invite tokens are issued in-app (`/invite/[token]`); nothing syncs them to Brevo | Send email 4 manually per contact from the Brevo UI, or add the attribute in SIL-225 |
| P4 | Sender/reply-to mailbox must be a monitored human inbox | `WAITLIST_CONFIRM_FROM` is the only sender setting in the repo | Confirm the mailbox before send; reply-to must reach a human, per the launch plan |
| P5 | Brevo native double opt-in is off by design | `doubleOptin: false` in `services/waitlist.ts` | Use the app's confirmation as the consent record; do not enable Brevo DOI or contacts will be asked twice |

P1 is the one that matters: until it is fixed, the safe path is a manual import
of confirmed contacts (step 2 of the checklist), not an automation on "new
contact".

---

## 3. Email 1 — Spot confirmed

**Send:** immediately after confirmation · **Segment:** confirmed contacts, not
yet activated · **Exit:** activated, unsubscribed

**Subject:** You're in — your founding spot is confirmed
**Preview text:** What your spot gets you, when invites go out, and how to help
us test vault imports before the wave.

**Body:**

> Your email is confirmed, and your spot on the founding list is held.
>
> Three things founding status means:
>
> - The founding price, locked for life if you upgrade. Plus is $4/month; it
>   becomes $6 at general availability.
> - A direct line to the person building this. Reply to any of these emails and
>   I read it.
> - Beta access in spot order. Invites go out in waves, not all at once.
>
> What happens next: about one email a week until your wave is called. No
> countdown timers, no daily nudges. When your invite is ready it comes from
> this address, with a link that belongs to you.
>
> One request. If your vault has plugins, deep folder nesting, or callouts other
> importers mangle, reply and tell me. We test imports against real vaults
> before each wave, and the strange ones are the useful ones.
>
> — Harsh, Lekhan

**Button:** Check what survives import
**Link:** `https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-1-position`

**Plain text:**

```text
Your email is confirmed, and your spot on the founding list is held.

Three things founding status means:

- The founding price, locked for life if you upgrade. Plus is $4/month; it
  becomes $6 at general availability.
- A direct line to the person building this. Reply to any of these emails and
  I read it.
- Beta access in spot order. Invites go out in waves, not all at once.

What happens next: about one email a week until your wave is called. No
countdown timers, no daily nudges. When your invite is ready it comes from
this address, with a link that belongs to you.

One request. If your vault has plugins, deep folder nesting, or callouts other
importers mangle, reply and tell me. We test imports against real vaults
before each wave, and the strange ones are the useful ones.

- Harsh, Lekhan

Check what survives import:
https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-1-position

Unsubscribe: {{unsubscribe}}
```

**Merge tags:** `{{unsubscribe}}` only.

---

## 4. Email 2 — The import story

**Send:** day 3, 10:00 IST · **Segment:** confirmed, not activated ·
**Exit:** activated, unsubscribed

**Subject:** What survives when you import a vault
**Preview text:** Wikilinks, callouts, frontmatter, tags — and the report that
names exactly what didn't make it.

**Body:**

> Most importers say the move worked. Then you open a page and your
> [[wikilinks]] are plain text.
>
> We built the import the other way around: check what mapped, then tell you
> exactly what didn't.
>
> What comes across today:
>
> - Wikilinks become real links in the graph, not strings that look like links.
> - Callouts keep their type and their content.
> - Frontmatter and tags stay attached to the page.
> - Folders become your page tree.
>
> What doesn't map is named. Every import ends with a fidelity report: pages
> imported, links resolved, links pointing at notes you never created, callouts
> it couldn't classify. Nothing disappears quietly.
>
> Your source vault is read, never rewritten. Export back to markdown whenever
> you want — md, html, pdf, or docx.
>
> If a note imports badly, send me the file. It becomes a test case before the
> next wave.
>
> — Harsh, Lekhan

**Button:** See how import works
**Link:** `https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-2-import`

**Plain text:**

```text
Most importers say the move worked. Then you open a page and your
[[wikilinks]] are plain text.

We built the import the other way around: check what mapped, then tell you
exactly what didn't.

What comes across today:

- Wikilinks become real links in the graph, not strings that look like links.
- Callouts keep their type and their content.
- Frontmatter and tags stay attached to the page.
- Folders become your page tree.

What doesn't map is named. Every import ends with a fidelity report: pages
imported, links resolved, links pointing at notes you never created, callouts
it couldn't classify. Nothing disappears quietly.

Your source vault is read, never rewritten. Export back to markdown whenever
you want - md, html, pdf, or docx.

If a note imports badly, send me the file. It becomes a test case before the
next wave.

- Harsh, Lekhan

See how import works:
https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-2-import

Unsubscribe: {{unsubscribe}}
```

**Merge tags:** `{{unsubscribe}}` only.

---

## 5. Email 3 — The AI stance

**Send:** day 7, 10:00 IST · **Segment:** confirmed, not activated ·
**Exit:** activated, unsubscribed

**Subject:** Why we don't sell you AI credits
**Preview text:** Bring your own key, run a local model, or use the built-in
allowance. Here's the honest version.

**Body:**

> AI is turning into the line item every notes app learns to love. We went the
> other way.
>
> Bring a key from OpenAI, Anthropic, Gemini, or Sarvam — or point Lekhan at a
> custom endpoint. Cloud calls are relayed through our API to the provider you
> chose, using your key. We don't take a cut of inference, and on your own key
> AI never touches your plan credits.
>
> If you'd rather keep inference off someone else's servers, run a local model
> with Ollama. Those requests go from your browser to your machine. They don't
> pass through us.
>
> No key and no local model? The built-in Sarvam actions — chat, translate,
> text-to-speech, transliteration — run on a small plan-credit allowance. That
> is the one place a credit count exists, and I'd rather say so plainly than
> bury it.
>
> The stance in one line: AI costs what your provider charges, or nothing but
> your hardware.
>
> — Harsh, Lekhan

**Button:** See how AI works here
**Link:** `https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-3-ai`

**Plain text:**

```text
AI is turning into the line item every notes app learns to love. We went the
other way.

Bring a key from OpenAI, Anthropic, Gemini, or Sarvam - or point Lekhan at a
custom endpoint. Cloud calls are relayed through our API to the provider you
chose, using your key. We don't take a cut of inference, and on your own key
AI never touches your plan credits.

If you'd rather keep inference off someone else's servers, run a local model
with Ollama. Those requests go from your browser to your machine. They don't
pass through us.

No key and no local model? The built-in Sarvam actions - chat, translate,
text-to-speech, transliteration - run on a small plan-credit allowance. That
is the one place a credit count exists, and I'd rather say so plainly than
bury it.

The stance in one line: AI costs what your provider charges, or nothing but
your hardware.

- Harsh, Lekhan

See how AI works here:
https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-3-ai

Unsubscribe: {{unsubscribe}}
```

**Merge tags:** `{{unsubscribe}}` only.

---

## 6. Email 4 — Your invite

**Send:** event-triggered on invite issuance, not a fixed day · **Segment:**
confirmed contact with an invite token issued and no activated workspace ·
**Exit:** workspace activated, unsubscribed

This is the one email that needs a per-contact link. Until `INVITE_URL` is a
Brevo attribute (P3), send it from the Brevo UI as a manual/batch send with the
link pasted per recipient, or send it from the app's invite flow and keep this
copy as the body.

**Subject:** Your founding invite is ready
**Preview text:** Your invite link, the first three things to do in week one,
and one request: tell me what breaks.

**Body:**

> Your wave is up. Here is your invite: **[INVITE LINK]**
>
> Three things to do first, in this order:
>
> 1. Import your vault. If it's large, start with one folder — the fidelity
>    report tells you what mapped.
> 2. Share one page and invite one person. Collaboration is the part that's
>    hard to describe and easy to feel.
> 3. Break something. Reply with what happened. Founding-cohort reports go
>    ahead of the public backlog.
>
> Your founding price stays locked for as long as your workspace exists. No
> card is needed during the beta.
>
> If the link doesn't work, reply and I'll send a fresh one.
>
> — Harsh, Lekhan

**Button:** Open my workspace
**Link:** `[INVITE LINK]?utm_source=brevo&utm_medium=email&utm_campaign=founding_invite&utm_content=email-4-invite`
(the `/invite/[token]` route ignores extra query params; the token stays intact)

**Plain text:**

```text
Your wave is up. Here is your invite: [INVITE LINK]

Three things to do first, in this order:

1. Import your vault. If it's large, start with one folder - the fidelity
   report tells you what mapped.
2. Share one page and invite one person. Collaboration is the part that's
   hard to describe and easy to feel.
3. Break something. Reply with what happened. Founding-cohort reports go
   ahead of the public backlog.

Your founding price stays locked for as long as your workspace exists. No
card is needed during the beta.

If the link doesn't work, reply and I'll send a fresh one.

- Harsh, Lekhan

Open my workspace:
[INVITE LINK]?utm_source=brevo&utm_medium=email&utm_campaign=founding_invite&utm_content=email-4-invite

Unsubscribe: {{unsubscribe}}
```

**Merge tags:** `{{unsubscribe}}`; `{{contact.INVITE_URL}}` only after P3 is
fixed. Do not send with a literal `[INVITE LINK]`.

---

## 7. Tracking and merge tags

Provisional taxonomy, to be frozen by SIL-226. Every link in every email uses
this grammar — no free-text variants.

| Key | Allowed value |
|---|---|
| `utm_source` | `brevo` |
| `utm_medium` | `email` |
| `utm_campaign` | `founding_welcome` (emails 1–3) · `founding_invite` (email 4) |
| `utm_content` | `email-1-position` · `email-2-import` · `email-3-ai` · `email-4-invite` |

Merge tags used: `{{unsubscribe}}` (required in every marketing send).
`{{contact.FOUNDING_POSITION}}`, `{{contact.INVITE_URL}}`,
`{{contact.CONFIRMED_AT}}` are **not** available today — see §2.

Reply attribution: replies go to a human inbox; log them manually against the
contact in Brevo for the first cohort. `?ref=` referral attribution is separate
from `utm_source` and preserved by the waitlist until the contact record
(`docs/marketing/early-access-playbook.md`).

### Metrics plan

| Metric | Where | Healthy first-cohort signal |
|---|---|---|
| Confirm → email 1 open | Brevo | >50% (transactional-adjacent, warm) |
| Email 1/2/3 click-through | Brevo + UTM in GA4 | 8–15% |
| FAQ click-through | GA4 (`utm_content` breakdown) | rising across the sequence |
| Replies | Human inbox | any substantive reply is a win; log per contact |
| Unsubscribe per email | Brevo | <1% |
| Invite → first import | product (`beta_activated`) | the real activation number, owned by #83 |

Do not optimise on open rate alone — Apple Mail privacy inflates it. Click and
reply are the honest signals at this list size.

---

## 8. Claims audit

Every factual claim in the four emails, and where it is allowed from:

| Claim | Source |
|---|---|
| Founding price locked for life; Plus $4, standard $6 | `docs/marketing/founding-cohort-launch.md` pricing table |
| Invites go out in waves, in spot order | `docs/marketing/founding-cohort-launch.md` signup-flow rules |
| Import preserves wikilinks, callouts, frontmatter, tags; fidelity report | `.agents/product-marketing.md` proof points; `/faq` |
| Source vault read-only; export md/html/pdf/docx | `.agents/product-marketing.md` proof points |
| BYOK providers OpenAI/Anthropic/Gemini/Sarvam/custom; relayed with your key | `/faq` AI answer; `.agents/product-marketing.md` |
| Local model via Ollama, browser-to-machine | `/faq` AI answer |
| Built-in Sarvam actions use plan credits without a key | `/faq` AI answer |
| 500-spot cap | `/early` `FOUNDING_CAP`; launch plan |

Deliberately absent: user counts, testimonials, E2E encryption, mobile apps,
databases/views, response-time promises, revenue or growth numbers.

Voice check: no banned words (`game-changer`, `revolutionary`, `seamless`,
`supercharge`, `effortless`, `10x`). Plain, specific, first person, short
paragraphs.

---

## 9. Human send checklist (Brevo UI)

Nothing below happens automatically from this task.

1. **List** — create/confirm the `founding_waitlist` list in Brevo.
2. **Import confirmed contacts** — export from Supabase
   `waitlist` where `confirmed_at is not null`, with `email`, `utm_source`,
   `position`, `referred_by`; import to the list. Keep `UTM_SOURCE` intact.
3. **Suppression** — exclude anyone already activated, unsubscribed, or
   hard-bounced.
4. **Templates** — import the four templates from SIL-224, paste subject and
   preview text from §3–§6, verify links carry the exact UTM strings.
5. **Sender** — set sender to the `WAITLIST_CONFIRM_FROM` address; set reply-to
   to a monitored human inbox.
6. **Test sends** — send all four to an internal address; check mobile width,
   dark mode, button target size, and that plain-text renders.
7. **Automation** — build the 3-email timed flow per SIL-225; do not add email 4
   to it (event-triggered, manual link).
8. **Proofread gate** — a human other than the copywriter reads all four aloud.
9. **Activate** — only after steps 1–8; record who activated and when.
10. **Watch** — first 24h: bounces, unsubscribes, replies. If unsubscribes
    exceed 2% on any email, pause the flow and review.
11. **Kill switch** — pause the automation in Brevo → export the contact list →
    note the reason on SIL-201.

---

## 10. Handoffs

| Next deliverable | Issue | What it consumes from here |
|---|---|---|
| HTML + text templates, merge-tag map | SIL-224 | §3–§6 copy, UTM strings |
| Send schedule, automation wiring, HITL gate | SIL-225 | §1 timing, §2 P1–P4, §9 checklist |
| Tracking spec and UTM registry | SIL-226 | §7 taxonomy, metrics plan |

Open questions for the humans: confirm the signatory name and sender mailbox
(§2 P4), and decide whether `FOUNDING_POSITION` personalisation is worth the
engineering change (P2).
