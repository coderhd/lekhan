# #29 provisioning — provider test credentials + staging origin (spec §9)

> **Who does this:** the board/user, once — spec §9 assigns every step here to the
> board/user. Agents never mint, paste, or move these values; if a value ever lands in
> chat or an issue, rotate it and treat the channel as burned.
> **Why:** T14's manual QA pass (`docs/qa/29-billing-manual-qa.md`, the BUILD-complete
> gate) is blocked until all 27 keys exist in the deployment env, a staging origin both
> provider dashboards can reach is live, and both dashboards show registered webhook
> endpoints. Evidence rules (never capture secrets) apply to every step below.
> **Test mode only.** Never live keys, never the production project.

## 0. Staging origin (do this first — everything else points at it)

- [ ] Deploy this repo (`plan/29-real-billing`) to a dedicated **Vercel staging project**
      (e.g. `lekhan-staging.vercel.app`) wired to the staging Supabase project. A
      `localhost` origin cannot receive provider deliveries (QA §0/§3).
- [ ] Set `NEXT_PUBLIC_APP_URL=https://<staging-origin>` in the staging project env — it
      drives checkout/portal return URLs.
- [ ] Record the staging URL on the provisioning issue (the URL is not a secret; values
      from the steps below are).

## 1. The 27 keys (names only — values go in the env, never in an issue)

| # | Key | Comes from |
|---|-----|-----------|
| 1 | `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys (test mode, `sk_test_…`) |
| 2 | `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → webhook endpoint signing secret (`whsec_…`) |
| 3–14 | `STRIPE_PRICE_{PLUS,PRO,TEAM}_{MONTHLY,ANNUAL}_{FOUNDING,GA}_USD` (12) | Price object IDs (`price_…`) created in §2 |
| 15 | `RAZORPAY_KEY_ID` | Razorpay dashboard → API keys (test mode, `rzp_test_…`) |
| 16 | `RAZORPAY_KEY_SECRET` | same download |
| 17 | `RAZORPAY_WEBHOOK_SECRET` | secret you set when registering the webhook (§3) |
| 18–25 | `RAZORPAY_PLAN_{PLUS,PRO}_{MONTHLY,ANNUAL}_{FOUNDING,GA}_INR` (8) | Plan IDs (`plan_…`) created in §3 |
| 26 | `CRON_SECRET` | fresh random value (§4) — also guards `/api/cron/retention-prune` |
| 27 | `BILLING_TRANSFER_TOKEN_SECRET` | fresh random value (§4), min 16 chars |

Where values go: the **Vercel staging project env** (all 27 + `NEXT_PUBLIC_APP_URL`) and
`.env.local` for local QA runs. Never `NEXT_PUBLIC_*`, never committed files
(`.env*` are gitignored; `.env.example` stays placeholder-only).

## 2. Stripe (test mode)

1. Dashboard → toggle **Test mode** on.
2. Create three products — **Plus**, **Pro**, **Team** — then 12 recurring prices.
   Amounts are the single source of truth in `lib/billing/price-catalog.ts` (PRD §5.1;
   annual = pay-for-10):

   | Price (env binding) | Amount | Recurring |
   |---|---|---|
   | `STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD` | $4 (400¢) | monthly |
   | `STRIPE_PRICE_PLUS_ANNUAL_FOUNDING_USD` | $40 (4000¢) | annually |
   | `STRIPE_PRICE_PLUS_MONTHLY_GA_USD` | $6 (600¢) | monthly |
   | `STRIPE_PRICE_PLUS_ANNUAL_GA_USD` | $60 (6000¢) | annually |
   | `STRIPE_PRICE_PRO_MONTHLY_FOUNDING_USD` | $8 (800¢) | monthly |
   | `STRIPE_PRICE_PRO_ANNUAL_FOUNDING_USD` | $80 (8000¢) | annually |
   | `STRIPE_PRICE_PRO_MONTHLY_GA_USD` | $12 (1200¢) | monthly |
   | `STRIPE_PRICE_PRO_ANNUAL_GA_USD` | $120 (12000¢) | annually |
   | `STRIPE_PRICE_TEAM_MONTHLY_FOUNDING_USD` | $8/seat (800¢) | monthly |
   | `STRIPE_PRICE_TEAM_ANNUAL_FOUNDING_USD` | $80/seat (8000¢) | annually |
   | `STRIPE_PRICE_TEAM_MONTHLY_GA_USD` | $10/seat (1000¢) | monthly |
   | `STRIPE_PRICE_TEAM_ANNUAL_GA_USD` | $100/seat (10000¢) | annually |

   Team is **per seat** (H0 sells 2–25 seats); one price per cycle×cohort, seats
   handled by the app. Copy each `price_…` ID into the matching env binding.
3. Developers → Webhooks → **Add endpoint**: `https://<staging-origin>/api/billing/webhooks/stripe`,
   events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
   (the processor's mapped set, `services/billing/webhook-processor.ts`). Copy the
   endpoint **signing secret** → `STRIPE_WEBHOOK_SECRET`.
4. Settings → **Billing → Customer portal** → configure (test mode): enable
   **subscription updates** (plan changes + card update) — PDEC-12, QA §2 portal checks.
5. Copy the test-mode secret key → `STRIPE_SECRET_KEY`.

Local-dev note: for the local QA pass you additionally run
`stripe listen --forward-to localhost:3000/api/billing/webhooks/stripe`, which prints a
per-run `whsec_…` — use that as `STRIPE_WEBHOOK_SECRET` in `.env.local` for the local run
(banner discarded, per QA evidence rules). The dashboard endpoint registration above is
what T14 verifies in the dashboard.

## 3. Razorpay (test mode)

1. Dashboard → **Test mode**; copy key id/secret → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
2. Subscriptions → **Plans** → create 8 plans (all INR; Team has no INR rail — spec §16 D11):

   | Plan (env binding) | Amount | Period |
   |---|---|---|
   | `RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR` | ₹249 (24900 paise) | monthly |
   | `RAZORPAY_PLAN_PLUS_ANNUAL_FOUNDING_INR` | ₹2,499 (249900 paise) | yearly |
   | `RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR` | ₹499 (49900 paise) | monthly |
   | `RAZORPAY_PLAN_PLUS_ANNUAL_GA_INR` | ₹4,990 (499000 paise) | yearly |
   | `RAZORPAY_PLAN_PRO_MONTHLY_FOUNDING_INR` | ₹499 (49900 paise) | monthly |
   | `RAZORPAY_PLAN_PRO_ANNUAL_FOUNDING_INR` | ₹4,999 (499900 paise) | yearly |
   | `RAZORPAY_PLAN_PRO_MONTHLY_GA_INR` | ₹999 (99900 paise) | monthly |
   | `RAZORPAY_PLAN_PRO_ANNUAL_GA_INR` | ₹9,990 (999000 paise) | yearly |

3. Settings → Webhooks → **Add webhook**: `https://<staging-origin>/api/billing/webhooks/razorpay`,
   event: the `subscription.*` set the processor maps — `subscription.authenticated`,
   `subscription.activated`, `subscription.charged`, `subscription.completed`,
   `subscription.cancelled`, `subscription.pending`, `subscription.halted`. Set a fresh
   **secret** → `RAZORPAY_WEBHOOK_SECRET` (HMAC is verified over the exact raw bytes).

## 4. App secrets (fresh, generated by you, never reused)

```bash
openssl rand -base64 32   # → CRON_SECRET
openssl rand -base64 32   # → BILLING_TRANSFER_TOKEN_SECRET (min 16 chars)
```

Two distinct values, generated fresh — do not copy from another project/env.

## 5. Presence check (key names only — safe to paste anywhere)

```bash
npm run check:billing-env                 # local: process.env + .env.local + .env
# deployment env:
vercel env pull .env.staging-check --environment=preview --yes   # staging project
node scripts/check-billing-env.mjs --file .env.staging-check
rm .env.staging-check                     # pulled file holds values — never commit it
```

Prints presence per key (names only, never values) and exits non-zero while anything is
missing. Expected end state: `27/27` present + `NEXT_PUBLIC_APP_URL` set to the staging
origin.

## 6. Done = (SIL-143 acceptance)

- [ ] Presence check returns **27/27** in the deployment env; staging URL recorded on the issue.
- [ ] Both dashboards show a registered webhook endpoint pointing at the staging origin
      (masked screenshot = QA §6 evidence).
- [ ] Then T14 ([SIL-139]) resumes: QA §1 (fake-rail rendering) can run anytime; §2–§7
      need these credentials.
