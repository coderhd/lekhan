# #29 Clean-Room Review — T9 Referral Credits (`plan/29-real-billing`, SIL-89)

Scope: `services/billing/referral-credits.ts`, `tests/unit/billing-referral-credits.test.ts`,
`lib/billing/stripe.ts` (`getStripeClient` export), `.env.example`
(`BILLING_REFERRAL_BANK_CAP_MONTHS`), companion migration
`supabase/migrations/20261007120000_referral_credit_claim_semantics.sql`,
plan-doc amendments in `docs/superpowers/plans/2026-10-07-h0-real-billing.md`.

Reviewer: independent fresh-context adversarial subagent (Clean-Room Reviewer role per
AGENTS.md Stage 5), 2 cycles.

## Cycle 1 — initial diff (VERDICT: BLOCKING)

Axes: 1 Spec & domain FAIL (one critical) · 2 Concurrency & ledger integrity FAIL(borderline) ·
3 Backend security & error seams PASS · 4 Test quality PASS w/ warnings.

| Sev | Finding | Resolution |
|---|---|---|
| 🚨 CRITICAL 1 | **Annual-cycle workspaces credited ~12× the real value** — apply computed `months × unitPrice.amount` where the annual catalogue amount is a YEARLY figure (pro GA annual = 12000¢/yr), so 12 banked months on an annual plan would have spent $1,440 instead of ~$120. The founding-annual test even pinned the wrong value (8000). | **FIXED** — apply now resolves the annual binding first as a fail-closed config check, then credits at the same-cohort MONTHLY catalogue amount (`resolvePriceRequest(tier, "monthly", …)`); US-11 AC1 (1 banked month = 1 month of the tier value). Tests updated to 800 (1 mo founding annual) + new 2-mo GA-annual pin (2400). |
| ⚠️ HIGH 2 | **`applied_at` doubled as claim set + settlement truth** — a process crash between claim and provider call left rows looking settled (`applied_at` set) but never credited: silent, unrecoverable credit forfeiture; `balanceTransactionId` was never persisted. | **FIXED** — companion migration adds `referral_credit_ledger.claimed_at`; apply now does stale-claim recovery (release claims older than a 10-minute TTL) → conditional claim (`applied_at IS NULL AND claimed_at IS NULL`) → Stripe call (row-set-derived stable idempotency key) → error path releases OUR claim stamp-guarded → settle path sets `applied_at` + clears `claimed_at` **guarded by our claim stamp**, and `credited_months` is decremented ONLY by the months actually settled. Replayed `invoice.paid` claims nothing; a recovered replay hits the same idempotency key → the same provider transaction settled exactly once. |
| 💡 MEDIUM 3 | **Deferred conversion rows strand forever** — the T3 workspaces-INSERT trigger's deferred resolver filtered `trigger_stage = 'activation'`, so a `workspace_id NULL` conversion row could never attach once the referrer's workspace materialized: banked, cap-counted, invisible in the summary, unredeemable. | **FIXED** — the companion migration recreates the resolver stage-agnostic (same body, activation filter dropped; bump stays count-guarded). The service's own promotion remains a guarded belt-and-braces path; both writers only touch rows still `workspace_id IS NULL`, so attach+bump is exactly-once. Residual (LOW): the read→insert grant race can still defer a row into a millisecond window after workspace creation; it resolves on the next conversion grant or T10 convergence. |
| 💡 MEDIUM 4 | Test gaps on the highest-risk seams (CAS loss/exhaustion, billing-root-missing insert path, release failure, concurrency claims). | **FIXED** — new tests: billing-root insert-if-missing; negative-delta no-op; CAS-loss retry vs a simulated concurrent trigger bump (counter = 6, not 6-vs-clobber); CAS exhaustion (`console.error` pinned, ledger row lands, 4 trigger bumps preserved); release-failure logging + aged-claim TTL replay with a stable idempotency key; stale-claim recovery; fresh-claim theft protection; INR-on-stripe fail-closed guard. |
| 🔍 LOW | Currency cross-check (stripe row with INR), PDEC-4 plan-text tension, same-email guard freshness, drift observability. | **FIXED/RECORDED** — INR guard on a stripe-gateway row fails closed (`not-stripe-rail`, test added); the plan's PDEC-4 row is amended with a dated T9-rev note; same-email guard compares the referrer's CURRENT profile email to the hash frozen at invitee signup — accepted AS-SPECIFIED ("blocked at attribution match-time", spec §8.5; a referrer email change disables future same-email blocks, revisit if email changes become hot); CAS exhaustion/settle drift log `console.error` with the ledger remaining the applied truth, `claimed_at` gives T10 a recovery marker. |

## Cycle 2 — re-verification (VERDICT: APPROVE)

Reviewer re-verified all four cycle-1 findings against the current tree **FIXED**, re-confirmed the
cycle-1 verified-clean list (zero Razorpay provider references + gateway/currency guards before any
client use; no local `current_period_end` write; decrement only by `settledMonths`; partial-unique
dedup; `getStripeClient` lazy init), and confirmed the fix-side concurrency reasoning:

- Crash before provider call → TTL recovery → same idempotency key → idempotent replay.
- Crash after provider success → same replay returns the same transaction → settled once.
- Slow worker overtaken past the TTL → first settler wins the claim-stamp guard; the loser settles
  0 rows and decrements 0 — never a double credit or double decrement.
- Fresh-claim theft impossible (recovery only releases `.lt claimTs` stale stamps).
- Migration SQL correct and idempotent (`ADD COLUMN IF NOT EXISTS`; trigger recreation is
  byte-equivalent to the T3 body except the dropped stage filter).

Cycle-2 residual notes (accepted, none blocking):

1. Stale "activation-only resolver" comments → synced in `services/billing/referral-credits.ts` and
   the test header before commit.
2. **T8 handoff contract**: when the losing (overtaken) worker returns `applied: true,
   monthsApplied: 0`, the money WAS provider-spent and settled by the other worker — T8 must not
   interpret that as a redeemable amount or log it as an anomaly.
3. Plan typo ("youth-annual") → fixed.
4. This file existed only after commit of the gate itself → this is that file.
5. `AGENTS.md`/`next-env.d.ts` `next dev` churn → excluded from the billing commit.

## Final verdict

**APPROVE** (cycle 2) — both cycle-1 blockers fixed with tested semantics; residual items are
documentation hygiene recorded above.

Evidence at gate time: T9 suite 30/30 green; full unit suite 693/694 with one pre-existing flaky
timing test (`sync-snapshot-debounce`, passes in isolation); `npm run typecheck` clean; `npm run lint` clean.
