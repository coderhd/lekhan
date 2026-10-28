# #29 Billing — manual QA script (T14d)

> **Scope:** the H0 real-billing rails before the BUILD-complete gate (spec §9/§14).
> Automated coverage lives in `tests/unit/billing-*.test.ts`; this script is for the
> provider-side and browser flows those tests cannot exercise.
>
> **Environments:** local fake rail (`LEKHAN_FAKE_PAYMENTS=1`) for the UI walkthrough;
> Stripe test mode + Razorpay test mode for the live sandbox passes. Never use live keys.
>
> **Evidence:** record pass/fail + screenshots or terminal output per step in the
> dispatch issue/PR. A failure is a defect, not a note.

## 0. Preconditions

- [ ] `.env.local` has every key from `.env.example` (Stripe secret + webhook secret + all
      `STRIPE_PRICE_*`, Razorpay key id/secret + webhook secret + all `RAZORPAY_PLAN_*`,
      `BILLING_TRANSFER_TOKEN_SECRET`, `CRON_SECRET`, `LEKHAN_FAKE_PAYMENTS` unset for live passes).
- [ ] Both webhook endpoints are registered in the provider dashboards:
      `/api/billing/webhooks/stripe` and `/api/billing/webhooks/razorpay`.
- [ ] Stripe Billing Portal is configured with **subscription updates enabled** (PDEC-12).
- [ ] A test workspace with one collaborator account for the transfer pass.

## 1. Fake-rail UI walkthrough (`LEKHAN_FAKE_PAYMENTS=1`)

- [ ] Settings → Billing renders real state (tier, cycle, renewal date, plan cards).
- [ ] No credit counter or credit-rate table exists anywhere (AI Usage tab explains BYOK/BYOL).
- [ ] Currency picks ₹/ \$ explicitly; Team on INR shows **“Pay internationally in USD”**.
- [ ] Founding workspace shows the founding badge and founding prices; GA workspace does not.
- [ ] Checkout from Plus/Pro opens the fake checkout URL and the webhook mirror updates the row.
- [ ] Cancel → “Cancels on <date>” appears; entitlement continues to period end.
- [ ] Resubscribe against the detaching predecessor starts a successor checkout (no 409).
- [ ] Free CTA never opens a checkout.
- [ ] Referral card shows banked/applied months and the cap.

## 2. Stripe test-mode pass

Use `stripe listen --forward-to localhost:3000/api/billing/webhooks/stripe` for the whole run.

- [ ] Checkout `4242 4242 4242 4242` (success) → webhook read-back applies Pro, mirror updates,
      `gateway_customer_id` + `gateway_subscription_id` persisted from authenticated state only.
- [ ] Checkout `4000 0000 0000 0002` (decline) → payment fails, no entitlement, honest error.
- [ ] Checkout `4000 0025 0000 3155` (3DS required) → challenge completes; entitlement applies.
- [ ] Portal round-trip: manage billing opens the portal; card update returns; plan change in the
      portal (upgrade) applies immediately/prorated; downgrade schedules at period end.
- [ ] Cancel via our button → `cancel_at_period_end` true on re-read; UI shows the date.
- [ ] Renewal: `stripe trigger invoice.paid` → referral ledger settles if banked months exist.
- [ ] `stripe trigger invoice.payment_failed` → grace banner, full features for 7 days.
- [ ] Replay the same event id twice → second is a no-op (idempotent).
- [ ] Tamper the signature header → 400, no row, no effect.

## 3. Razorpay test-mode pass

- [ ] INR Plus checkout via UPI test handle → subscription authenticated webhook applies Plus.
- [ ] INR Pro checkout via test card → applies Pro; currency stays INR (never Stripe).
- [ ] Team + INR is refused with the explicit USD signal.
- [ ] Our cancel button → provider accepts end-of-cycle cancel; UI states “cancels at end of
      period” (our accepted instruction) and the paid remainder stays honored.
- [ ] Card-update link opens the hosted payment page (no Stripe-style portal session).
- [ ] Replay a signed fixture into the webhook → idempotent; bad HMAC → 400.

## 4. Missed-webhook drill

- [ ] Stop the webhook forwarder. Change the subscription in the provider dashboard
      (e.g. cancel at period end).
- [ ] Run `/api/cron/billing-reconcile` with `Authorization: Bearer $CRON_SECRET`.
- [ ] Row converges to provider truth (status/period/cancel flag) with no `gateway_events` row.
- [ ] Re-run the cron → no-op (idempotent).

## 5. Ownership transfer (US-8)

- [ ] Owner nominates a collaborator without a workspace → transfer prepared; outgoing
      subscription is cancelled at period end and **verified by provider read-back**.
- [ ] Successor opens `/settings?transfer=…`, lands on Collaborators, accepts.
- [ ] Workspace keeps its plan to period end; pages/members survive; old owner’s
      `gateway_customer_id` is cleared (portal cannot show their cards).
- [ ] Successor checkout is permitted against the detaching predecessor and blocked against a
      live non-detaching one.
- [ ] Expired/tampered token is rejected; replay after acceptance conflicts.

## 6. Cron + dashboard hygiene

- [ ] `vercel.json` registers `/api/cron/billing-reconcile` (04:30 UTC) and
      `/api/cron/retention-prune`; both reject a missing/wrong `CRON_SECRET`.
- [ ] Provider dashboards show recent successful deliveries for both endpoints.
- [ ] `.env.example` has no real secrets; no `NEXT_PUBLIC_*` billing secret exists.

## Sign-off

| Section | Result | Evidence link | Tester | Date |
|---|---|---|---|---|
| 1 fake rail |  |  |  |  |
| 2 Stripe |  |  |  |  |
| 3 Razorpay |  |  |  |  |
| 4 missed webhook |  |  |  |  |
| 5 transfer |  |  |  |  |
| 6 cron/dashboard |  |  |  |  |
