# #29 Billing — manual QA script (T14d)

> **Scope:** the H0 real-billing rails before the BUILD-complete gate (spec §9/§14).
> Automated coverage lives in `tests/unit/billing-*.test.ts`; this script is for the
> provider-side and browser flows those tests cannot exercise.
>
> **Environments:** local fake rail (`LEKHAN_FAKE_PAYMENTS=1`) for rendering checks only;
> Stripe test mode + Razorpay test mode for every lifecycle flow. Never use live keys,
> never point this script at the production project.

## Evidence rules (read before recording anything)

- **Never capture secrets.** `stripe listen` prints the endpoint signing secret
  (`whsec_…`) to the terminal on startup; run it with its banner discarded
  (`stripe listen … 2>&1 | grep -v -i "whsec_\|secret\|ready"` or redirect to a file and
  grep only `[200] POST` delivery lines). Never paste `whsec_…`, `sk_test_…`, `rzp_…`, or a
  full `.env` dump into an issue, PR, comment, or screenshot. Redact provider dashboards
  before screenshotting.
- Evidence = route responses (status + `code`), DB rows (`select` output with ids only),
  provider-dashboard delivery records, and masked UI screenshots.
- **A failure is a defect, not a note.** File it against the epic and stop the pass.

## 0. Preconditions

- [ ] `.env.local` has every key from `.env.example`: `STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, all 12 `STRIPE_PRICE_*`, `RAZORPAY_KEY_ID`,
      `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, all 8 `RAZORPAY_PLAN_*`,
      `CRON_SECRET`, `BILLING_TRANSFER_TOKEN_SECRET`. `LEKHAN_FAKE_PAYMENTS` unset for
      provider passes.
- [ ] Both webhook endpoints are registered in the provider dashboards against a **staging
      origin both providers can reach** (a `localhost` origin cannot receive deliveries;
      use `stripe listen` for Stripe, and a tunnel for Razorpay).
- [ ] Stripe Billing Portal is configured with **subscription updates enabled** (PDEC-12).
- [ ] **Fixtures** (founding and GA are separate accounts because `workspaces.owner_id` is
      `UNIQUE`): owner **F** (founding workspace, `workspace_plans.is_founding = true`),
      owner **G** (GA workspace, `is_founding = false`), collaborator **C** (invite target),
      and successor account **S** for §5.
- [ ] The target DB is disposable for the seed steps below. Three checks need writes that
      are not part of normal product use: seeding `workspace_plans` state (§1), seeding a
      `referral_credit_ledger` row (§1), and removing S's auto-created empty workspace (§5).

## 1. Rendering pass — fake rail (`LEKHAN_FAKE_PAYMENTS=1`)

**What the fake rail actually does:** `createCheckout()` returns the hash URL
`#fake-checkout` and records the subscription **in memory only** — it never writes
`workspace_plans`, and there is no fake webhook mirror. So this section verifies
**rendering of state**, never subscription lifecycle. Lifecycle starts at §2.

Seed `workspace_plans` for F and G directly (disposable DB):

```sql
-- run against the disposable staging DB only
update public.workspace_plans set tier='pro', billing_cycle='monthly', gateway='stripe',
  status='active', currency='USD', gateway_subscription_id='sub_seed_pro',
  current_period_end = now() + interval '20 days', cancel_at_period_end=false
  where workspace_id = '<F-workspace-uuid>';
insert into public.referral_credit_ledger
  (workspace_id, referrer_user_id, invitee_ref, trigger_stage, months)
  values ('<F-workspace-uuid>', '<F-owner-uuid>', 'seed-invitee', 'activation', 2);
update public.workspace_plans set credited_months = 2 where workspace_id = '<F-workspace-uuid>';
```

- [ ] Settings → Billing renders the seeded state: tier, cycle, renewal date, plan cards.
- [ ] No credit counter or credit-rate table exists anywhere; AI Usage explains BYOK/BYOL.
- [ ] Currency picks ₹/ $ explicitly; Team on INR shows **“Pay internationally in USD”**.
- [ ] Founder workspace (F) shows the founding badge and founding prices; GA workspace (G)
      does not.
- [ ] Set `past_due_since = now() - interval '2 days'` → grace banner, entitlements intact.
- [ ] Set `cancel_at_period_end = true` → “Cancels on <date>” and the plan stays active.
- [ ] Referral card shows banked/applied months and the cap from the seeded ledger row.
- [ ] Free CTA is inert — clicking it does **not** fire `POST /api/billing/checkout`
      (DevTools network tab).

> Checkout/cancel/resubscribe are **not** verifiable on the fake rail. They are covered by
> §2 (Stripe) and §3 (Razorpay) against real test-mode subscriptions.

## 2. Stripe test-mode pass

Run `stripe listen --forward-to localhost:3000/api/billing/webhooks/stripe` for the whole
run (see evidence rules for the banner).

- [ ] Checkout `4242 4242 4242 4242` (success) → `checkout.session.completed`, read-back
      applies Pro, `gateway_customer_id` + `gateway_subscription_id` persisted,
      `workspace_plans` mirrors tier/cycle/period.
- [ ] Checkout `4000 0000 0000 0002` (decline) → payment fails, **no** entitlement, honest error.
- [ ] Checkout `4000 0025 0000 3155` (3DS required) → challenge completes; entitlement applies.
- [ ] **Founding-ID isolation:** checkout from G (GA) resolves a GA price ID — inspect the
      created session/`workspace_plans.is_founding` and confirm no `*_FOUNDING_*` ID is used.
      Repeat from F and confirm the founding ID is used.
- [ ] **Annual 2-months-free:** annual checkout for Plus and Pro charges 10× the monthly
      amount on the provider's invoice preview (both rails, §7).
- [ ] Portal round-trip: manage billing opens the portal; update the card and return.
- [ ] Plan change in the portal: upgrade applies immediately/prorated; downgrade schedules at
      period end (portal semantics, PDEC-12).
- [ ] Cancel via our button → re-read shows `cancel_at_period_end = true`; UI shows the date;
      entitlement continues to period end.
- [ ] Resubscribe against the detaching predecessor starts a successor checkout (no 409).
- [ ] **Renewal + referral settlement:** create a Stripe **test clock**, attach the test
      customer, advance past `current_period_end` so Stripe emits a real `invoice.paid`
      (do **not** use `stripe trigger invoice.paid` — synthetic events carry no binding to
      this workspace's subscription and are ignored by the read-back processor). Confirm the
      banked month is consumed and `referral_credit_ledger.applied_at` is set.
- [ ] **Grace:** advance the clock past a renewal with a failing card
      (`4000 0000 0000 0341`) → real `invoice.payment_failed` → grace banner, full features
      for 7 days from `past_due_since`.
- [ ] **Idempotency:** re-deliver the same event id (`stripe events resend <evt_id>`) →
      second delivery is a no-op; `gateway_events` has one row, state unchanged.
- [ ] **Tamper:** POST a copied payload with a modified `stripe-signature` → 400, no
      `gateway_events` row, no state change.

## 3. Razorpay test-mode pass

Use a tunnel origin registered in the Razorpay dashboard (Razorpay cannot reach localhost).

- [ ] INR Plus checkout via UPI test handle → `subscription.authenticated` webhook applies
      Plus; currency stays INR (never Stripe).
- [ ] INR Pro checkout via test card → applies Pro.
- [ ] Team + INR is refused with the explicit USD signal (`tier_unavailable` +
      `requiredCurrency: "USD"`).
- [ ] Our cancel button → provider accepts end-of-cycle cancel; UI states “cancels at end of
      period” (our accepted instruction, R-CANCEL-FLAG) and the paid remainder stays honored.
- [ ] Card-update link opens the hosted payment-page `short_url` (no Stripe-style portal).
- [ ] **Signed fixture replay** — from the repo root, with the dev server running:

      ```bash
      node -e '
        const crypto=require("crypto"),fs=require("fs");
        const body=fs.readFileSync("tests/fixtures/billing/razorpay-subscription-authenticated.json");
        const sig=crypto.createHmac("sha256",process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
        fetch("http://localhost:3000/api/billing/webhooks/razorpay",{method:"POST",
          headers:{"content-type":"application/json","x-razorpay-signature":sig},body}).then(async r=>
          console.log(r.status, await r.text()));'
      ```

      HMAC is over the **exact raw bytes** posted (no re-serialization) and sent hex-encoded
      in `x-razorpay-signature`. Replay the same fixture twice → idempotent (one
      `gateway_events` row). Re-run with a flipped signature → 400, no row, no state change.

## 4. Missed-webhook drill

- [ ] Stop the webhook forwarder/tunnel. Change the subscription in the provider dashboard
      (e.g. cancel at period end).
- [ ] **Reset the freshness watermark** for the test workspace — the reconciler skips rows
      reconciled inside its window, so a fresh `last_checked_at` makes the drill look like a
      false pass/fail:
      `update public.workspace_plans set last_checked_at = now() - interval '2 days' where workspace_id = '<uuid>';`
- [ ] Run `POST /api/cron/billing-reconcile` with `Authorization: Bearer $CRON_SECRET`
      → row converges to provider truth (status/period/cancel flag) with **no** new
      `gateway_events` row (the cron path is read-back, not webhook).
- [ ] Re-run the cron → no-op (idempotent).
- [ ] Missing/wrong `CRON_SECRET` → 401 and no state change.

## 5. Ownership transfer (US-8)

**Fixture reality:** `workspaces.owner_id` is `UNIQUE` and every profile gets a workspace at
signup, so a successor **normally owns one already** and `initiate` intentionally returns
`409 successor_owns_workspace` (`services/billing/ownership-transfer.ts`). Pick one:

- **Path A (happy path, disposable DB only):** sign in as S once (so a profile exists), then
  delete S's empty auto-created workspace (`delete from public.workspaces where owner_id='<S>';`
  — only on a disposable DB; `pages.workspace_id` cascades). Then run the transfer.
- **Path B (no DB surgery):** assert the 409 `successor_owns_workspace` path and record it as
  the covered acceptance case.

Checks (Path A):

- [ ] Owner F nominates S without a workspace → transfer prepared; the outgoing subscription is
      cancelled at period end and **verified by provider read-back** (not inferred).
- [ ] S opens the returned `acceptPath` (`/settings?transfer=…`), lands on Collaborators, accepts.
- [ ] Workspace keeps its plan to period end; pages/members survive; F's
      `gateway_customer_id` is cleared (portal cannot show their cards).
- [ ] S's checkout is permitted against the detaching predecessor and **409** against a live
      non-detaching one.
- [ ] Expired/tampered token is rejected; replay after acceptance conflicts (409).

## 6. Cron + dashboard hygiene

- [ ] `vercel.json` registers `/api/cron/billing-reconcile` (`30 4 * * *`) and
      `/api/cron/retention-prune` (`0 3 * * *`); both reject a missing/wrong `CRON_SECRET`.
- [ ] Both provider dashboards show recent **successful** deliveries to the two webhook
      endpoints (screenshot with keys masked).
- [ ] `.env.example` has no real secrets; no `NEXT_PUBLIC_*` billing secret exists.
- [ ] `gateway_events.payload` is PII-minimized (inspect a stored row: no email, no address,
      no card/brand/last4) and no card data exists anywhere in the DB.

## 7. Spec §14 acceptance cross-check (manual remainder)

- [ ] Annual 2-months-free honored on **both** rails (Stripe USD, Razorpay INR).
- [ ] Founding price lock holds: GA checkout never resolves a founding price ID; a founding
      workspace keeps its cohort price across a renewal (advance the test clock one cycle).
- [ ] Referral credits: granted on invitee activation, **capped** at
      `BILLING_REFERRAL_BANK_CAP_MONTHS` (default 12), and applied end-to-end at renewal
      (§2). Over-grant attempt is rejected with `bank-cap`.
- [ ] Free tier survives: create >5 documents on a free workspace — no doc cap, no credit
      gate, AI paths still gated only by keys/BYOK.
- [ ] **Tenant isolation:** with a second user's session, `GET /api/billing/summary` never
      returns another workspace's row, and `POST /api/billing/{checkout,cancel,portal,transfer}`
      against someone else's workspace returns 401/403/404 — never a provider action.
- [ ] `profiles.plan` mirror parity: after each provider change, the owner's `profiles.plan`
      equals `workspace_plans.tier` (normalized: `go→plus`, `enterprise→free`).

## Sign-off

| Section | Result | Evidence link | Tester | Date |
|---|---|---|---|---|
| 0 preconditions |  |  |  |  |
| 1 fake-rail rendering |  |  |  |  |
| 2 Stripe |  |  |  |  |
| 3 Razorpay |  |  |  |  |
| 4 missed webhook |  |  |  |  |
| 5 transfer |  |  |  |  |
| 6 cron/dashboard |  |  |  |  |
| 7 §14 cross-check |  |  |  |  |
