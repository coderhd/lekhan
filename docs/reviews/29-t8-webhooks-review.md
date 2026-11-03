# Stage 5 Clean-Room Review — #29 T8 BUILD (webhooks, both rails)

- **Issue**: SIL-84 (BUILD T8, re-dispatched after SIL-97 EXEC delivery) — epic #29 H0 Real Billing.
- **Branch**: `plan/29-real-billing` (reviewed at `4279405`; T8 code from `25fe13e` + `2e99c82`).
- **Scope**: `services/billing/webhook-processor.ts`, thin receivers `app/api/billing/webhooks/{stripe,razorpay}/route.ts`, `tests/unit/billing-webhook-testkit.ts`, `tests/unit/billing-webhooks-{core,stripe,razorpay}.test.ts`, `tests/fixtures/billing/*`; integration surface `services/billing/referral-credits.ts`, `lib/billing/{prices,stripe,razorpay,workspace-billing,legacy-plan-normalization}.ts`, the `gateway_events`/`workspace_plans` migration.
- **Authority**: plan T8/T9 (`docs/superpowers/plans/2026-10-07-h0-real-billing.md`), spec §6/§8/§13/§14/§15 (`docs/superpowers/specs/29-spec.md`), PRD US-7/US-12, AGENTS.md Stage 5 axes.
- **Method**: fresh-context adversarial subagent (not an author) audited the code and authority docs, ran the focused suites, and falsified claims by fixture/mutation experiments. The BUILD owner then fixed every valid finding under TDD, re-ran the suites, and mutation-tested the new regression pins.
- **Prior gate**: EXEC clean-room review `docs/reviews/pr-29-t8-webhooks-review.md` (APPROVE, 0 blocking, N-1..N-4 fixed). This record is the BUILD-side gate on top of it.

## Verdict

**APPROVE (post-fix)** — one blocking defect was found and fixed (W1); three should-fix and two hygiene findings were fixed; two informational/cross-slice items are explicitly deferred with rationale. Zero open blocking findings.

## Axis results (pre-fix → post-fix)

1. **Spec & acceptance criteria — FAIL → PASS.** Hard order was already correct (verify → raw insert → read-back → apply + `profiles.plan` mirror → referral hooks → unknown no-op), as were canceling encoding (`status=active` + `cancel_at_period_end`), `past_due_since` transitions, terminal downgrade, founding persistence, and T9 wiring. The blocking gap was Stripe invoice pointer extraction on the pinned API version (W1), which silently disabled the renewal hook and direct `invoice.payment_failed` mapping.
2. **Frontend & accessibility — N/A.** No UI files touched.
3. **Storage/state machine — PASS.** Raw record precedes every effect; `event_id` UNIQUE is the idempotency gate; processed replay short-circuits; an unprocessed conflict (crashed processor) repairs idempotently; applies are read-back-driven and idempotent; terminal stale-generation guard prevents clobbering a resubscribed live binding; gone-deletion fallback preserves the stored customer binding; `credited_months` is never touched by the processor.
4. **Backend security & errors — PASS.** Both rails fail closed before any DB read (Stripe `constructEvent`; Razorpay hex HMAC with `timingSafeEqual` + length pre-check). Tampered/missing/wrong-secret ⇒ 400 with zero rows; missing secret ⇒ 500 `webhook_config` with zero rows. The `verify` seam exists only as a test-injected dependency; production routes never pass `deps`. Response bodies are constant strings. Post-fix logs are PII-minimized (`err.message` only).

## Findings and disposition

| id | Severity | Finding | Disposition |
|---|---|---|---|
| **W1** | **blocking** | `stripePointerOf` read `data.object.subscription` on invoice events, but the pinned API version (`2026-09-30.endive`, post-Basil) and the installed SDK expose it at `parent.subscription_details.subscription`. Real `invoice.paid` / `invoice.payment_failed` deliveries would be stored and ignored: T9 renewal credits never applied (US-11 AC1) and payment-failure grace relied on a later subscription event. Fixtures falsely carried the removed field, so tests could not catch it. | **Fixed.** Extract `parent.subscription_details.subscription` first with a legacy root-field fallback (supports a deliberately pre-Basil endpoint pin). Both invoice fixtures rewritten to the pinned shape; a legacy-shape test added. Red→green proven: pinned-shape fixtures failed 2 tests before the fix. |
| **W2** | should-fix | Conversion grant fired on event type alone; Stripe emits `checkout.session.completed` for async/3DS flows whose read-back is `incomplete` (unpaid), so an unpaid checkout could bank a referral conversion month. | **Fixed.** Grant only when the read-back status is entitled (`active`/`past_due`); Razorpay `authenticated` follows the same rule. New stripe test pins `incomplete` ⇒ no grant + `profiles.plan='free'`. |
| **W3** | should-fix | Razorpay reverse-mapping compared the raw env plan id, while the T7 rail sends a trimmed id. A pasted trailing space in `RAZORPAY_PLAN_*` made every INR webhook 502 (`tier/cycle: null`), so entitlements never converged. | **Fixed.** Both sides compared trimmed. New razorpay test pins a padded env binding ⇒ processed and tiered. |
| **W4** | should-fix (latent) | Non-terminal Razorpay applies overwrote `cancel_at_period_end` with the read-back value, but Razorpay never echoes `cancel_at_cycle_end`. Per the SIL-56 binding ruling, T8 must not clear an accepted cancel; once T5 persists the action, a later `pending`/`charged` webhook would have silently removed the detaching signal. | **Fixed.** Preserve a stored `true` only for the same live Razorpay generation; a new generation starts clean and terminal cancellation clears it. Two razorpay tests pin both directions. |
| **W7** | informational (security hygiene) | Read-back/hook failure logs passed the raw error object, which can embed provider response bodies — broader than the file's PII-minimized logging contract (spec §14). | **Fixed.** Log `err.message` only, matching the Stripe verify path. |
| **W8** | informational | Applies never refreshed `updated_at` (DB default fires on insert only), so row staleness was invisible to ops. | **Fixed.** Set `updated_at` in both terminal and non-terminal upsert patches. |
| **W6** | informational | `markProcessedFor`/`ignoreEvent` do not verify that a row was actually updated (PostgREST returns no error for 0 rows). | **Accepted, no code change.** A vanished audit row implies manual deletion; there is no entitlement effect and a provider redelivery would re-record. Revisit only if the audit table becomes an operational SLO source. |
| **W5** | nice-to-have (latent) | The stale-generation guard covers terminal read-backs only. A delayed **non-terminal** event for a predecessor subscription could transiently rewrite `gateway_subscription_id` after a resubscribe. | **Deferred to T10 reconciliation.** T10 converges every active binding toward provider truth from the stored watermark, and the fail direction is self-healing; a generation-ordering rule here would need provider `created` semantics that T10 owns. Recorded as a T10 input. |
| **W9** | informational (cross-slice) | Terminal cancel deliberately preserves `is_founding`; the checkout route reuses it on resubscribe, so a lapsed founder could re-enter at founding prices. | **Deferred to T5/T12.** US-9 wording ("as long as I stay subscribed") needs an explicit product ruling; T8 correctly persists provider-truth founding state and must not invent a forfeiture rule. |

## Mandatory pins — post-fix evidence

| Pin | Status |
|---|---|
| Tampered/missing/wrong-secret signature ⇒ 400, zero rows (both rails) | PASS |
| Duplicate `event_id` replay ⇒ 200 short-circuit, no second apply | PASS |
| Out-of-order deliveries converge to provider read-back (last-writer-wins) | PASS |
| Forged payload delta rejected because read-back wins | PASS |
| Unknown event stored + marked processed + no-op, never blind-downgrade | PASS |
| Raw record before processing; crash/failure leaves `processed_at NULL` | PASS |
| `invoice.paid` renewal → T9 `applyCreditsAtRenewal` (pinned invoice shape) | PASS (new) |
| Paid conversion → T9 `grantConversionIfReferred`, unpaid/incomplete excluded | PASS (new) |
| Razorpay `charged` renewal hook (INR no-op per PDEC-2) | PASS |
| Razorpay cancel-at-cycle-end not cleared by non-terminal webhooks | PASS (new) |

### Mutation checks (new pins are not vacuous)

Reverting each fix individually made exactly its regression test fail:

- conversion gate → `does not grant conversion credit when the checkout subscription is still unpaid (incomplete)`
- Razorpay cancel preservation → `preserves an accepted cancel-at-cycle-end across non-terminal Razorpay webhooks`
- env trim → `reverse-maps a padded Razorpay plan env binding`

## Verification (post-fix)

- Focused webhook + referral suites: **87/87 green** (`billing-webhooks-core` 24, `billing-webhooks-stripe` 16, `billing-webhooks-razorpay` 17, `billing-referral-credits` 30).
- All billing suites: **196/196 green** (11 files).
- Full suite: **773/773 green** (91 files).
- `npm run typecheck` ✓.
- `npx eslint app services lib tests components` ✓ (repo-wide `npm run lint` additionally scans an untracked `.paperclip-scratch/` directory from prior runs; excluded from the deliverable, not committed).

## Residual / deferred (carried forward)

- W5 non-terminal generation ordering → T10 reconciliation input.
- W9 founding re-entry after lapse → T5/T12 product ruling.
- EXEC-review N-5 still open by design: `X-Razorpay-Event-Id` is unsigned (apply idempotent, hooks dedup-safe); route bodies aren't size-bounded before `request.text()` (platform limits); `gateway_events.event_id` is unique across rails (signature-gated). Revisit with T10/T14.
- Live sandbox verification of dashboard endpoint API-version pinning remains T14 (the code now supports both invoice shapes).
