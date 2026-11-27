# Brevo founding-cohort welcome sequence

This draft combines the copy, templates, and send schedule from [PR #199](https://github.com/coderhd/lekhan/pull/199) and [PR #216](https://github.com/coderhd/lekhan/pull/216). It covers marketing follow-ups for confirmed early-access contacts. Supabase Auth signup and password-reset emails are handled separately.

## How enrollment works today

Lekhan sends the transactional early-access confirmation through Brevo. Confirming the link updates the waitlist in Supabase. The confirmation RPC queues a founding enrollment for positions 1 through 500, and the Brevo outbox worker adds those contacts to the environment's configured founding list. Retrying an already-consumed confirmation leaves one founding job. A signup that has not confirmed may exist in Brevo without being on the founding list. [Waitlist migration](../../supabase/migrations/20261121000002_rebuild_waitlist.sql) · [Brevo delivery code](../../lib/waitlist/brevo.ts)

Use the dedicated founding list for the environment under test. Verify the contact's marketing eligibility and unsubscribe status before sending. Never use the creation of a general contact as the entry event. The current worker does not populate `CONFIRMED_AT`, `FOUNDING_POSITION`, `INVITE_URL`, or `ACTIVATED_AT`. Keep confirmation and position as Supabase evidence. Leave the invite message manual until the release owner can issue and validate the recipient's beta link. The private page invite route is for sharing one page. [Staging and production configuration](../h0-rebuild-status.md)

## Copy and timing

| Message | Subject | Preview text | Send window | Templates |
| --- | --- | --- | --- | --- |
| 1 | You're in. Your founding spot is confirmed | What to expect while we prepare your wave | After confirmed founding enrollment, when approved for the recipient | [HTML](brevo/templates/01-confirm.html) · [Text](brevo/templates/01-confirm.txt) |
| 2 | What survives when you import a vault | Linked notes, nested folders, and the import report | Day 3 target, Tue–Thu from 10:00 to 11:00 IST | [HTML](brevo/templates/02-import-story.html) · [Text](brevo/templates/02-import-story.txt) |
| 3 | Why we built AI around your own keys | Use a provider you choose or run a model on your desktop | Day 7 target, Tue–Thu from 10:00 to 11:00 IST, at least 48 hours after message 2 | [HTML](brevo/templates/03-ai-stance.html) · [Text](brevo/templates/03-ai-stance.txt) |
| 4 | Your founding invite is ready | Your link and three things to try first | Manually after an approved beta invite is issued | [HTML](brevo/templates/04-invite-wave.html) · [Text](brevo/templates/04-invite-wave.txt) |

When a target falls outside the window, move it to the next eligible window. Send at most one sequence message per contact per day. Track the last sent message so retries and list updates do not resend earlier mail. Suppress unsubscribed, blocklisted, bounced, and removed recipients. Stop the sequence when the release owner verifies activation.

In Brevo, test **Contact added to list** on the dedicated staging list, including an API-created membership and a retry. Use scheduled filters for messages 2 and 3 if their clock-time window is needed. For a manual pilot, select confirmed eligible contacts and record each send before moving to the next step. If the automation must stop, verify what happens to contacts already in the workflow and cancel queued campaigns before resuming. [Brevo automation triggers](https://help.brevo.com/hc/en-us/articles/15445989568402-Available-triggers-actions-and-rules-in-an-automation) · [Brevo paused workflows](https://help.brevo.com/hc/en-us/articles/209465385-Why-have-my-contacts-not-been-added-to-an-automation)

## Staging rehearsal

1. Use a sanctioned test inbox and the verified Brevo sender. Check the Reply-To address, footer details, rendered unsubscribe link, and mobile layout for each test message. [Brevo template variables](https://help.brevo.com/hc/en-us/articles/360000946299-Personalize-your-messages-with-dynamic-content-Brevo-Template-Language)
2. Record that an unconfirmed signup is absent from the founding list. Confirm a disposable eligible signup, verify one list enrollment, then repeat the submission and confirmation. Verify contacts beyond the first 500 are excluded.
3. Render the copy and send only to the approved test inbox. Check delivery and exit behavior with disposable contacts. Enter a test recipient-specific beta URL for message 4 and verify it opens the intended Preview. The invite template contains an explicit operator placeholder until that URL is supplied.
4. Record enrollment, send, unsubscribe, and duplicate-check results for the release owner. Keep production campaigns inactive until the owner approves the audience, sender, and rehearsal evidence.
