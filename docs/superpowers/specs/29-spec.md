# Spec #29: H0 — Real Billing (Stripe + Razorpay)

- **Status**: REVISED per Tech Lead round-1 review (B1–B3 blocking + A–H adopted; §16 closed) —
  pending TL re-review of the changed sections
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
  (**gateway-mirrored** — authoritative truth is the gateway; any extension of it may only ever be
  derived from a provider-side applied credit, never a local write — see §8)
  `credit_overlay_months int` (banked-but-unapplied, ledger-backed)
- `credited_months int` (referral balance), timestamps
- RLS: owner reads own row; **writes are service-role only** (webhooks/cron). No client writes.

### 4.3 Supporting tables
- `gateway_events`: `id`, `gateway`, `event_id UNIQUE`, `type`, `payload jsonb`, `processed_at`;
  raw record **before** processing (idempotency + audit; never store card data).
- `referral_credit_ledger`: `workspace_id`, `source_ref`, `invitee_ref`, `invitee_user_id`,
  `trigger_stage` (`activation|conversion`), `months`, `granted_at`, `applied_at nullable`,
  `UNIQUE (workspace_id, invitee_ref, trigger_stage)` (one grant per distinct invitee **per stage** —
  an activation grant and a later conversion grant are two rows; dedup is within a stage).
- Waitlist→account mapping at signup (`referral_attribution`): `user_id`, `ref`, `email_hash`,
  `created_at` — links `p_referred_by`/`?ref=` to the activated account.

### 4.4 Retirement & migration
- One-shot idempotent backfill: for every `profiles` row → owner's personal workspace
  `workspace_plans` row; **explicit tier normalization map** (`profiles.plan` is free TEXT,
  `services/db.ts` recognizes `free|go|pro|team|enterprise`): `go → plus` (closest entitlement
  parity; no real money was ever paid) · `enterprise → free` (out of scope) · unknown → `free` +
  log. Legacy `'go'`/`'enterprise'` values must never leak into `lib/tier-limits.ts` routing (the
  fallback silently serves FREE_LIMITS to unknown plans — §7).
- `is_founding` determination: roster = the `join_waitlist` founding cohort with `spot ≤ 500`;
  matched to accounts at signup via the `referral_attribution` mapping. **Schema dependency:** the
  waitlist RPC/table DDL is not in `supabase/migrations/` (created out-of-band) — PLAN must locate
  that DDL before writing the backfill migration.
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
- Currency routing: USD↔Stripe, INR↔Razorpay, decided **server-side** (region rule = closed
  decision Q3 in §16); no client-side rail selection. **Team is USD-only at H0** (closed decision —
  §9 note); INR Team pricing lands with a GA pricing decision.

## 6. Rails & webhook processing

- **Stripe**: Checkout Sessions + Customer Portal (self-serve cancel/card update); events:
  `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed`,
  `invoice.paid` (renewals). Signature verify (`STRIPE_WEBHOOK_SECRET`) → insert `gateway_events` →
  process → entitlement write → mirror update.
- **Razorpay**: Subscriptions Standard (hosted checkout + retry config), cancel-at-cycle-end API,
  hosted payment-page link for card update (no Razorpay portal equivalent); webhook HMAC-SHA256
  verify (`RAZORPAY_WEBHOOK_SECRET`) → same pipeline. Payment-success/client-side callbacks are
  advisory only — state changes only via verified webhook or API-backed reconciliation.
- Processing rules (US-12): `event_id` unique constraint ⇒ duplicate events short-circuit; **after
  signature verification, treat the event as a pointer, not a payload: re-fetch the live
  subscription/customer object from the provider API and write entitlement state from the read-back**
  (kills stale-payload and forged-delta classes; makes invariant 6 literal). The raw event payload
  stays in `gateway_events` for audit only. Unknown event types are stored and no-op (never
  blind-downgrade entitlements); the reconciliation cron converges any residual divergence.

## 7. Enforcement changes

- **Doc cap**: 5-document free enforcement deleted (it punished exactly the PKM wedge).
- **Collaborator caps**: unchanged semantics, read from `workspace_plans.tier` via
  `lib/tier-limits.ts` (interface preserved: reuse of existing plan-collaborator-limit plumbing).
- **History retention**: same delivery mechanism (#82 plumbed to plan); source switches to the
  workspace row. **Free retention is 1 day — canonical per accepted ADR 0002** (which amended the
  strategy §7.2 seven-day figure; `lib/tier-limits.ts` + `tests/unit/tier-limits-recalibration.test.ts`
  pin it). Moving back to 7d requires superseding the ADR (0002, 2026-08-23) with re-run storage
  math — out of scope for #29.
- **`team` must be added to the enforcement plumbing before any Team row exists**
  (`lib/tier-limits.ts` has `PlanTier = 'free'|'plus'|'pro'` and `getPlanLimits()` silently falls
  back to FREE_LIMITS for unknown plans — a paying Team workspace would silently get 2 collaborators
  / 1-day history / 20 MB). Add `PLAN_TIER 'team'` + `TEAM_LIMITS`; define seats→
  `maxDistinctCollaborators` semantics (cap = seats, owner excluded — mirror the existing per-doc
  counting); audit every `getPlanLimits` caller at cutover, incl. the relay gate
  (`server/index.js` `getDocumentOwnerPlan`), share caps (`services/graph.ts`, `services/db.ts`),
  and the retention prune (cron). Raising Pro 100→25: closed decision Q2 (TL-approved in this
  review — the §13 ask-first gate for exactly this edit); update
  `tests/unit/tier-limits-retention.test.ts` in the same slice.
- **Sync relay**: paid-feature gate at `past_due`/expired per US-7 grace rules.

## 8. Referral credits mechanics

> Terminology: "referral credits" here are **banked billing months** on a `workspace_plans` row —
> a different concept from the AI-era "credits" ledger SQL retired by this epic (CONTEXT.md's
> on-ramp "credits" sense). One glossary meaning per concept.

1. Attribution capture: `?ref` on signup links + waitlist `p_referred_by` both write
   `referral_attribution` at account creation (deduped).
2. **Grant seam**: the activation trigger hooks `ensureWorkspace()` (`services/graph.ts:179-195`) —
   workspaces are created lazily on first access, so "referred account activated" = a `workspaces`
   insert resolved through the referral→account mapping (host fn or DB trigger on `workspaces`
   insert; PLAN picks one). → ledger row `trigger_stage='activation'`, `months=1`.
3. Conversion trigger: referred account converts **paid** → second ledger row
   `trigger_stage='conversion'`, `months=1` (total 2); both feed the referrer's
   `workspace_plans.credited_months`.
4. Apply at renewal — **the gateway, not our DB, stays the sole renewer** (invariant 6 / US-12):
   - **Stripe (H0-shipped path):** grants are applied provider-side — customer credit balance
     credit applied at invoice time; the provider itself defers/zeroes the invoice.
   - **Razorpay:** no credit-balance equivalent; the application path is at renewal-order creation
     (zero-amount/add-on/skip mechanism per current Razorpay APIs) — **PLAN must verify the exact
     API against current Razorpay docs before shipping INR redemption**; if no equivalent exists,
     Razorpay credits bank (ledger-accurate) and redemption on INR ships with the GA pricing
     decision — never a local `current_period_end` write.
   - **Precedence rule (both rails):** `current_period_end` is always mirrored from the provider;
     the applied credit value is reflected as `credit_overlay_months → 0` on confirmation and the
     mirrored period simply arrives extended. On any conflict the provider wins; reconciliation
     never disagrees with the ledger.
5. Anti-abuse: same-email blocked, distinct-invitee unique constraint per stage, bank cap 12
   months/workspace as **config, not hardcode**, credits non-transferable, no cash-out, capped
   event/analytics.

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
| **Price/plan-ID bindings** `STRIPE_PRICE_<TIER>_<CYCLE>_<FOUNDING|GA>_<USD>`, `RAZORPAY_PLAN_<TIER>_<CYCLE>_<FOUNDING|GA>_<INR>` | server-only | `lib/billing/prices.ts` resolution only | board/user; names minted in dashboards, IDs in env |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | client-bundled | **conditional** — only if PLAN picks `checkout.js` over fully-hosted payment pages; if used, re-assert the PCI mode for the chosen integration | board/user |

Note the conditional row: PLAN picks the Razorpay checkout mode (fully-hosted preferred — keeps
`NEXT_PUBLIC_RAZORPAY_KEY_ID` out and PCI SAQ-A trivial) **and states it in the plan**.
**Scheduling surface:** there is no `vercel.json`/cron workflow in-repo — PLAN must nominate where
the reconcile cron runs (Vercel Cron entry alongside the existing retention-prune route) and prove
the missed-webhook drill (§14). `CRON_SECRET` also gets a placeholder in `.env.example` (present in
code/tests but missing from the example file).

Rules: never in `NEXT_PUBLIC_*` (except the publishable key if ever needed), never committed,
never in issues/comments/docs; agents receiving credentials propose them via the Paperclip
secret-proposals flow. Dashboard-side setup (board/user, once): Stripe price objects per
tier×cycle×cohort×currency + webhook endpoints configured, Razorpay subscription plans + webhook
endpoint; gate BUILD-complete on webhook endpoints verified in both dashboards. `.env.example`
gets placeholder entries for all new names above (incl. `CRON_SECRET`, missing today despite being
in code/tests).

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

- **Always**: verify signature before effect; treat verified events as pointers — **read back live
  provider state before writing entitlements**; raw-record events before processing; run the full
  verify suite before any claim of done; keep writes service-role; keep amounts server-derived;
  **ownership transfer hard invariant — a workspace has at most one live gateway subscription;
  transfer must detach/reassign the payment obligation before the next renewal, and the old owner's
  auto-billing must be verifiably stopped via provider API, not inferred from webhooks.**
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
| Ownership transfer double-bills both parties | hard invariant (§13 Always): single live gateway subscription per workspace; detach/reassign before next renewal; old owner's auto-billing stopped via provider API (verified, never inferred); reattach strategy resolved at PLAN (US-8) |
| Stripe-India domestic acceptance is unavailable/changed | INR strictly Razorpay; assumptions checked at build (Q8) |

## 16. Decisions (§16 open questions — CLOSED by Tech Lead arbitration, 2026-10-07 round 1)

1. **Free-tier history retention: OVERRIDDEN → 1 day.** Accepted ADR 0002 supersedes strategy
   §7.2; 7d would require superseding the ADR with re-run storage math (out of scope for #29).
2. **Collaborator values: strategy wins — Pro = 25.** Economics: 100 collabs at $12/₹999
   cannibalizes Team ($10/seat); P3 is the Team persona; no public copy carries collaborator counts.
   This review IS the ask-first approval for editing `lib/tier-limits.ts` (Pro 100→25); update
   `tests/unit/tier-limits-retention.test.ts` in the same slice.
3. **Region rule: explicit currency picker, geo default.** Server-side default from
   `x-vercel-ip-country` (zero cost; no new `profiles` country column); India → INR/Razorpay, else
   USD/Stripe; resolved currency recorded on `workspace_plans.currency` at first checkout.
4. **Taxes: engines deferred.** INR displayed tax-inclusive (consumer norm), USD tax-exclusive with
   "taxes may apply" microcopy; revisit at GA-entity decision.
5. **Downgrades: period-end.** (Matches US-5 AC1; avoids proration math; aligns with Stripe portal default.)
6. **Seat changes: prorate adds, removals at renewal.** In H0 "Team seats" ride the collaborator-cap
   seam on the single workspace (Q7) — mid-cycle seat changes reduce to invite events; true per-seat
   proration rides H2 team objects; no proration engine — bookkeeping only.
7. **Team split confirmed: H0 = billing on single-workspace + collaborator plumbing; H2 = team
   workspace objects** (schema comment + roadmap #49←#29 encode it). Mandatory companion: §7's
   `team`-tier enforcement addition (silent-free-downgrade trap).
8. **Stripe India acceptance: deferred to build; stance fixed — INR stays strictly Razorpay** even
   if Stripe domestic acceptance turns out available (UPI-first + rupee settlement is Razorpay's
   strength); rail choice not reopened at build time.
9. **Dunning: Stripe smart retries + Razorpay retry config + 7-day grace** (`past_due` keeps full
   features + banner; sync read-only after).
10. **Referral activation: grant trigger = `ensureWorkspace()` (`services/graph.ts:179-195`) or a
    `workspaces`-insert DB trigger; "account + first workspace" holds. 12-month bank cap confirmed
    as config, not hardcode.**
11. **Team INR pricing: no founding INR per-seat price exists in any source doc (launch doc + PRD
    have USD-only volume tiers; strategy has GA ₹799/seat). Decision: Team is USD-only at H0; INR
    Team pricing defers to a GA pricing decision — silence was not an option (US-2 adjusted).**

## 17. References

- Strategy: §H0 (line ~66-75), §6.3 (credits retired), §7 (global readiness & pricing)
- Launch: `docs/marketing/founding-cohort-launch.md` (founding table, savings table, Team volume
  tiers, referral stacking, enterprise deferral)
- Legacy: credits/enforcement spec + July INR pricing spec (superseded by §7 of strategy)
- Code: `lib/tier-limits.ts`, `services/db.ts` (credit paths to delete),
  `components/pricing-plans.tsx`, `components/settings-client.tsx`, waitlist
  (`services/waitlist.ts`, `app/api/waitlist/*`, `p_referred_by`, `?ref`)
- Product: `PRODUCT.md` (success bar, positioning constraints), `docs/roadmap.md` (row 29 + policy)
