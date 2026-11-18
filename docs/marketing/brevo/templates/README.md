# Brevo welcome templates — founding cohort

Import-ready HTML + plain-text versions of the four founding-cohort welcome
emails, built from the send-ready copy in
[`../../brevo-welcome-sequence.md`](../../brevo-welcome-sequence.md) (SIL-223).

**Nothing in this directory has been created in Brevo.** These are files for a
human to import through the Brevo UI. There are no API calls, no credentials,
and no sends in this task.

| | |
|---|---|
| Source copy | `docs/marketing/brevo-welcome-sequence.md` §3–§6 (SIL-223, PR #199 — stacked on this branch) |
| Templates | SIL-224 (this deliverable) |
| Automation / schedule | SIL-225 |
| Tracking spec | SIL-226 |
| Previews | [`previews/`](previews/) — rendered from these exact files |

---

## 1. Files

| Email | HTML | Plain text | Campaign / content |
|---|---|---|---|
| 1 · Spot confirmed | [`01-confirm.html`](01-confirm.html) | [`01-confirm.txt`](01-confirm.txt) | `founding_welcome` / `email-1-position` |
| 2 · The import story | [`02-import-story.html`](02-import-story.html) | [`02-import-story.txt`](02-import-story.txt) | `founding_welcome` / `email-2-import` |
| 3 · The AI stance | [`03-ai-stance.html`](03-ai-stance.html) | [`03-ai-stance.txt`](03-ai-stance.txt) | `founding_welcome` / `email-3-ai` |
| 4 · Your invite | [`04-invite-wave.html`](04-invite-wave.html) | [`04-invite-wave.txt`](04-invite-wave.txt) | `founding_invite` / `email-4-invite` |

Each `.html` file is a complete document (doctype → `</html>`) with one column,
inline CSS, and a single button. Each `.txt` file is the plain-text body,
matching the copy document's plain-text blocks. There is no hidden preheader in
the HTML: the inbox preview comes from Brevo's "Preview text" field (§2),
so the two never duplicate each other.

## 2. Subject and preview text

Paste these into the Brevo template fields. They are copied verbatim from
§3–§6 of the sequence doc.

**01-confirm**

```text
Subject: You're in — your founding spot is confirmed
Preview: What your spot gets you, when invites go out, and how to help us test vault imports before the wave.
```

**02-import-story**

```text
Subject: What survives when you import a vault
Preview: Wikilinks, callouts, frontmatter, tags — and the report that names exactly what didn't make it.
```

**03-ai-stance**

```text
Subject: Why we don't sell you AI credits
Preview: Bring your own key, run a local model, or use the built-in allowance. Here's the honest version.
```

**04-invite-wave**

```text
Subject: Your founding invite is ready
Preview: Your invite link, the first three things to do in week one, and one request: tell me what breaks.
```

## 3. Merge tags

| Tag | Used in | What Brevo does with it | Requirement |
|---|---|---|---|
| `{{unsubscribe}}` | every email — footer (`href` in HTML, last line in text) | Replaces with the contact's unsubscribe URL | Required on every marketing send. Must stay a link in the HTML. Brevo's docs also write this tag with spaces (`{{ unsubscribe }}`); both forms normally parse, but the test send is the proof. |
| `{{senderAddress}}` | every email — footer | **Not confirmed in Brevo's public tag reference.** If it resolves, it renders the postal address saved on the sender; if it ships literally, the footer is non-compliant | Mandatory check in the step-7 test send: if `{{senderAddress}}` appears as text, replace it with the hard-coded postal address before sending. |
| `{{contact.INVITE_URL}}` | email 4 only — body link, button `href`, text body | Per-contact invite URL, `https://lekhan.online/invite/<token>` | **Not available yet (P3).** Nothing writes this attribute to the contact today. See §8. |
| `{{contact.FIRSTNAME}}` | *not used* | Contact attribute | Available, deliberately unused: signup collects email only and the copy is written to read correctly with no personalisation. Do not add it without testing the empty-value behaviour first (blank unless a value-if-empty is configured). |
| `{{contact.LASTNAME}}` | *not used* | Contact attribute | Same as above. |

Rules for whoever edits these files:

- Never leave `[INVITE LINK]` in an email. The tag is `{{contact.INVITE_URL}}`.
- Do not add `{{contact.FOUNDING_POSITION}}` or `{{contact.CONFIRMED_AT}}` —
  neither is a Brevo attribute today (§2 P2 and P1 of the sequence doc).
- Brevo's own tag picker is the final authority on syntax. In the editor a
  valid tag may show either as a yellow chip or as plain text, so the chip is
  not proof by itself — the step-7 test send is.

## 4. Field map to Brevo

| Brevo field | Value |
|---|---|
| Template name | `FC-01-confirm`, `FC-02-import-story`, `FC-03-ai-stance`, `FC-04-invite-wave` |
| Template folder | `Founding Cohort` (create on first import) |
| Subject | §2, one per template |
| Preview text | §2, one per template |
| Sender name | `Lekhan` |
| Sender email | the `WAITLIST_CONFIRM_FROM` address — no other sender |
| Reply-to | a monitored human inbox (sequence doc §2 P4) |
| HTML content | the `.html` file, pasted whole |
| Plain text | the `.txt` file, pasted whole |
| List | `founding_waitlist` (created by SIL-225, not by this task) |
| Tags | `founding-cohort`, `welcome-sequence` |
| Automation | **not here** — emails 1–3 are wired in SIL-225; email 4 is manual/event-triggered |

## 5. Link registry

Every link in the templates. These strings are the same as the sequence doc
§3–§6; if one changes, change it in both places.

| Email | Where | Label / text | URL |
|---|---|---|---|
| 1 | button | Check what survives import | `https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-1-position` |
| 2 | button | See how import works | `https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-2-import` |
| 3 | button | See how AI works here | `https://lekhan.online/faq?utm_source=brevo&utm_medium=email&utm_campaign=founding_welcome&utm_content=email-3-ai` |
| 4 | body link | {{contact.INVITE_URL}} | `{{contact.INVITE_URL}}` (untracked, exactly as §6 of the copy doc) |
| 4 | button | Open my workspace | `{{contact.INVITE_URL}}?utm_source=brevo&utm_medium=email&utm_campaign=founding_invite&utm_content=email-4-invite` |

The email-4 body link carries no UTM on purpose: the copy doc's body placeholder
is the bare invite URL, and the tracked link is the button. Do not add a UTM to
the body link without changing the copy doc first.

Footer links are the same in all four: `{{unsubscribe}}` and
`https://lekhan.online`. The wordmark image is the only remote asset:
`https://lekhan.online/logo.png`.

Verify the UTM strings against the copy doc:

```sh
grep -o 'utm_content=email-[0-9]-[a-z]*' docs/marketing/brevo/templates/*.html | sort -u
```

## 6. Previews

Rendered from the committed template files (not mock-ups) at 320px and 600px.
The PNGs are 2× device-pixel-ratio captures (640px and 1200px wide), so they
stay legible on a retina display.

| Email | 320px | 600px | Saved HTML |
|---|---|---|---|
| 1 · Spot confirmed | [PNG](previews/01-confirm-320.png) | [PNG](previews/01-confirm-600.png) | [HTML](previews/01-confirm.html) |
| 2 · Import story | [PNG](previews/02-import-story-320.png) | [PNG](previews/02-import-story-600.png) | [HTML](previews/02-import-story.html) |
| 3 · AI stance | [PNG](previews/03-ai-stance-320.png) | [PNG](previews/03-ai-stance-600.png) | [HTML](previews/03-ai-stance.html) |
| 4 · Invite wave | [PNG](previews/04-invite-wave-320.png) | [PNG](previews/04-invite-wave-600.png) | [HTML](previews/04-invite-wave.html) |

Preview pages substitute sample values for the merge tags (`{{unsubscribe}}`,
`{{senderAddress}}`, and a sample invite token). Screenshots load the wordmark
from the local repository so they do not depend on the live site or on Brevo;
the saved HTML keeps the production wordmark URL. The templates themselves
always keep the real tags.

Regenerate after any template edit:

```sh
node scripts/render-brevo-previews.mjs
# or: npm run render:brevo-previews
```

The script fails if a template overflows horizontally at 320px or 600px, or if
a full-page capture does not cover the whole document, so a layout or capture
regression cannot slip into a committed preview. It runs in Chrome, so the
pixels can shift slightly across machines and Chrome versions — previews are
evidence, not golden files.

## 7. Import checklist (human, Brevo UI)

Do this in order. It ends at import — nothing here creates a campaign, a list,
or an automation.

1. [ ] Confirm the sequence copy on `main` still matches these files. PR #199
       may have changed wording after these templates were built:
       `git diff main -- docs/marketing/brevo-welcome-sequence.md docs/marketing/brevo/templates/`
2. [ ] Brevo → **Marketing → Templates → Create template → Start from
       scratch**, then open the **HTML custom code** editor (the `</>` source
       view). Brevo moves these labels between releases; the editor is the one
       that accepts a full HTML document.
3. [ ] Template 1: name `FC-01-confirm`, paste `01-confirm.html`, set subject
       and preview text from §2, save.
4. [ ] Plain text: in the campaign editor open
       **Design → ··· → View the plain text version → Edit** and paste
       `01-confirm.txt`. Brevo auto-generates a text part from the HTML; this
       replaces it with the reviewed copy. Repeat for the other three.
5. [ ] Repeat steps 3–4 for `02-import-story`, `03-ai-stance`,
       `04-invite-wave`.
6. [ ] Sender: set sender name `Lekhan`, sender email from
       `WAITLIST_CONFIRM_FROM`, reply-to to a monitored human inbox. Open
       Senders & IPs and confirm the postal address is filled in.
7. [ ] Send all four templates to one internal address. In the received mail:
       check the unsubscribe link resolves, `{{senderAddress}}` is a real
       address not a literal tag (if it is literal, replace it with the
       hard-coded postal address and re-test), and no `{{…}}` is visible
       anywhere.
8. [ ] Click every button in the test mail and confirm the URL and UTM string
       match §5 exactly (case-sensitive), including `utm_campaign`.
9. [ ] Check 320px width, 600px width, dark mode, and the plain-text part
       (view source / "show original").
10. [ ] **Stop here.** Do not create the automation (SIL-225), the list, or a
        send from this task. Email 4 cannot be sent by automation until the
        invite URL is written to the contact (§8).

## 8. Known gaps — do not send yet

Lifted from §2 of the sequence doc; repeated here because they block *sending*
even though the files are import-ready.

| Gap | Effect on these templates | Unblock |
|---|---|---|
| **P1** Confirmed contacts never reach Brevo | Emails cannot be triggered on "confirmed"; import confirmed rows manually | SIL-225 (or the manual import in the send checklist) |
| **P3** No per-contact `INVITE_URL` | `04-invite-wave` renders a broken link | SIL-225, or paste the link per recipient and send email 4 manually |
| **P4** Sender mailbox unconfirmed | `{{senderAddress}}` and reply-to cannot be set finally | Human decision on the `WAITLIST_CONFIRM_FROM` mailbox |
| **P5** Brevo DOI is off by design | Do not enable Brevo double opt-in; the app's confirmation is the consent record | — |

Emails 1–3 are safe to import and test now. Email 4 is import-ready but must
not be sent until P3 is resolved.

## 9. Rendering notes

- Max width 600px, fluid down to 320px; outer gutter 12px, card padding 24px.
  The card carries both `width="600"` (so Outlook desktop, which ignores
  `max-width`, stays at 600px) and `width:100%;max-width:600px` (everything
  else).
- One column, one button per email, no `<style>` block, no web fonts, no
  tracking pixel, no external assets except the wordmark.
- Light-only palette (`color-scheme: light`): cream `#f9f8f4`, ink `#191713`,
  muted `#6b655c`, link `#9a5a0b`, CTA `#191713` on cream text.
- Table-based layout with `role="presentation"`; the wordmark has empty `alt`
  because the adjacent text says "Lekhan".
- Buttons use `mso-padding-alt` so Outlook keeps the 48px-tall target instead
  of collapsing the padding on the `<a>`.
- Outlook desktop ignores `border-radius` and the card border renders square —
  expected, no layout break.
