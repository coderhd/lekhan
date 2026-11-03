# Clean-Room Review — T12: Credits retirement + billing UI

- **Issue:** SIL-122 (BUILD T12, epic SIL-32 / #29 H0 Real Billing)
- **Branch:** `plan/29-real-billing`
- **Reviewer:** fresh-context Clean-Room Reviewer subagent (writer ≠ verifier)
- **Gate:** `typecheck` PASS · `lint` PASS · `npm test` **96 files / 843 tests PASS** · `build` PASS

## Verdict

**APPROVE after fixes.** Cycle 1 returned CHANGES-REQUESTED with two blocking
UI-correctness defects and one false product claim. All three were fixed and
re-verified; the remaining notes are recorded below as follow-ups outside T12's
file scope.

## Cycle 1 findings → disposition

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | BLOCKING | Resubscribe POSTed `entitlement.tier` — after a terminal cancel the webhook rewrites tier to `free`, so the CTA always 400'd (`isBillingTier` accepts only plus/pro/team). | **FIXED** — Resubscribe renders only for `cancelAtPeriodEnd` while the tier is still paid; terminal-free workspaces choose a paid plan from the matrix. Handler guards `tier === 'free'`. |
| 2 | BLOCKING | Team card multiplied the per-seat amount by seats but kept the `/ seat / month` suffix, overstating the seat price. | **FIXED** — headline is per-seat monthly; the subline carries the seat total (`billed annually at $200/yr for 2 seats`). Regression test pins 2 → 5 seats. |
| 3 | BLOCKING | "Upgrades apply immediately and are prorated" was stated unconditionally, but Razorpay's `schedulePlanChange` always patches `schedule_change_at: cycle_end`. | **FIXED** — copy is rail-specific in both the billing card and the pricing matrix: Stripe = immediate/prorated upgrades + period-end downgrades; Razorpay = all changes scheduled at period end. |
| 4 | MAJOR | Resubscribe via checkout overlaps the paid remainder / omits Team seats. | **PARTIAL** — PDEC-11 explicitly permits a successor checkout against a verified-detaching predecessor, so the mechanism stands; Team seats are now included (`seats: entitlement.seats ?? 2`). Overlap copy and provider-side "cancel the cancellation" remain a T13/T14 live-sandbox item. |
| 5 | MAJOR | Country default was a browser heuristic, not `x-vercel-ip-country`. | **FIXED** — new `GET /api/billing/currency` reads the edge header server-side (`IN` → INR, else USD); settings adopts it while the explicit picker stays authoritative (US-2 AC1). |
| 6 | MAJOR | PRD §5.1 Team volume bands (11–25 seats) are not implemented in the price resolver. | **DEFERRED (not T12)** — the display catalogue mirrors what the server actually charges (T2's approved flat `team` amount); inventing UI-only bands would misstate the charge. Recorded as a T2/T14 pricing follow-up. |
| 7 | MAJOR | No seat-change path for an existing Team subscription. | **DEFERRED (T13/live-sandbox)** — seat quantity changes ride the provider portal (Stripe) and the Razorpay quantity PATCH; wiring is outside T12's component-only scope. |
| 8 | MAJOR | Razorpay cancel race: checkout gate reads the stored `cancel_at_period_end`, but the cancel route never wrote it. | **FIXED** — the cancel route now mirrors the provider-acknowledged instruction (`cancel_at_period_end = true`) after a 2xx, per SIL-56 R-CANCEL-FLAG; write failure is logged without discarding the provider action. Route test asserts the mirror write. |
| 9 | MINOR | `services/db.ts` still reads `profiles.plan` as the T11 invitee fallback. | **RETAINED** — deliberate T11 design (owner workspace row is unreadable from an invitee accept path); not a credits reader. |
| 10 | MINOR | `billing_referral_credit_applied` fires on summary load when `appliedMonths > 0`. | **ACCEPTED** — deduped per mount via ref; the event carries months, never note data. Revisit when T14 wires the provider-side apply telemetry. |
| 11 | MINOR | Stale "credit usage" copy in the unified settings modal. | **FIXED** — now "billing and plan usage". |
| 12 | MINOR | `priceAmountMinor('team', …, 'INR')` silently returns USD cents. | **ACCEPTED** — server resolution rejects Team+INR (`TierUnavailableError`); the helper comment states the guard contract. |
| 13 | MINOR | No `plan-change` guard for terminal rows / seat bounds. | **ACCEPTED** — the route requires a stored gateway + subscription ref; provider read-back is authoritative and rejects terminal changes. Seat bounds are a T13 concern. |

## What the final diff proves

- **Credits retired end-to-end:** `UserAICredits`, `getUserAICredits`,
  `deductUserAICredits`, `getPlanMaxDocuments` and the `createDocument` 5-doc cap
  are gone; `/api/ai` has no 402 gate and no deduction; every credit badge/meter
  is replaced by an entitlement plan badge; a component-tree grep assertion
  guards the surfaces.
- **Billing UI is real:** the settings billing tab renders tier, cycle, period
  end, `cancel_at_period_end` ("cancels on …"), the D9 grace banner from
  `past_due_since`, the read-only state, and the T9 referral summary from
  `/api/billing/summary`, with portal/cancel/resubscribe actions.
- **Plan changes are mechanism-bound:** Stripe rides the Billing Portal; Razorpay
  gets a real `schedulePlanChange` route (previously the gateway seam had no
  caller). Copy tells the truth per rail.
- **Pricing is catalogue-driven:** Plus rename, founding badge, explicit
  currency picker with a server geo default, Team seat picker (USD-only escape
  hatch), and CTAs that POST only `{tier, cycle, currency, seats}`;
  `billing_checkout_started` / `billing_referral_credit_applied` are in the
  analytics allowlist.
- **Free stays wall-free:** the Free CTA is a signup route, never checkout.
