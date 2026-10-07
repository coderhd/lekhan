# PRD — H0 Real Billing (Stripe + Razorpay)

- **Feature slug**: `h0-real-billing`
- **Status**: DRAFT — Stage 1 (DEFINE), pending Tech Lead review gate
- **Epic**: [coderhd/lekhan#29](https://github.com/coderhd/lekhan/issues/29) · Paperclip: SIL-32
- **Author**: Product Owner (`po-pm`) · **Reviewer**: Tech Lead (`tech-lead`)
- **Date**: 2026-10-07
- **Upstream sources**: strategy design §H0 + §7
  (`docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md`) ·
  founding pricing (`docs/marketing/founding-cohort-launch.md`) ·
  roadmap row #29 + scheduling policy (`docs/roadmap.md`) · PRODUCT.md success criteria
  (`PRODUCT.md`) · legacy enforcement specs (`docs/superpowers/specs/2026-07-27-usage-credits-plan-enforcement-design.md`,
  `docs/superpowers/specs/2026-07-23-mentions-settings-pricing-design.md`).

---

## 1. Problem & opportunity

Billing today is simulated: `profiles.plan`, an AI-credits ledger, and a 5-document cap gate the
product without collecting a payment. Global launch requires real revenue rails — and the product's
economics make them unusually clean:

- **Local-first** ⇒ serving cost ≈ zero ⇒ a generous free tier is affordable *and* a growth engine.
- **AI on user-owned keys (BYOK/BYOL)** ⇒ nothing to meter ⇒ the credits ledger is **retired**, not
  migrated. Subscription revenue is decoupled from AI entirely.
- **One subscription per workspace (the vault)** keeps entitlements legible and matches the product
  model: a workspace is the collaboration unit.

The opportunity: convert the 500-spot founding cohort into paying workspaces at locked-for-life
prices, with a referral loop that compounds early growth — without ever punishing free users
("Free is a permanent positioning pillar", `docs/roadmap.md`).

## 2. Goals / Non-goals

| Goals | Non-goals |
|---|---|
| Real payments: **Stripe** (global, USD) + **Razorpay** (India, INR), self-serve | Enterprise pricing/infra — deferred (unpriced placeholder, revisit on demand signal) |
| **Workspace = billing root**; entitlements keyed by `workspaces.id`; owner holds the subscription | Sales invoicing, quotes, purchase orders |
| Founding prices **locked for life**; standard prices at GA | Coupon/discount engine beyond founding pricing |
| **Referral credits**: 1 month per activated invitee, 2 months when they convert paid | Free trials (deliberate — founding cohort IS the trial) |
| **Free tier survives billing**: doc cap retired, no credits metering, AI still on own keys | Taxes engine (Stripe Tax / GST filing — deferred decision, see open questions) |
| Retire `profiles.plan` as enforcement source (one-time migration → read-only mirror) | Multi-currency beyond USD/INR; mobile in-app billing; SSO |
| Reuse existing plan-collaborator-limit plumbing (`lib/tier-limits.ts` consumers unchanged) | Rebuilding pricing UI from scratch (`pricing-plans.tsx` evolves in place) |

## 3. Personas

| # | Persona | Money lane | Motivation & expected behavior |
|---|---|---|---|
| P1 | **Maya** — global solo writer (US/EU) | USD via Stripe | Imports her Obsidian vault, loves the local-first graph, upgrades to Plus the day she wants a second device in sync. Expects checkout in dollars, cancels anytime, keeps her files either way. |
| P2 | **Aarav** — India power user | INR via Razorpay | Price-sensitive (PPP), pays in rupees from the ₹ pricing. Expects UPI/cards, an INR price that isn't a naive USD conversion, and never sees a dollar sign. |
| P3 | **Priya** — small studio/team lead | INR or USD via Team | Wants her 4-person team inside one knowledge graph. Expects per-seat clarity ("how much when I add the 5th seat?"), admin visibility, and no seat spring-loaded surprises. |
| P4 | **Founding referrer** — early adopter | any founding tier | Already in the 500. Shares `?ref` links because credits are real: 1 month per friend who activates, 2 if they go paid. Expects credits to simply appear at renewal. |
| P5 | **Free-forever user** — privacy-first local user | none, ever | Local pages, BYOL models. Must feel zero billing pressure: no paywall core, no credit meter, doc cap gone, AI still on their machine. |

## 4. Business value metric

- **Primary metric: paying workspaces** (count of `active` subscriptions across Stripe + Razorpay),
  trending to the success bar already set in `PRODUCT.md`: **~500 paying workspaces → $50k ARR**.
- Leading indicators: free→paid activation rate; referral share of new signups (`?ref` attribution
  already instrumented via #85); annual-plan share.
- Guard-rails (things we pay for if we get them wrong): involuntary churn % (failed renewals),
  refund/support requests per paying workspace.
- Instrumented as events through the existing #83 analytics stack:
  `billing_checkout_started`, `billing_checkout_abandoned`, `billing_subscription_activated`,
  `billing_subscription_renewed`, `billing_subscription_canceled`, `billing_payment_failed`,
  `billing_referral_credit_granted`, `billing_referral_credit_applied`.

## 5. Pricing & packaging

### 5.1 Founding prices (locked for life) vs GA standard

Per workspace, from `docs/marketing/founding-cohort-launch.md`:

| Tier | Founding monthly | Founding annual (2 months free) | Standard from GA |
|---|---|---|---|
| Free | $0 / ₹0 | — | $0 |
| Plus | $4 / ₹249 | $40 / ₹2,499 | $6 / ₹499 |
| Pro | $8 / ₹499 | $80 / ₹4,999 | $12 / ₹999 |
| Team | $8/seat (2–10) | 10× monthly across seats | $10/seat |
| Team 11–25 seats | $7/seat | 2-month convention | $9/seat |
| Team 26+ seats | $6/seat | 2-month convention | $8/seat |

- Founding = the cohort's price identity, grandfathered via the cohort flag on each subscription.
- Annual = pay-for-10 convention on every paid tier, monthly and annual on **both rails**.
- Landing-page contrast table stays as shipped copy ("Every plan runs AI on your own keys — even Free").

### 5.2 Referral credits

- Earned when a referred user **activates** (account + first workspace): **1 month** is banked on the
  referrer's workspace.
- When that invited user **converts to a paid plan**: a further **1 month** (total **2**). Credits
  stack on top of annual savings.
- Applied at the next renewal (banked months extend the paid period). Not cash, not transferable.
- Abuse guard-rails: one grant per distinct activated invitee, same-email blocked, annual bank cap
  (recommendation: 12 months/workspace) — mechanics owned by the spec (§9 there).

## 6. Numbered user stories with acceptance criteria

Format: **As a** <persona>, **I want** …, **so that** …. ACs are Given/When/Then. Priority P0 =
launch-blocking for #29, P1 = same epic, may lag launch by ≤1 week.

### US-1 — Checkout with Stripe (P1 Maya) — P0
**As** Maya, **I want** to buy Plus/Pro in USD without leaving my workspace billing page, **so that**
my sync and history unlock immediately.
- AC1: Given a USD-eligible owner, when they pick Plus/Pro monthly/annual → a hosted Stripe Checkout
  opens carrying the workspace context; on success the browser lands back with the live plan.
- AC2: Given the paid flow completes, when the `checkout.session.completed` webhook is processed →
  the workspace's entitlement row shows `active`, correct tier/cycle.
- AC3: No client-declared price/amount is ever trusted; amounts come from server-side price objects.

### US-2 — Checkout with Razorpay (P2 Aarav) — P0
**As** Aarav, **I want** to pay in ₹ via UPI/card, **so that** buying feels native in India.
- AC1: Given an INR-eligible owner, when they pick any paid tier → Razorpay hosted checkout opens in
  INR (never Stripe-imported currency); nearest-fallback is a clear "pay internationally in USD"
  escape hatch, never a silent redirect.
- AC2: Given payment succeeds → webhook applies the entitlement with the purchased cycle (monthly/annual)
  at the INR price, with the same contract as the Stripe rail.

### US-3 — Workspace-level unlocking (P1/P2/P3) — P0
**As** any paying owner, **I want** my whole workspace upgraded at once, **so that** every member's
pages/seats/history unlock together.
- AC1: Given entitlement activation (or expiry/failure), when enforcement evaluates → workspace row
  state governs collaborator caps, history retention, sync relay access — via the **existing**
  `lib/tier-limits.ts` plumbing.
- AC2: Given a member opens a page in an upgraded workspace → no plan gate, no credit meter, ever.

### US-4 — The free tier survives billing (P5) — P0
**As** a free user, **I want** local pages, PKM core, markdown, and my own-key AI untouched, **so that**
billing never threatens my notes or workflow.
- AC1: Given any billing activity (or none), free workspaces have **no doc cap** (5-doc limit retired),
  **no credits**, no AI metering prompt.
- AC2: Given a downgrade to Free → pages are never deleted; sync relay goes read-only at expiry;
  history beyond free retention stops accumulating (existing prune).
- AC3: Free CTAs never trigger a payment wall; "Get started" CTA language per existing house copy.

### US-5 — Upgrade / downgrade in billing settings (P1 Maya) — P0
**As** Maya, **I want** to change tiers and cycle, **so that** I pay for exactly what I need.
- AC1: Upgrade applies immediately (prorated); downgrade takes effect at period end; UI states both
  plainly. Downgrades beyond the current tier are mutations of the same subscription, not duplicate
  subscriptions.
- AC2: Annual↔monthly switches apply by the provider's standard mechanics (Stripe proration /
  Razorpay cycle end), announced in the UI copy.

### US-6 — Cancel without hostage-taking (P5→P1) — P0
**As** Maya, **I want** to cancel in one place and leave willingly, **so that** leaving feels safe
(the anti-lock-in promise).
- AC1: Given cancellation via Stripe Customer Portal / Razorpay cancel action → entitlements continue
  to period end, then Free; data is never deleted by us.
- AC2: Given "forgot to cancel" resubscribe → reactivation flow restores entitlements without a new
  customer record.

### US-7 — Payment failure & recovery (P3 Priya) — P1
**As** Priya, **I want** a failed renewal to be a big, honest banner — not silent feature removal,
**so that** a Mumbai card hiccup never reads as "they deleted my team."
- AC1: Given a `payment_failed` event → grace window (7 days recommended) with full features + banner;
  then sync relay read-only, local data intact.
- AC2: Given a later successful payment → everything restores automatically; seats/caps recompute.

### US-8 — Workspace ownership transfer (P3 Priya) — P1
**As** Priya leaving the studio, **I want** the workspace's subscription obligation to move with it,
**so that** the team keeps paying through the right owner.
- AC1: Given an ownership transfer, when committed atomically → the workspace keeps its plan for the
  paid period; the *new* owner must add a payment method to continue beyond it. Old owner's auto-billing
  stops; nothing double-charges.
- AC2: Handle the legacy branch first named in AC1; strategy allows this "workspace owner holds the
  subscription and can transfer" contract.

### US-9 — Founding price lock honored (P4) — P0
**As** a founding-cohort subscriber, **I want** my price never to rise as long as I stay subscribed,
**so that** my early trust compounds.
- AC1: Given a founding-cohort subscription → the exact founding price persists across renewals across
  tier changes/cohort reconciliation to GA; stored cohort flag decides which price object applies.
- AC2: Post-GA joiners always see standard prices; no page shows a fake "founding spots left" beyond
  the real 500-cap waitlist cohort.

### US-10 — Referral credit granted (P4) — P1
**As** a founding referrer, **I want** real months banked when my invite activates, **so that** my
advocacy pays for my subscription.
- AC1: Given an activated invitee (account + first workspace) reached via the referrer-eligible link
  and waitlist ref → 1 banked month on the referrer's workspace ledger; distinct once.
- AC2: Given that invitee later converts paid → an additional month banks (total 2), tracked
  and capped; statuses surfaced to the referrer in billing settings.

### US-11 — Referral credits applied at renewal (P4) — P1
**As** a paying referrer, **I want** banked months to extend my period, **so that** credits are real
value, not vibes.
- AC1: Given a banked balance > 0 and renewal due → cycle extends by 1 month per credit (at current
  tier), invoiced at ₹/$0 for the extended period; decrement ledger, apply once, idempotently.
- AC2: Given a plan/skip/cancel in the meanwhile → credits remain banked on the workspace, unaffected
  by tier changes beyond value-equivalence note (1 month of the current tier).

### US-12 — Webhook truthfulness (P3, ops protagonist) — P0
**As** the workspace owner (and the operator), **I want** entitlements to be exactly what the gateway
says, **so that** billing states never lie.
- AC1: Given any webhook (duplicate, out-of-order, or replayed) → processing is idempotent: state is
  correct regardless of arrival order/count (Stripe signature + Razorpay HMAC verified first, every
  event raw-recorded before effect).
- AC2: Given a missed webhook → reconciliation poll (per provider API check) restores the truth on a
  schedule; no state depends on client claims.

## 7. Regulatory & regional considerations

- **PCI**: both rails use hosted checkout — card data never touches Lekhan servers (PCI SAQ-A scope).
- **India-specific**: Razorpay for INR; GST display decision deferred (open question); Razorpay
  receipts from dashboard; invoices not built in-app at H0.
- **Data protection**: webhook logs must never contain card data; emails are PII — minimized in logs.

## 8. Launch dependency & sequencing

- From the roadmap scheduling policy: the public beta is **quality-gated, not date-gated**, and
  "**Free is a permanent positioning pillar: the free tier survives billing (#29)**".
- Nothing ships in H0 unless global-ready (i18n + billing + provider registry are launch requirements);
  #29 sits between #28 (provider registry) and the #28/#29/#31/#32 launch gate (≈Sept 30 target
  recorded in the launch doc; recalibration checkpoints noted after #81 and after #29 in `docs/roadmap.md`).

## 9. Open questions

Owned in the spec (`docs/superpowers/specs/29-spec.md`, §Open Questions) — headline: free-tier
history retention (code 1d vs strategy 7d), INR/USD region assignment rule, tax handling deferral,
Team-seat proration depth, grace-window length, founding-flag semantics on tier changes, Team
workspace object timing vs billing landing.
