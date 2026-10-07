# H0 Real Billing Implementation Plan (Stripe + Razorpay)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-serve real billing — Stripe (global/USD) + Razorpay (India/INR) — with entitlements keyed by `workspaces.id`, locked founding prices, referral banked-months, and retirement of `profiles.plan` / AI-credits / 5-doc-cap enforcement.

**Architecture:** Workspace is the billing root (one subscription per vault, per strategy §H0). Two gateway rails implement a shared server-only `PaymentGateway` interface; hosted checkout keeps card data out (PCI SAQ-A). Webhooks — signature-verified, raw-recorded to `gateway_events`, then applied by **reading back live provider state** — are the single source of entitlement truth, with a CRON_SECRET-guarded reconciliation poll as fallback.

**Tech stack:** Next.js 16 route handlers + Supabase (service-role client, as every server integration here), `stripe` npm SDK (server-only), Razorpay v1 REST via `fetch` (Basic auth, no SDK), `node:crypto` HMAC verification, Vitest with adapter-seamed (no-network) unit tests.

**Spec:** `docs/superpowers/specs/29-spec.md` (rev 2, TL-APPROVED via [SIL-34](/SIL/issues/SIL-34)) · Companion PRD `docs/prd/h0-real-billing-prd.md` (US-1…US-12) · Upstream: strategy design §H0/§7.

**Branching:** BUILD works on `plan/29-real-billing`, branched from `spec/29-real-billing` (the approved spec is **not merged to `main` yet** — `origin/main` = `0326298`, spec HEAD = `7bd51e4`). Spec-branch commits ride along; SHIP merges the whole chain.

---

## PLAN-stage decisions (the spec delegated these to this plan)

| # | Decision | Detail |
|---|---|---|
| PDEC-1 | **Razorpay checkout mode: fully-hosted** | Subscriptions Standard: server creates the Subscription via API, owner is redirected to `subscription.short_url` (hosted payment page). No `checkout.js`, no `NEXT_PUBLIC_RAZORPAY_KEY_ID`, PCI stays trivial. Card-update path = the same hosted payment-page link (no Razorpay portal equivalent). |
| PDEC-2 | **Razorpay INR credit redemption: verified fall-back path** | Verified against current Razorpay Subscriptions v1 docs (2026-10-07): there is **no credit-balance or negative-line mechanism** — Offers are dashboard-created discounts, add-ons only *add* charges. Therefore, per spec §8.4: INR banked credits **bank ledger-accurately** (`applied_at` stays NULL); redemption rides the GA pricing decision. If a dashboard-created offer ever yields a zero/discounted renewal invoice, reconciliation settles the ledger from that webhook — the provider stays the sole renewer; `current_period_end` is never written locally. |
| PDEC-3 | **Stripe credit redemption mechanism** | Provider-side: `POST /v1/customers/{customerId}/balance_transactions` with a negative (credit) amount — Stripe auto-applies it to future invoices. Amount = banked months × the server-resolved price for that workspace's tier×cycle×cohort×currency (`lib/billing/prices.ts`); never a client or local write of `current_period_end`. Ledger marked `applied_at` on the confirming `invoice.paid`. |
| PDEC-4 | **Referral activation grant seam: DB trigger** | `workspaces` INSERT trigger (SECURITY DEFINER) resolves the owner through `referral_attribution` → ledger row `trigger_stage='activation', months=1`. Chosen over hooking `ensureWorkspace()` (`services/graph.ts:179-217`) because it is insert-path-authoritative (covers any creator incl. the 23505 race window) and races are absorbed by `UNIQUE (workspace_id, invitee_ref, trigger_stage)`. `ensureWorkspace()` code stays untouched. |
| PDEC-5 | **Ref capture → account linkage** | `app/signup/page.tsx` preserves `?ref` (read at mount) and passes it via `supabase.auth.signUp(options.data.referred_by)`; the `handle_new_user` trigger is extended (same-file companion trigger) to write `referral_attribution(user_id, ref, email_hash, created_at)` — the bridge from waitlist `p_referred_by` to real accounts (spec §2.7). |
| PDEC-6 | **Waitlist DDL dependency** | Waitlist table/RPC DDL is out-of-band (verified: zero matches in `supabase/migrations/`; `join_waitlist` + `brevo_outbox` are applied concerns). The base billing migration references **no waitlist objects**. T2 pre-flight snapshots the live DDL (`join_waitlist` RPC + tables) into `docs/superpowers/specs/29-waitlist-ddl-snapshot.md`; the `is_founding` roster backfill (spot ≤ 500 ∩ `referral_attribution`) ships as a separate idempotent migration only after the snapshot is verified. |
| PDEC-7 | **Cron surface** | No `vercel.json` exists. Add `vercel.json` with `crons`: `/api/cron/billing-reconcile` daily (04:30 UTC) **and** a first-ever schedule entry for the existing `/api/cron/retention-prune`. Guard the new route with the existing `CRON_SECRET` Bearer pattern (`app/api/cron/retention-prune/route.ts:15-23`). |
| PDEC-8 | **Dependencies (§13 ask-first satisfied here)** | Add exactly one npm dep: `stripe` (official, server-only). Razorpay = thin REST wrapper on `fetch` + `node:crypto` — no Razorpay SDK, no webhook dep. Plan approval is the §13 "ask first" approval for this dep list; anything else re-runs the gate. |
| PDEC-9 | **Team `PlanLimits` (provisional pin)** | No source doc pins Team retention/storage. Pin: `historyRetentionDays: 365`, `maxStorageMb: 50000` (Pro envelope) + collaborative cap derived from `seats` (`maxDistinctCollaborators = seats`, owner excluded — seats ≥ 2). **Flagged for TL plan review**; adjust before BUILD if ruled. |
| PDEC-10 | **TL SIL-34 nits 1–5 resolved** | (1) **Drop `credit_overlay_months`** — `credited_months` is the persisted banked counter; banked-vs-applied truth is `referral_credit_ledger.applied_at`. (2) Team-USD-only cites **§16 D11** (not §9). (3) The type is `PlanTier` (spec's "PLAN_TIER 'team'" was shorthand). (4) **Collapse the two plan→cap maps**: route `getPlanCollaboratorLimit` callers (`services/db.ts:408-417`, `services/graph.ts:299,371`) through the single `getPlanLimits` map — D2's Pro=25 makes the legacy map mostly agree except `team→50`, which dies with the seats semantics. (5) Decision numbering is **D1–D11** in all plan/BUILD prose. |
| PDEC-11 | **Ownership-transfer reattach strategy (US-8)** | Subscription follows the workspace row automatically (it already keys by `workspaces.id`). Reattach = (a) transfer updates `workspaces.owner_id` atomically; (b) old owner's auto-billing is **stopped via provider API and verified by read-back** before the transfer completes (never inferred from webhooks) — for Stripe, cancel-at-period-end + verify; (c) new owner must complete a checkout before period end to continue beyond it; (d) the checkout route enforces the §13 hard invariant (single live gateway subscription per workspace — reject if the workspace already has one). |

---

## Global constraints (copied from spec — every task inherits these)

1. **Workspace = billing root.** One subscription per workspace; plan change touches one object, never N user rows.
2. **Free tier survives billing.** Doc cap retired; zero credits metering on any tier; free keeps unlimited local pages, PKM core, markdown, AI via free-key on-ramp + BYOK + BYOL.
3. **No AI credits ledger anywhere.** `used_credits` enforcement is deleted, not migrated.
4. **Client never decides price.** Amounts/tiers resolve only from server-side price objects (env-bound IDs); checkout payloads are opaque session references.
5. **Card data never lands in Lekhan.** Hosted checkout/portal only ⇒ PCI SAQ-A.
6. **Webhooks are the single source of entitlement truth**: signature-verified → raw-recorded → idempotent, read-back-based apply; reconciliation polls.
7. **Existing enforcement plumbing is reused**: `lib/tier-limits.ts` consumers keep their interface; only where the limit is *read from* changes (`profiles.plan` → workspace row).
- **Style:** named exports, tabs, double quotes (matches `lib/tier-limits.ts`); gateway SDK imports server-side only; tests colocate as `tests/unit/billing-*.test.ts`.
- **Never (spec §13):** process unverified webhooks; trust client price/amount/tier claims; store card data; secrets in `NEXT_PUBLIC_*`/commits/issues; delete or redefine `profiles.plan` (read-only mirror until P2); delete user content on downgrade.
- **Verify command** (every task's commit bar): `npm run typecheck && npm run lint && npm test`

## Review Focus (failure modes most likely to bite a person)

1. **Replayed/out-of-order webhooks double-apply or misorder entitlements** → pinned by T7 idempotency + out-of-order convergence tests (unique `event_id`, last-writer-wins on provider version/period fields).
2. **Forged/unverified webhook writes entitlements** → T7 fails-closed signature tests (Stripe tampered header, Razorpay bad HMAC, missing signature ⇒ 400, no row, no effect).
3. **Wrong rail/currency (INR via Stripe, Team in INR)** → T4 server-side routing matrix pins USD↔Stripe / INR↔Razorpay / Team-USD-only; T9's escape-hatch UI test pins US-2 AC1.
4. **GA request resolving founding price IDs** (cohort leakage) → T1 pins: prices resolve `founding|GA` only from the workspace's persisted `is_founding`, never from request state; GA resolver never returns founding IDs.
5. **Legacy `go`/`enterprise` tokens leaking into enforcement** (silent FREE_LIMITS fallback) → T3 pins: `getPlanLimits` accepts only `free|plus|pro|team`; T10 parity test proves the mirror write path can emit only normalized tiers.

## File structure (create / modify / delete)

**Create:** `lib/billing/prices.ts`, `lib/billing/legacy-plan-normalization.ts`, `lib/billing/gateway.ts` (types per spec §5), `lib/billing/gateway-factory.ts`, `lib/billing/gateway-fake.ts`, `lib/billing/stripe.ts`, `lib/billing/razorpay.ts`, `services/billing/webhook-processor.ts`, `services/billing/referral-credits.ts`, `services/billing/reconciliation.ts`, `lib/billing/entitlements.ts`, `services/billing/ownership-transfer.ts`, `app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`, `app/api/billing/cancel/route.ts`, `app/api/billing/webhooks/stripe/route.ts`, `app/api/billing/webhooks/razorpay/route.ts`, `app/api/cron/billing-reconcile/route.ts`, `supabase/migrations/20261007000000_billing_workspace_plans.sql`, `supabase/migrations/20261008000000_founding_roster_backfill.sql` (post-snapshot), `vercel.json`, `tests/unit/billing-*.test.ts`, `tests/fixtures/billing/*`.

**Modify:** `lib/tier-limits.ts` (PlanTier + team, Pro 100→25, seats semantics), `server/auth.js` (`getDocumentOwnerPlan` → workspace source), `services/db.ts` (delete credit paths 428-456 + `getPlanMaxDocuments` + collapse `getPlanCollaboratorLimit`), `services/graph.ts` (299/371 → single map; attribution seam untouched per PDEC-4), `app/api/ai/route.ts` (delete credit gate 139-156 + deduct 158-169), `components/pricing-plans.tsx`, `components/settings-client.tsx`, `components/lekhan-bot-bar.tsx`, `components/profile-menu.tsx`, `app/signup/page.tsx` (ref persistence), `.env.example`, `server/index.js` (relay gate import stays; plan source via entitlements), `server/persister.js:80`.

**Delete:** `services/db.ts:390-456` credits block (`getUserAICredits`, `deductUserAICredits`, `UserAICredits`), `getPlanCollaboratorLimit` + `getPlanMaxDocuments`, credit badges/CTAs in UI.

---

## Task List (Paperclip child issues of [SIL-32](/SIL/issues/SIL-32) are the tracker; this section is the ordered index)

Tasks tracked as Paperclip child issues at BUILD dispatch (external-tracker note per skill; no `tasks/todo.md` in this repo's convention). Checkpoints gate child-issue batch creation.

### Phase 0 — Ops pre-flight

- [ ] **T1 — Env placeholders + waitlist DDL snapshot.** `.env.example` gets placeholder rows for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{PLUS,PRO,TEAM}_{MONTHLY,ANNUAL}_{FOUNDING,GA}_USD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_{PLUS,PRO}_{MONTHLY,ANNUAL}_{FOUNDING,GA}_INR`, `LEKHAN_FAKE_PAYMENTS`, and the **currently missing `CRON_SECRET`**. Dump live waitlist DDL (`join_waitlist` RPC, cohort tables incl. `spot` column semantics) into `docs/superpowers/specs/29-waitlist-ddl-snapshot.md` (PDEC-6). Board/user provisioning checklist (dashboard webhooks + price/plan objects) recorded on the issue — gates BUILD-complete during verification (spec §9). No npm installs yet.

### Phase 1 — Foundations

- [ ] **T2 — `pricing-config`.** `lib/billing/prices.ts`: `resolvePriceRequest(tier, cycle, currency, isFounding)` → `{ amount, currency, priceId | planEnvKey }`, reading **only** env bindings; export `assertFoundingEligible(isFounding)`; GA path structurally cannot return founding IDs (distinct env namespaces). `lib/billing/legacy-plan-normalization.ts`: `normalizeLegacyPlan(p): 'free'|'plus'|'pro'|'team'` with `go→plus`, `enterprise→free`, unknown→`'free'` (mirrors the SQL CASE in T3's migration; parity asserted in tests).
  - Files: Create `lib/billing/prices.ts`, `legacy-plan-normalization.ts`; Test `tests/unit/billing-prices.test.ts`.
  - Tests: cohort-leakage (Review Focus 4) — founding resolution only when `isFounding=true`; TierUnavailable for Team+INR; normalization map pins (`go→plus`, `"Go "→plus case-insensitive trim`, unknown→free).
- [ ] **T3 — Billing schema migration (base).** `supabase/migrations/20261007000000_billing_workspace_plans.sql`: `plan_tiers` (catalog + limits snapshot mirror per spec §4.1), `workspace_plans` (spec §4.2 **minus `credit_overlay_months`** per nit-1 ruling; keep `credited_months`), `gateway_events` (`event_id UNIQUE`, payload jsonb audit-only), `referral_credit_ledger` (`UNIQUE (workspace_id, invitee_ref, trigger_stage)` — **per-stage** grant, spec §4.3), `referral_attribution`. RLS: owner read-own via `workspaces.owner_id`; all writes service-role. Include: (a) `normalize_legacy_plan(text)` SQL fn + one-shot idempotent backfill of `workspace_plans` for every existing `workspaces` row (**no waitlist references**); (b) `handle_new_user` companion trigger writing `referral_attribution` from `raw_user_meta_data->>'referred_by'`; (c) `workspaces` INSERT trigger → activation grant (PDEC-4), SECURITY DEFINER, dedup-safe.
  - Files: Create migration; Test `tests/unit/billing-migration-normalization.test.ts` (SQL fn parity vs TS fn), SQL smoke block in-place.
  - Verify: migration applies + re-applies idempotently on local Supabase; backfill creates exactly one row per workspace with normalized tiers (spot-check `go`→`plus`).
- [ ] **T4 — `tier-limits` cutover (D2 pre-approved edit; collapse nit-4 maps).** `lib/tier-limits.ts`: `PlanTier = 'free'|'plus'|'pro'|'team'`; `TEAM_LIMITS = { historyRetentionDays: 365, maxStorageMb: 50000 }` (PDEC-9, provisional); `getPlanLimits(plan, seats?)` — team collar cap `= seats` (owner excluded; min 2); **Pro `maxDistinctCollaborators` 100→25**; unknowns still FREE_LIMITS (unchanged fall-back). Update pinned tests (`tier-limits-retention.test.ts:29-33` pro→25; keep recalibration pins). Retire the second map: `services/db.ts` `checkCanAddCollaborator` → `getPlanLimits`; `services/graph.ts:299,371` same; delete `getPlanCollaboratorLimit` + fix `db-credits-limits.test.ts` table.
  - Files: Modify `lib/tier-limits.ts`, `services/db.ts`, `services/graph.ts`, 3 test files. Consumers that need no edit: `server/retention.js`, `version-drawer.tsx` (labels derive from `getPlanLimits`).
  - Note: enforcement still reads `profiles.plan` at this point — T4 only widens/respecifies the limit maps; source switch is T10. `server/index.js` relay + `server/persister.js:80` keep working (interface unchanged).
- [ ] **T5 — Gateway abstraction + fake rail.** `lib/billing/gateway.ts` types **exactly per spec §5** (`PaymentGateway`, `CheckoutRequest`, `CheckoutSession`, `gatewayForCurrency`). `lib/billing/gateway-fake.ts`: deterministic fake adapter for `LEKHAN_FAKE_PAYMENTS=1` (returns checkout URL `#fake-checkout`, in-memory subscription lifecycle). This task defines the **interface contract** for the T6/T7 parallel dispatch (AGENTS.md Parallel protocol rule 1).
  - Files: Create trio + `tests/unit/billing-gateway.test.ts`.
  - Tests: routing matrix (USD→stripe, INR→razorpay, Team+INR→rejects with explicit-USD signal); fake adapter honors the contract surface used by webhooks (T8 fake getter for read-back).

### ✔ Checkpoint A (after T2–T5): full suite green; schema migrated; both cap maps collapsed; contract frozen.

### Phase 2 — Rails (parallel after T5; both implement the frozen contract)

- [ ] **T6 — Stripe rail.** `lib/billing/stripe.ts` (SDK, `apiVersion` pinned): `createCheckout` → Checkout Session (mode=subscription/`line_items` from T2 resolution, `metadata.workspace_id`, `subscription_data.metadata.{workspace_id,is_founding}`, success/cancel URLs from `NEXT_PUBLIC_APP_URL`), `portalUrl` (Billing Portal session), `cancelAtPeriodEnd`. `app/api/billing/checkout/route.ts` (owner-only: requester must resolve through their workspace; enforces at-most-one-live-subscription invariant via `workspace_plans` + PDEC-11 check) and `app/api/billing/portal/route.ts`.
  - Files: Create above; Test `tests/unit/billing-stripe.test.ts` (injected client, no network).
  - Tests: session attributes carry workspace context + server-resolved price only; **founding flag persisted at creation** (spec §15 — never re-derived later); invariant rejection path.
- [ ] **T7 — Razorpay rail.** `lib/billing/razorpay.ts`: REST wrapper (`fetch`, Basic auth `RAZORPAY_KEY_ID/SECRET`, base `https://api.razorpay.com/v1`); `createCheckout` → create Subscription (`plan_id` env, `total_count`, `customer_notify`, `notes.workspace_id`) → `CheckoutSession{ checkoutUrl: subscription.short_url, opaqueRef: subscription.id }`; `cancelAtPeriodEnd` → `POST /v1/subscriptions/:id/cancel` with `end_of_cycle`; card-update = hosted payment-page link helper. Shared checkout route gains the razorpay branch via `gatewayForCurrency`.
  - Files: Modify `lib/billing/razorpay.ts` (create), `app/api/billing/checkout/route.ts`; Test `tests/unit/billing-razorpay.test.ts`.
  - Tests: request shape (plan/cycle/cohort from env only); cancel semantics; no portal method (PDEC-1: hosted payment page instead) — keep the seam honest.

### ✔ Checkpoint B: both rails green against the same contract; fakes still pass.

### Phase 3 — Webhook truth (serial — this is the load-bearing wall)

- [ ] **T8 — Webhook processor (both rails).** `app/api/billing/webhooks/{stripe,razorpay}/route.ts` are thin: `export POST` → `services/billing/webhook-processor.ts`. Processor order is hard: (1) signature verify (Stripe SDK `constructEvent` w/ `STRIPE_WEBHOOK_SECRET`; Razorpay HMAC-SHA256 via `node:crypto` timing-safe-equal w/ `RAZORPAY_WEBHOOK_SECRET`) ⇒ fail closed 400; (2) raw insert into `gateway_events` (`event_id` UNIQUE ⇒ duplicate short-circuit 200); (3) **read-back**: fetch the live subscription/customer from the provider API (adapter-seamed) and write entitlement state **from the read-back object** (payload is audit only — spec §6); (4) apply → `workspace_plans` upsert (status/tier/cycle/currency/`is_founding`, `gateway_customer_id`, `gateway_subscription_id`, gateway-mirrored `current_period_end`, seats) + **deprecated mirror** one-line update to `profiles.plan` (normalized values only, never `go`/`enterprise`); (5) event mapping: `checkout.session.completed`, `customer.subscription.updated|deleted` (Stripe), `subscription.authenticated|activated|charged|completed|cancelled|pending|halted` (Razorpay), `invoice.paid` (renewal → referral apply hook from T9), `invoice.payment_failed` → `past_due` + 7-day grace window (D9: full features + banner; relay read-only only after grace expiry); (6) unknown event types ⇒ stored, no-op — never blind-downgrade.
  - Files: Create above; Test `tests/unit/billing-webhooks-core.test.ts`, `billing-webhooks-stripe.test.ts`, `billing-webhooks-razorpay.test.ts` (fixtures in `tests/fixtures/billing/` — recorded-shaped, signed in-test with test keys, no secrets).
  - Tests = Review Focus 1+2: signature tamper/missing reject; duplicate `event_id` replays short-circuit; out-of-order converge (last-writer-wins by provider version/period fields); forged-payload-delta rejected because read-back wins; unknown event stored+no-op; raw-record-before-processing (processor crash after insert leaves the row recorded).
- [ ] **T9 — Referral credits service.** `services/billing/referral-credits.ts`: `grantConversionIfReferred(workspaceOfConvertedUser)` (wired from T8's paid-conversion detection → ledger row `trigger_stage='conversion'`, months=1 — activation rows already exist via T3's trigger); `applyCreditsAtRenewal(workspace)` for Stripe — PDEC-3 (`balance_transactions` credit = months × T2-resolved price; ledger `applied_at` set on confirming `invoice.paid`; `credited_months` decremented); Razorpay = bank-only, never attempt redemption (PDEC-2); bank cap 12 months/workspace **config** (`BILLING_REFERRAL_BANK_CAP_MONTHS`, default 12); self-referral blocked at attribution match-time (same email); ledger summary `getReferralSummary(workspaceId)` for T11 UI.
  - Files: Create service; Test `tests/unit/billing-referral-credits.test.ts`.
  - Tests: per-stage dedup honored; cap blocks grant beyond 12; Stripe apply idempotency (double `invoice.paid` ⇒ single decrement); Razorpay grants bank w/o redemption; UI-11 AC2 (credits unaffected by plan changes).
- [ ] **T10 — Reconciliation cron + scheduling.** `app/api/cron/billing-reconcile/route.ts` (copy the `CRON_SECRET` Bearer pattern verbatim from `retention-prune/route.ts:15-23`) + `services/billing/reconciliation.ts`: select `workspace_plans` rows with `gateway != 'none'` older than a last-checked watermark → per-rail read-back of subscription status/period → converge entitlements + mirror + settle pending referral ledger rows whose confirming invoices exist — always converging **toward** provider truth; never disagrees with the ledger (spec §8 precedence rule). `vercel.json` (PDEC-7) registers both crons.
  - Files: Create route + service + `vercel.json`; Test `tests/unit/billing-reconciliation.test.ts`.
  - Tests: **missed-webhook drill** — no `gateway_events` rows, seeded divergent provider state ⇒ cron converges (US-12 AC2); missed webhook while `past_due` recovers or expires correctly; no-op on already-converged state (idempotent cron).

### ✔ Checkpoint C: idempotency/replay/forgeries all pinned; grants + redemption green; drill green.

### Phase 4 — Enforcement cutover + UI

- [ ] **T11 — Entitlement resolution cutover.** `lib/billing/entitlements.ts`: `resolveWorkspaceEntitlement(workspaceId)` (owner-readable via RLS). Switch the enforcement **source** to workspace state everywhere: `server/auth.js` `getDocumentOwnerPlan` (→ owner→workspace→`workspace_plans.tier`; `profiles.plan` no longer read), share caps already on the single map (T4), relay gate + persister keep `getPlanLimits` (unchanged import). **Dual-read parity test**: seeded workspaces where pre-cutover `profiles.plan` and backfilled workspace row agree ⇒ enforcement equal; disagreement never possible post-mirror-write (T8 normalizes). Past-due grace semantics: relay treats `past_due` as fully entitled until grace expiry (D9).
  - Files: Create `lib/billing/entitlements.ts`; Modify `server/auth.js`; Test `tests/unit/billing-entitlements-parity.test.ts`, plus relay-gate unit adjustments.
  - Tests: legacy token leak guard (Review Focus 5); parity; expiry ⇒ relay read-only (existing server tests extended); downgrades keep content (assert no deletion path touched).
- [ ] **T12 — Credits retirement + billing UI (real states).** (a) **Delete credits enforcement**: `services/db.ts:390-456` (UserAICredits/getUserAICredits/deductUserAICredits), `app/api/ai/route.ts:139-156` 402 gate + :158-169 deduct (BYOK/on-ramp logic stays; nothing meters), `getPlanMaxDocuments`, credit fixtures in `tests/unit/api-ai.test.ts:17`, badges in `components/lekhan-bot-bar.tsx:27,54,104` + `profile-menu.tsx:12,29,52` (→ plan badge), low-credit banners `settings-client.tsx:485-497`. (b) **Billing UI**: `settings-client.tsx` billing tab renders real states from `resolveWorkspaceEntitlement` (tier/cycle/period-end/grace banner/referral summary/portal + cancel + resubscribe per US-6 AC2) — replaces `PricingMatrix({ currentPlan: aiCredits.plan })` at line 579; `pricing-plans.tsx` matrix rebuilt on the PRD §5.1 table (`go`→**Plus** rename matches marketing; founding badge; currency renderer; Team seat picker USD-only; **explicit currency picker with `x-vercel-ip-country` default** per D3); checkout CTAs → `/api/billing/checkout` (replacing `router.push('/signup')` at `pricing-plans.tsx:125-138`) with signed analytics events from PRD §4 (`billing_checkout_started`, …`billing_referral_credit_applied`). Free CTAs stay wall-free (US-4 AC3).
  - Files: Modify 6 components + services/db.ts + api/ai + tests; Test `tests/unit/billing-ui.test.ts` (jsdom/testing-library), extend `api-ai.test.ts` for the de-metered path.
  - Tests: a11y (buttons not divs for CTAs per house React rules), US-2 AC1 escape hatch renders, no credit counter survives (`grep` assertion in test), grace banner states from US-7.
- [ ] **T13 — Ownership transfer (US-8, PDEC-11).** `services/billing/ownership-transfer.ts` + route in settings collaborators tab: atomic `workspaces.owner_id` update; pre-completion provider-API stop of old owner auto-billing **verified by read-back**; new-owner checkout gate before period end; single-live-subscription invariant enforced on the checkout path (T6 reuses it).
  - Files: Create + Modify `components/settings-client.tsx`; Test `tests/unit/billing-ownership-transfer.test.ts`.
  - Tests: double-billing impossible (old auto-bill stopped verified, not inferred); workspace plan continuity across transfer; invariant rejection when a live subscription exists.

### ✔ Checkpoint D: enforcement reads only workspace rows; zero credits/doc-cap surfaces survive; UI states honest.

### Phase 5 — Verify, harden, ship-gate prep

- [ ] **T14 — Full verification + founding backfill + docs.** (a) Founding-roster backfill migration `20261008000000_founding_roster_backfill.sql` (spot ≤ 500 ∩ `referral_attribution`) — only after T1's DDL snapshot is verified (PDEC-6); idempotent; `is_founding` locked at subscription creation regardless of later roster drift (spec §15). (b) Full suite: `npm run typecheck && npm run lint && npm test && npm run build`. (c) CONTEXT.md glossary: "credits" retires to the AI-era ledger definition; banked billing months = "referral credits" on a workspace — one meaning per concept (nit-driven). (d) Manual QA script (recorded as a test-plan comment on the dispatch issue): Stripe test cards success/decline/3DS + portal round-trip via `stripe listen --forward-to`; Razorpay UPI/card test flows + signed-fixture replay into staging webhook; `LEKHAN_FAKE_PAYMENTS=1` UI walkthrough; missed-webhook drill on staging + dashboard webhook-endpoint verification (both rails) **gates BUILD-complete** (spec §9/§14).

**Story coverage (PRD US-1…US-12):** US-1→T6 · US-2→T7+T12 · US-3→T3/T4/T11 · US-4→T12(a) · US-5→T6/T7/T12 · US-6→T6/T7/T12 · US-7→T8(grace)/T10/T12 · US-8→T13 · US-9→T2/T6/T14 · US-10→T3(trigger)/T9/T12(summary UI) · US-11→T9/T10(settle)/T12 · US-12→T8/T10.

## Risks & mitigations (delta beyond spec §15 — build-order level)

| Risk | Impact | Mitigation |
|---|---|---|
| `getPlanLimits` signature/semantics change breaks relay at runtime before T11 cutover | High | T4 keeps the interface and adds `team` only; source switch lands later (T10/T11) — no mixed-source window |
| Migration backfill runs before all enforcement readers switched | Med | Backfill is additive; old reads (`profiles.plan`) stay true until each caller flips; mirror continues to be maintained by T8 |
| Strip/HMAC verification subtleties fail open on malformed input | Critical | Fail-closed default in T8; every handler returns 400 unless verified; raw insert after verify only |
| Vercel cron adds latency to reconciliation (daily) | Low | D9 dunning + grace make daily sufficient; drill proves it (spec §14) |

## Open questions for TL plan review (non-blocking)

1. **Provisional Team limits** (PDEC-9: Pro envelope + seats cap) — confirm or re-spec values.
2. **T14 order**: approving founding backfill post-snapshot vs. shipping it in the base migration once snapshot lands first — TL preference on sequencing.
3. Confirm the `stripe` dependency is the sole §13 ask-first item accepted by this plan (PDEC-8).
