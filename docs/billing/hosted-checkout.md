# H0 hosted workspace checkout

Billing is available in the cloud workspace for signed-in owners. The same workspace plan controls collaboration, version history, and cloud sync. Local writing and key-based AI remain available on Free.

## Staging setup

1. Verify that the workspace plan, gateway event, referral ledger, and founding roster migrations are applied first. Apply the rebuild checkout, reconciliation, plan-change, referral grants, Stripe referral redemption, workspace ownership transfer, and billing analytics migrations in order, alongside the rebuilt billing routes. The referral grants also require the rebuild waitlist schema.
2. Configure the application origin with `LEKHAN_PUBLIC_URL`. Use test payment credentials on staging. The `.env.example` entries bind each tier, cycle, currency, and founding eligibility to a provider price. A checkout checks the live price object against the catalog before creating a session.
3. Stripe uses USD subscription prices. Configure Team as a volume price with 2–10, 11–25, and 26 or more seats. Each band applies to all seats. Set separate portal configuration IDs for founding and standard workspaces. Each configuration can expose only its cohort’s prices and can adjust seat counts only for Team. Set cancellation at period end. [Stripe tiered pricing](https://docs.stripe.com/subscriptions/pricing-models/tiered-pricing) · [Stripe portal configurations](https://docs.stripe.com/api/customer_portal/configurations/object)
4. Razorpay uses INR subscription plans for Plus and Pro. Configure monthly and annual plans and test hosted subscription links with the supported payment methods. [Razorpay subscription API](https://razorpay.com/docs/api/payments/subscriptions/create-subscription)
5. Configure the provider endpoints at `/api/billing/webhooks/stripe` and `/api/billing/webhooks/razorpay`. Subscribe Stripe to checkout completion, subscription lifecycle, invoice paid, and invoice payment failures. Subscribe Razorpay to subscription authentication, activation, charge, payment pending and halted, updates, and cancellation or completion. Validate retry behavior in each dashboard. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) · [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test)

## Verification before enabling live checkout

- Check both currencies and cycles with separate founding and standard accounts. Compare the displayed totals and checkout totals. For USD Team, check at least 10, 11, 25, and 26 seats.
- Open the same checkout in two tabs. Verify that both requests reach the same hosted session or that the concurrent request receives the existing-checkout message. A successful return alone leaves the plan unchanged until the signed provider event is processed.
- Verify successful renewal, cancellation at period end, failed payment and the grace window, and another checkout after confirmed cancellation. Check that members retain their existing access throughout the paid period.
- Deliver duplicate and delayed notifications for each provider. Compare the resulting workspace plan to the provider’s current subscription and confirm the gateway event is processed once.

## Reconciliation

Vercel schedules `/api/cron/billing-reconcile` daily at 04:30 UTC. Set `CRON_SECRET` in the same app environment and send it as a Bearer token for a manual staging run. The job retries authenticated webhooks saved before a failure, checks linked subscriptions, and looks for provider checkouts that lost their response. Owners can also select **Check payment status** while a checkout is pending. [Vercel cron scheduling](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

Each run claims up to 10 unfinished Stripe redemptions, 10 webhooks, 12 pending checkouts, and 40 linked subscriptions. A short lease releases unfinished work after 15 minutes. Inspect the job counts and run another staging sweep when testing a backlog. A response with billing failures, unresolved reservations, or deferred billing work returns HTTP 503. Analytics delivery reports its own failure count.

To rehearse a missed webhook, finish a test checkout with webhook delivery disabled, then run the reconciliation endpoint. Check that the workspace moves to the paid plan and that another run leaves the paid period unchanged. Repeat with a provider-confirmed failed payment and a renewal. For a lost checkout response, remove the reference only from a disposable checkout fixture and verify that reconciliation matches its provider metadata to the reserved workspace.

An unlocated checkout stays reserved until the provider can confirm what happened. An expired or terminated provider checkout can be replaced.

## INR plan changes

Owners can schedule or withdraw a plan change in workspace billing. The page uses Razorpay’s live schedule and keeps the current entitlement through the billing cycle. A verified event or reconciliation updates the entitlement after Razorpay switches the plan. Razorpay restricts in-place changes for subscriptions authorized by UPI or e-mandate. For those payment methods, owners can end the existing subscription at renewal and begin a new checkout after it ends. Verify the card and UPI paths in the provider test environment. [Razorpay subscription changes](https://razorpay.com/docs/api/payments/subscriptions/update-subscription) · [Razorpay scheduled update details](https://razorpay.com/docs/api/payments/subscriptions/fetch-pending-update-details)

## Referral credits and founding pricing

The referral link in workspace billing carries the referrer’s account code through signup. A verified account can also inherit its confirmed waitlist attribution. A referral banks one month when the invitee creates a cloud workspace and one more when the first paid subscription activates. A referrer without a workspace keeps the grants in the ledger until their workspace is created. The service-managed `rebuild_referral_rules.annual_bank_cap` defaults to 12 months and applies to the UTC year and the outstanding balance.

Founding eligibility comes from existing grants and the first 500 waitlist places with verified attribution. Review unmatched roster rows before closing the founding cohort. For each approved row, an operator calls `rebuild_record_reviewed_founder` with the verified account ID and roster row ID. The function checks a unique verified email match and an unlocked workspace. Review evidence belongs in the cohort QA record. [Accepted founding roster decision](https://github.com/coderhd/lekhan/blob/main/docs/adr/0005-founding-roster-predicate-boundaries.md)

On a verified paid Stripe renewal, the eligible banked months become a customer invoice balance adjustment. An annual subscription credits at the monthly value of its cohort and current tier. Stripe applies the balance to later invoices. The rebuild settles the banked months when it verifies the posting, and the billing period still comes from Stripe. Razorpay months stay banked under the H0 pricing decision. [Stripe customer invoice balance](https://docs.stripe.com/billing/customer/balance)

If a worker loses the response, recovery looks for the original provider transaction and uses the same reservation and idempotency key inside its retry window. After that window, an unverified posting requires review. An unstarted reservation releases its banked months when the subscription ends. Any claims left by the legacy billing worker need review before switching redemption to the rebuild. [Stripe idempotency retention](https://docs.stripe.com/api/idempotent_requests)

## Workspace ownership transfer

The owner creates a seven-day transfer link for an existing verified account from Workspace billing. Starting a new transfer replaces the previous link. The named account accepts while signed in. Acceptance changes billing ownership. Individual page permissions stay in place, including any page shares already granted to the recipient.

On acceptance, Stripe schedules cancellation at the current period end and returns both the schedule and the effective date for verification. The schedule prevents an existing portal session from changing the subscription during handover. For Razorpay, the app records the provider’s accepted cycle-end cancellation and fetches the subscription to verify its state. A scheduled plan change or an unresolved payment can delay transfer. [Stripe subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules) · [Stripe portal limitations](https://docs.stripe.com/customer-management#limitations) · [Razorpay subscription cancellation](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription)

The owner swap and removal of the old payment identity share one transaction. The paid period remains on the workspace. Checkout under the new owner uses their own founding eligibility and payment details. Unused referral grants stay with the account that earned them.

Run a staging transfer on each provider with two verified accounts and an active paid period. Confirm that the previous owner cannot restart renewals through an already opened payment-management session. Confirm the paid period survives the swap, the predecessor cannot bill again, and a new checkout activates under the successor’s own payment identity. Deliver a late event from the predecessor and compare the plan and customer against the new subscription.
