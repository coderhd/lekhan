# Spec #29: H0 — Real Billing (Stripe + Razorpay)

- **Status**: DRAFT — Stage 1 (DEFINE), pending Tech Lead review gate
- **Epic**: [coderhd/lekhan#29](https://github.com/coderhd/lekhan/issues/29) · Paperclip: SIL-32
- **Author**: Product Owner (`po-pm`) · **Reviewer**: Tech Lead (`tech-lead`)
- **Date**: 2026-10-07
- **Companion PRD**: `docs/prd/h0-real-billing-prd.md` (personas, numbered stories US-1…US-12,
  business value metric, pricing tables)
- **Upstream**: strategy design §H0 + §6.3 + §7
  (`docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md`) ·
  founding pricing (`docs/marketing/founding-cohort-launch.md`) · legacy enforcement
  (`docs/superpowers/specs/2026-07-27-usage-credits-plan-enforcement-design.md`,
  `docs/superpowers/specs/2026-07-23-mentions-settings-pricing-design.md`)

---

## 1. Executive summary & architectural invariants

Launch-ready self-serve billing: **Stripe** (global, USD) + **Razorpay** (India, INR), hosted
checkout on both rails, idempotent webhooks, entitlements keyed by **`workspaces.id`** (the
workspace is the billing root), founding cohort prices locked for life, referral credits banked on
the workspace, and the legacy `profiles.plan` / credits ledger / 5-doc cap enforcement **retired**.

Invariants (each is acceptance-checked below):

1. **Workspace = billing root.** One subscription per workspace; plan change touches one object,
   never N user rows. The owner holds the subscription and can transfer ownership.
2. **Free tier survives billing.** Doc cap retired; zero credits metering on any tier; free keeps
   unlimited local pages, PKM core, markdown, AI via free-key on-ramp + BYOK + BYOL.
3. **No AI credits ledger anywhere.** `used_credits` enforcement is deleted, not migrated (§6.3).
4. **Client never decides price.** Amounts/tiers resolve only from server-side price objects
   (env-bound IDs); checkout payloads are opaque session references.
5. **Card data never lands in Lekhan.** Hosted checkout/portal only ⇒ PCI SAQ-A scope.
6. **Webhooks are the single source of truth** for entitlement state: signature-verified,
   raw-recorded, idempotent, reconciliation-polled.
7. **Existing enforcement plumbing is reused**, not rebuilt: `lib/tier-limits.ts` consumers keep
   their interface; only where the limit is *read from* changes (`profiles.plan` → workspace).

## 2. Assumptions surfaced for review (correct me now or we proceed)

1. No Stripe/Razorpay integration code exists yet — this is greenfield (verified by grep; only
   Supabase realtime `subscription`s and an unrelated API header string exist).
2. Paid tiers at launch are **Free, Plus, Pro, Team** (strategy §7.2). The "Go" tier from the July
   INR pricing spec is retired, along with its ₹99 price and every credits number.
3. Pricing UI components (`pricing-plans.tsx`, `settings-client.tsx` billing tab) currently render
   the simulated matrix; billing UI evolves in place rather than being rebuilt.
4. `workspaces` has `UNIQUE (owner_id)` — one personal workspace per owner in H0 (schema comment:
   "team workspaces evolve in H2"), while Team-tier *billing* is in H0 scope. Team seat enforcement
   initially rides the existing collaborator-cap plumbing (see Open Question Q7).
5. Enterprise stays out of scope entirely (unpriced placeholder in the launch doc).
6. Stripe does not handle domestic-INR acceptance for us; INR is strictly Razorpay (assumption to
   confirm at build time; see Open Question Q8).
7. Referral attribution exists at the waitlist layer (`p_referred_by`, `?ref=` preserved) but the
   link **waitlist entry → real user account** does not exist yet and is part of this epic.
8. We are on Supabase + Next.js route handlers + Vercel; webhooks are Next.js API routes with the
   Supabase service role client, like every other server integration in this repo.

## 3. Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `pricing-config` | Tier/cycle/cohort price catalog; env-bound price IDs; server-only price resolution | — |
| `gateway-abstraction` | `PaymentGateway` interface; currency → rail routing | `pricing-config` |
| `stripe-rail` | Checkout, customer portal, subscription lifecycle | `gateway-abstraction` |
| `razorpay-rail` | Subscriptions (hosted checkout), cancel flow | `gateway-abstraction` |
| `webhook-processor` | Signature verify → raw record → idempotent apply, both rails | `stripe-rail`, `razorpay-rail` |
| `entitlement-cutover` | Workspace-plan storage + backfill + `profiles.plan` dual-read retirement + doc-cap/credits removal | `webhook-processor` |
| `billing-ui` | Settings billing tab real states; checkout/portal entries; free-CTA copy | `entitlement-cutover` |
| `referral-credits` | Ledger + grant (activation/paid conversion) + apply-at-renewal | `webhook-processor`, `entitlement-cutover` |
| `reconciliation` | Cron poll fallback for missed webhooks, idempotent | `webhook-processor` |

**Build order:** `pricing-config` → `gateway-abstraction` → {`stripe-rail`, `razorpay-rail`} →
`webhook-processor` → `entitlement-cutover` → {`billing-ui`, `referral-credits`} → `reconciliation`.

## 4. Data model

New migration `supabase/migrations/20261007xxxxxx_billing_workspace_plans.sql` (naming follows the
existing `2026MMDDHHMMSS_*` convention):

### 4.1 `plan_tiers` (catalog, static config)
`id`, `tier` (`free|plus|pro|team`), display metadata, monthly/annual `usd_cents`/`inr_paise`
(founding + GA columns, cohort-flagged), `min_seats`/`max_seats` (Team), limits snapshot mirror of
`lib/tier-limits.ts` for audit/reference.

### 4.2 `workspace_plans` (mutable state — entitled object keyed by `workspaces.id`)
- `workspace_id UUID PK REFERENCES workspaces(id)` (one row per vault; **the billing root key**)
- `tier` (`free|plus|pro|team`), `billing_cycle` (`monthly|annual|none`)
- `gateway` (`stripe|razorpay|none`), `gateway_customer_id`, `gateway_subscription_id`
- `currency` (`USD|INR`), `is_founding boolean` (cohort price lock), `seats int` (Team)
- `status` (`active|past_due|canceled|incomplete|none`), `current_period_end`
- `credited_months int` (referral balance), timestamps
- RLS: owner reads own row; **writes are service-role only** (webhooks/cron). No client writes.

### 4.3 Supporting tables
- `gateway_events`: `id`, `gateway`, `event_id UNIQUE`, `type`, `payload jsonb`, `processed_at`;
  raw record **before** processing (idempotency + audit; never store card data).
- `referral_credit_ledger`: `workspace_id`, `source_ref`, `invitee_ref`, `invitee_user_id`,
  `months`, `granted_at`, `applied_at nullable`, `UNIQUE (workspace_id, invitee_ref)` (one grant
  per distinct invitee).
- Waitlist→account mapping at signup (`referral_attribution`): `user_id`, `ref`, `email_hash`,
  `created_at` — links `p_referred_by`/`?ref=` to the activated account.

### 4.4 Retirement & migration
- One-shot idempotent backfill: for every `profiles` row → owner's personal workspace
  `workspace_plans` row (tier = `profiles.plan` normalized to new tiers; `is_founding` per the
  500-cap cohort eligibility).
- `profiles.plan` becomes a **deprecated read-only mirror** (updated by the webhook processor, never
  read for enforcement after the cutover flag flips); full removal at the P2 client cutover.
- `used_credits` reads/writes everywhere (`services/db.ts` credit paths, `api/ai` checks, UI badges)
  are deleted with this epic; UI copy drops credit counters.

## 5. Gateway abstraction & pricing config

```ts
// lib/billing/gateway.ts — server-only; both rails implement this
export type Rail = 'stripe' | 'razorpay'
export interface CheckoutRequest { workspaceId: string; tier: 'plus'|'pro'|'team';
  cycle: 'monthly'|'annual'; currency: 'USD'|'INR'; isFounding: boolean; seats?: number }
export interface CheckoutSession { checkoutUrl: string; opaqueRef: string }
export interface PaymentGateway {
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>
  portalUrl(customerRef: string): Promise<string>          // stripe implementation
  cancelAtPeriodEnd(subscriptionRef: string): Promise<void>
}
export function gatewayForCurrency(c: 'USD' | 'INR'): PaymentGateway // USD→stripe, INR→razorpay
```

- `lib/billing/prices.ts`: the only place mapping tier×cycle×cohort×currency → gateway price/plan
  id, all values from env (see §9). Changing a price never means editing checkout code.
- Currency routing: USD↔Stripe, INR↔Razorpay, decided **server-side** (region rule in Open
  Question Q2); no client-side rail selection.

## 6. Rails & webhook processing

- **Stripe**: Checkout Sessions + Customer Portal (self-serve cancel/card update); events:
  `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed`,
  `invoice.paid` (renewals). Signature verify (`STRIPE_WEBHOOK_SECRET`) → insert `gateway_events` →
  process → entitlement write → mirror update.
- **Razorpay**: Subscriptions Standard (hosted checkout + retry config), cancel-at-cycle-end API,
  hosted payment-page link for card update (no Razorpay portal equivalent); webhook HMAC-SHA256
  verify (`RAZORPAY_WEBHOOK_SECRET`) → same pipeline. Payment-success/client-side callbacks are
  advisory only — state changes only via verified webhook or API-backed reconciliation.
- Processing rules (US-12): `event_id` unique constraint ⇒ duplicate events short-circuit; apply
  transitions are commutative/last-writer-wins by provider-supplied subscription version/period
  fields, so out-of-order delivery still lands on the correct end state; unknown event types are
  stored and no-op (never blind-downgrade entitlements).

## 7. Enforcement changes

- **Doc cap**: 5-document free enforcement deleted (it punished exactly the PKM wedge).
- **Collaborator caps**: unchanged semantics, read from `workspace_plans.tier` via
  `lib/tier-limits.ts` (interface preserved: reuse of existing plan-collaborator-limit plumbing).
- **History retention**: same delivery mechanism (#82 plumbed to plan); source switches to the
  workspace row. Value discrepancy Free 1d (code) vs 7d (strategy) → Open Question Q1.
- **Sync relay**: paid-feature gate at `past_due`/expired per US-7 grace rules.

## 8. Referral credits mechanics

1. Attribution capture: `?ref` on signup links + waitlist `p_referred_by` both write
   `referral_attribution` at account creation (deduped).
2. Grant trigger: referred account **activates** (workspace created) → ledger row `months=1`.
3. Upgrade trigger: referred account converts **paid** → second row `months=1` (total 2) and counts
   as the months-bank balance on the *referrer's* `workspace_plans.credited_months`.
4. Apply at `invoice.paid`/renewal processing: if `credited_months > 0`, extend `current_period_end`
   by the banked months at the current tier value, decrement the ledger (applied, not deleted —
   audit trail preserved).
5. Anti-abuse: same-email blocked, distinct-invitee unique constraint, bank cap 12 months/workspace
   (flagged recommended default), credits non-transferable, no cash-out, capped event/analytics.

## 9. Secrets & credentials (where needed, and by whom)

| Credential | Scope | Read where | Provisioned by |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | server-only | `app/api/billing/*`, `lib/billing`, `services/billing` | board/user (prod: Vercel env · dev: `.env.local`) |
| `STRIPE_WEBHOOK_SECRET` | server-only | Stripe webhook route (signature verify) | board/user via Stripe dashboard (per-endpoint endpoint secret) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | server-only | Razorpay API client (`lib/billing/razorpay.ts`) | board/user via Razorpay dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | server-only | Razorpay webhook route (HMAC verify) | board/user via Razorpay dashboard |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | client-bundled | **Not needed** for hosted-Checkout flow; add only if Stripe.js is ever embedded | board/user |
| `NEXT_PUBLIC_APP_URL` (exists) | redirect/return URLs for checkout & portal return | billing routes | already provisioned |
| `CRON_SECRET` (exists) | reconciliation cron route guard | `/api/billing/reconcile` route | already provisioned |

Rules: never in `NEXT_PUBLIC_*` (except the publishable key if ever needed), never committed,
never in issues/comments/docs; agents receiving credentials propose them via the Paperclip
secret-proposals flow. Dashboard-side setup (board/user, once): Stripe price objects per
tier×cycle×cohort×currency + webhook endpoints configured, Razorpay subscription plans + webhook
endpoint; gate BUILD-complete on webhook endpoints verified in both dashboards. `.env.example`
gets placeholder entries for all six new names.

## 10. Commands

- Full verification: `npm run typecheck && npm run lint && npm test && npm run build`
- Local Stripe webhook dev: `stripe listen --forward-to localhost:3000/api/billing/webhooks/stripe`,
  then `stripe trigger checkout.session.completed` (Stripe test clock/workbench for renewals)
- Razorpay webhook dev: fixture-replay via committed signed payloads (`tests/fixtures/billing/`);
  no Razorpay local CLI — the adapter seam covers unit scope
- UI walkthrough without money: `LEKHAN_FAKE_PAYMENTS=1 npm run dev` (fake gateway adapter)
- Component test selection: `npm test -- tests/unit/billing-*`

## 11. Testing strategy

- Vitest unit (adapter-seamed: injected gateway clients, no network): signature verification
  (Stripe + Razorpay HMAC, tampered/missing headers rejected), idempotency (duplicate + out-of-order
  deliveries), currency/rail routing matrix, tier transitions (upgrade/downgrade/cancel/grace),
  referral grant/dedup/cap/apply, `profiles.plan` backfill idempotency + dual-read parity.
- Committed fixtures: real-shaped recorded webhook payloads (Stripe + Razorpay; no secrets) signed
  in-test with test keys only.
- Fake gateway adapter (`LEKHAN_FAKE_PAYMENTS=1`) for UI/e2e flows without money.
- Manual QA script: Stripe test cards (success/decline/3DS), Razorpay test UPI/card, portal round-trip.
- No real payments in CI; prod keys never on dev machines.

## 12. Code placement & style

- Follows existing patterns: thin route handlers (`app/api/billing/**`), logic in
  `lib/billing/**` + `services/billing.ts`, Supabase service-role client, server-only env reads.
- Style: named exports, tabs, double quotes (matches `lib/tier-limits.ts`); gateway SDK imports
  server-side only; no third-party client billing SDKs.
- Tests colocate under `tests/unit/billing-*.test.ts` (house Vitest convention).

## 13. Boundaries

- **Always**: verify signature before effect; raw-record events before processing; run the full
  verify suite before any claim of done; keep writes service-role; keep amounts server-derived.
- **Ask first**: any schema change to `workspaces`/`profiles`; new npm dependencies (stripe /
  razorpay SDKs); changing `lib/tier-limits.ts` limit values; enabling external money flows.
- **Never**: process unverified webhooks; trust client price/amount/tier claims; store card data;
  put secrets in `NEXT_PUBLIC_*`/commits/issues; delete or redefine `profiles.plan` (mirror is
  read-only until P2); delete user content on downgrade, ever.

## 14. Success criteria

- [ ] US-1…US-12 acceptance criteria pass (PRD §6), with US-4 (free tier survives), US-9 (founding
      lock), US-12 (webhook idempotency) unchanged by TL review.
- [ ] Signature verification enforced on both webhook routes (tamper tests fail closed).
- [ ] Idempotency: replayed/out-of-order event suite green; state converges to provider truth.
- [ ] Doc cap + credits enforcement removed; free tier behavior identical to pre-billing UX except
      cap removal; no credit counters anywhere in UI.
- [ ] `profiles.plan` backfilled into `workspace_plans` once, idempotently; dual-read parity check
      green; enforcement reads only workspace state.
- [ ] Founding price lock + annual 2-months-free honored on both rails; referral credits granted,
      capped, and applied at renewal end-to-end.
- [ ] Zero card data stored; webhook event log PII-minimized.
- [ ] Webhook endpoints verified in Stripe + Razorpay dashboards before release; reconciliation cron
      passes a missed-webhook drill.

## 15. Risks & mitigations (irreversible / payment paths emphasized)

| Risk | Mitigation |
|---|---|
| Duplicate/replayed webhook double-applies entitlements | `gateway_events` unique `event_id` + idempotent state transitions |
| Out-of-order provider events transiently wrong state | last-writer-wins on provider version/period fields; reconciliation cron converges |
| Missed webhook → expired entitlement still "active" (or vice versa) | signaturized raw record + scheduled poll fallback (`CRON_SECRET`-guarded) |
| Unverified webhook forging entitlement | signature/HMAC verified before any read of payload; unknown sources rejected |
| User lands on wrong rail/currency (INR via Stripe etc.) | server-side region rule only; no client rail selection; clear escape hatch (US-2 AC1) |
| Cancellation delete-panic | nothing is ever deleted on downgrade; local-first data untouched; sync relay read-only at expiry only |
| Payment failure silently removes features | grace window + honest banner (US-7); auto-restore on recovery |
| Founding price erosion / cohort leakage | per-cohort price objects; `is_founding` persisted once at subscription creation; GA checkout never resolves founding IDs |
| Referral abuse (self-referral, farming) | distinct-invitee unique grant, same-email block, bank cap, non-cashable, activation trigger |
| `profiles.plan` cutover regression breaks enforcement | mirror retained read-only; backfill idempotent; dual-read parity in tests; rollback = read path remains |
| Ownership transfer double-bills both parties | atomic transfer; gateway customer reattach strategy explicitly resolved at PLAN (US-8) |
| Stripe-India domestic acceptance is unavailable/changed | INR strictly Razorpay; assumptions checked at build (Q8) |

## 16. Open questions (Tech Lead owns resolution in review)

1. **Free-tier history retention**: `lib/tier-limits.ts` says 1 day; strategy §7.2 says 7 days.
   Which is canonical? (Recommendation: 7 days — free-tier generosity is the roadmap position.)
2. **Seat/collaborator values**: strategy says Pro = 25 collaborators; code has Pro = 100. Reconcile
   before `billing-ui` lands. (Recommendation: strategy values are the product truth.)
3. **Region assignment rule** for INR vs USD lane: owner-profile country, IP geo, or explicit
   currency picker? (Recommendation: explicit picker with country/IP default; India → INR only.)
4. **Taxes**: Stripe Tax + Razorpay GST display — defer entirely, or land display-only?
   (Recommendation: defer engine; display prices tax-inclusive in INR, tax-exclusive in USD until
   GA tax decision.)
5. **Downgrade timing**: immediate-with-proration vs period-end (recommendation: period-end).
6. **Team seat proration depth** for mid-cycle seat add/remove (recommendation: prorate adds;
   removals apply at renewal).
7. **Team workspace object timing**: Team billing in H0 rides the UNIQUE(owner) single workspace +
   collaborator plumbing; true multi-workspace team objects land in H2. Confirm this split.
8. **Stripe India domestic acceptance** status at build time (assumption 6).
9. **Dunning cadence**: Stripe smart retries + Razorpay retry config + 7-day grace — acceptable?
10. **Referral activation definition**: "account + first workspace" as the grant trigger, and the
    12-month bank cap — confirm or adjust.

## 17. References

- Strategy: §H0 (line ~66-75), §6.3 (credits retired), §7 (global readiness & pricing)
- Launch: `docs/marketing/founding-cohort-launch.md` (founding table, savings table, Team volume
  tiers, referral stacking, enterprise deferral)
- Legacy: credits/enforcement spec + July INR pricing spec (superseded by §7 of strategy)
- Code: `lib/tier-limits.ts`, `services/db.ts` (credit paths to delete),
  `components/pricing-plans.tsx`, `components/settings-client.tsx`, waitlist
  (`services/waitlist.ts`, `app/api/waitlist/*`, `p_referred_by`, `?ref`)
- Product: `PRODUCT.md` (success bar, positioning constraints), `docs/roadmap.md` (row 29 + policy)
