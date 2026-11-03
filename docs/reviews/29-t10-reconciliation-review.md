# Stage 5 Clean-Room Review — #29 T10 BUILD (reconciliation cron + scheduling)

- **Issue**: SIL-85 (BUILD T10) — epic #29 H0 Real Billing.
- **Branch**: `plan/29-real-billing` (reviewed on top of T8 `4827575`).
- **Scope**: `services/billing/reconciliation.ts` (new), `app/api/cron/billing-reconcile/route.ts` (new), `vercel.json` (new), `services/billing/webhook-processor.ts` (extracted/exported shared read-back + `applyEntitlementFromReadBack`), `tests/unit/billing-reconciliation.test.ts`, `tests/unit/api-cron-billing-reconcile.test.ts`.
- **Authority**: plan T10 + PDEC-2/3/7 + TL B3 + SIL-56 rulings (`docs/superpowers/plans/2026-10-07-h0-real-billing.md`), spec §6/§8/§9/§13 (`docs/superpowers/specs/29-spec.md`), PRD US-7/US-12 AC2, AGENTS.md Stage-5 axes.
- **Method**: fresh-context adversarial subagent (not the BUILD author) read the authority docs and the staged diff, falsified the claims against the migration, the T9 service, and the installed Stripe SDK types, and ran the focused suites + typecheck + lint. The BUILD owner then fixed every valid finding under TDD and re-ran the suites.

## Verdict

**APPROVE (post-fix)** — one HIGH money/entitlement-safety finding and five MEDIUM findings were fixed; two LOW test gaps were fixed; two LOW items are explicitly deferred with rationale. Zero open blocking findings.

## Axis results (pre-fix → post-fix)

1. **Spec & acceptance criteria — PASS.** T10's named surface is complete: `workspace_plans` rows with `gateway != 'none'` are selected past the `last_checked_at` watermark (pushed into the query), each rail is read back, `workspace_plans` + the `profiles.plan` mirror converge through the same apply primitive the webhooks use, the watermark advances, and `vercel.json` registers the billing cron at 04:30 UTC alongside a first-ever retention-prune schedule (PDEC-7). Missed-webhook drill, D9 recovery/expiry, idempotent no-op, and invoice-gated ledger settlement are all pinned.
2. **Frontend & accessibility — N/A.** No UI touched. Route auth/error shape is a verbatim copy of `retention-prune` (header-only Bearer, query-string attempts rejected, partial failure ⇒ 500, GET + POST).
3. **Storage/state machine — PASS (post M1/M4).** The read-back → apply primitive is shared with T8, so past_due clocks, Razorpay stored-cancel preservation, terminal downgrades, stale-generation guard, and the mirror cannot drift between writers. The work list is watermark-filtered and bounded (oldest-first, 200/sweep), so PostgREST's row cap cannot silently drop billed workspaces. Timestamp equality is instant-based, so a converged row is a literal no-op.
4. **Backend security & errors — PASS (post H1/M2).** Entitlements are written only from a provider read-back. A provider 404 is corroborated against the stored customer binding before it may terminalize; a wrong key/account/mode now fails loudly with no write instead of mass-downgrading. Referral settlement runs inside T9's claim → provider-credit → settle pipeline, is Stripe-only (INR banks, PDEC-2), and only fires when a paid invoice exists at/after the earliest unapplied grant. Failures keep the row stale and answer 500; logs are PII-minimized.

## Findings and disposition

| id | Severity | Finding | Disposition |
|---|---|---|---|
| **H1** | **high** | A provider 404 was terminalized immediately (`canceled` → `free` + mirror) for every matched row. Both rails retain cancelled subscriptions, so a 404 in production usually means a wrong key/account/mode — one misconfigured sweep would have mass-downgraded paying workspaces while the provider kept billing, and the run still answered 200. | **Fixed.** A 404 no longer terminalizes on its own: reconciliation corroborates the stored `gateway_customer_id` via a new `customerExists` seam (Stripe `customers.retrieve`, Razorpay `GET /customers/:id`). Missing customer ⇒ `provider-error`, no write, watermark unchanged, 500. Missing customer binding on the row ⇒ same refusal. Tests pin both refusals and the corroborated terminal path. |
| **M1** | medium | "No-op on converged state" was false in production: Postgres returns `timestamptz` as `...+00:00` while providers hand back `....000Z`, so `current_period_end` never compared equal and every active row was re-upserted daily (the fake DB hid this by echoing the provider string). | **Fixed.** `samePlanValue` compares date-shaped fields by instant. New test seeds the stored `+00:00` form and asserts `unchanged` with `updated_at` untouched. |
| **M2** | medium | A referral-settlement failure still advanced `last_checked_at`, so a manual re-run skipped the row and reported green — contradicting the documented retry contract. | **Fixed.** The watermark is stamped only after settlement succeeds. New test: failed settlement ⇒ watermark unchanged, `failures=1`; second run re-checks and re-attempts. |
| **M3** | medium | The confirming-invoice window used `min(earliest grant, previous watermark)`, so a post-outage sweep could match an invoice that predates the banked month. | **Fixed.** The window is anchored on the earliest unapplied grant only (a pending claim is always newer than its grant, so crash recovery is still covered). New test with a watermark older than the grant pins the anchor. |
| **M4** | medium | The work list was one unbounded `select()`: PostgREST's default row cap could silently drop billed workspaces, and there was no per-invocation bound. | **Fixed.** Watermark predicate moved into the query (`last_checked_at IS NULL OR < cutoff`), oldest-first, `MAX_WORKSPACES_PER_SWEEP = 200`; unprocessed rows stay stale for the next run. Route declares `maxDuration = 300`. |
| **M5** | medium | The production invoice lookup (the money gate) had no coverage — only the injected seam was tested. | **Fixed.** New test mocks the Stripe client and asserts `invoices.list({ status:'paid', created:{gte}, subscription })`, the grant-derived `gte`, and that settlement is reached only from the real lookup. |
| **L1** | low | `gateway_events` length assertions were vacuous (the service never writes that table). | **Fixed.** The fake DB records touched tables; tests now assert `gateway_events` was never touched. |
| **L2** | low | No negative-path pins for retry/watermark/config faults. | **Fixed.** Added read-back-failure retry and config-error (unmapped price ⇒ no write, failure) tests. |
| **L3** | low | No watermark lease; overlapping invocations can duplicate provider reads. | **Deferred.** Entitlement applies are idempotent and T9's `claimed_at` claim serializes credits, so money is safe; duplicated GETs are bounded by the daily schedule and the per-row watermark. A conditional claim would add a write on every row for no correctness gain at H0. |
| **L4** | low | Unmapped provider prices silently preserved the stored tier (T8 fails loud). | **Fixed (observability).** The fallback is kept — reconciliation converges status/period and must survive price-binding rotation — but now logs a PII-minimal `console.warn` with workspace id + stored tier. |
| **L5** | low | Bearer comparison is not timing-safe. | **Deferred to parity cleanup.** PDEC-7 requires copying the retention-prune pattern verbatim; changing one cron route without the other would create inconsistent guards. Revisit both routes together. |

## Mandatory pins — post-fix evidence

| Pin | Status |
|---|---|
| Missed-webhook drill: no `gateway_events`, divergent provider state ⇒ cron converges (US-12 AC2) | PASS |
| Missed `past_due` recovery (provider active ⇒ clock cleared) | PASS |
| Missed `past_due` expiry (terminal ⇒ free; still past_due ⇒ D9 anchor preserved, never reset) | PASS |
| No-op on already-converged state (idempotent cron, no upsert churn) | PASS |
| Ledger settlement only when a confirming paid invoice exists (and never for INR) | PASS |
| Provider 404 corroborated; wrong account ⇒ no write + failure (H1) | PASS |
| Referral failure does not advance the watermark (M2) | PASS |
| Watermark excludes fresh rows without provider calls (TL B3) | PASS |
| `last_checked_at` advances only after a durable, settled convergence | PASS |
| `vercel.json`: retention-prune schedule + billing-reconcile daily 04:30 UTC (PDEC-7) | PASS |

## Verification (post-fix)

- Focused reconciliation + route suites: **23/23 green** (`billing-reconciliation` 19, `api-cron-billing-reconcile` 4).
- All billing suites + cron route: **219/219 green** (13 files), including `billing-webhooks-core/stripe/razorpay` and `billing-referral-credits` after the shared-apply refactor.
- `npx tsc --noEmit` — clean.
- `npx eslint` on every changed file — clean.
