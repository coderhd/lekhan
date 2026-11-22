# H0 hosted workspace checkout

Billing is available in the cloud workspace for signed-in owners. The same workspace plan controls collaboration, version history, and cloud sync. Local writing and key-based AI remain available on Free.

## Staging setup

1. Verify that the workspace plan, gateway event, and founding roster migrations are applied first. Apply the rebuild checkout migration after them. It adds checkout reservations and transactional event application to the existing billing schema. This migration belongs with the rebuilt billing routes.
2. Configure the application origin with `LEKHAN_PUBLIC_URL`. Use test payment credentials on staging. The `.env.example` entries bind each tier, cycle, currency, and founding eligibility to a provider price. A checkout checks the live price object against the catalog before creating a session.
3. Stripe uses USD subscription prices. Configure Team as a volume price with 2–10, 11–25, and 26 or more seats. Each band applies to all seats. Set separate portal configuration IDs for founding and standard workspaces. Each configuration can expose only its cohort’s prices and can adjust seat counts only for Team. Set cancellation at period end. [Stripe tiered pricing](https://docs.stripe.com/subscriptions/pricing-models/tiered-pricing) · [Stripe portal configurations](https://docs.stripe.com/api/customer_portal/configurations/object)
4. Razorpay uses INR subscription plans for Plus and Pro. Configure monthly and annual plans and test hosted subscription links with the supported payment methods. [Razorpay subscription API](https://razorpay.com/docs/api/payments/subscriptions/create-subscription)
5. Configure the provider endpoints at `/api/billing/webhooks/stripe` and `/api/billing/webhooks/razorpay`. Subscribe Stripe to checkout completion, subscription lifecycle, invoice paid, and invoice payment failures. Subscribe Razorpay to subscription authentication, activation, charge, payment pending and halted, updates, and cancellation or completion. Validate retry behavior in each dashboard. [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) · [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test)

## Verification before enabling live checkout

- Check both currencies and cycles with separate founding and standard accounts. Compare the displayed totals and checkout totals. For USD Team, check at least 10, 11, 25, and 26 seats.
- Open the same checkout in two tabs. Verify that both requests reach the same hosted session or that the concurrent request receives the existing-checkout message. A successful return alone leaves the plan unchanged until the signed provider event is processed.
- Verify successful renewal, cancellation at period end, failed payment and the grace window, and another checkout after confirmed cancellation. Check that members retain their existing access throughout the paid period.
- Deliver duplicate and delayed notifications for each provider. Compare the resulting workspace plan to the provider’s current subscription and confirm the gateway event is processed once.

Provider uncertainty leaves the reservation in place to prevent duplicate subscriptions. A Razorpay attempt that loses its response before a hosted reference is saved requires provider reconciliation. Automated reconciliation, referral credits, ownership transfer, Razorpay scheduled plan changes, and purchase analytics still need rebuild integration.
