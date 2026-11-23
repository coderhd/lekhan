# H0 hosted workspace checkout

Billing is available in the cloud workspace for signed-in owners. The same workspace plan controls collaboration, version history, and cloud sync. Local writing and key-based AI remain available on Free.

## Staging setup

1. Verify that the workspace plan, gateway event, and founding roster migrations are applied first. Apply the rebuild checkout and reconciliation migrations in order, alongside the rebuilt billing routes.
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

Each run claims up to 10 webhooks, 12 pending checkouts, and 40 linked subscriptions. A short lease releases unfinished work after 15 minutes. Inspect the job counts and run another staging sweep when testing a backlog. A response with failures, unresolved reservations, or deferred work returns HTTP 503.

To rehearse a missed webhook, finish a test checkout with webhook delivery disabled, then run the reconciliation endpoint. Check that the workspace moves to the paid plan and that another run leaves the paid period unchanged. Repeat with a provider-confirmed failed payment and a renewal. For a lost checkout response, remove the reference only from a disposable checkout fixture and verify that reconciliation matches its provider metadata to the reserved workspace.

An unlocated checkout stays reserved until the provider can confirm what happened. An expired or terminated provider checkout can be replaced. Referral credits, ownership transfer, Razorpay scheduled plan changes, and purchase analytics still need rebuild integration.
