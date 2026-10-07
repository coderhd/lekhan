# Clean-Room Review — #29 T6 Stripe rail (`feat/29-t6-stripe-rail` @ `e7be599`)

- **Gate**: AGENTS.md Stage 5 REVIEW (stage-0 review participant: Tech Lead). Woken by watchdog verification comment on SIL-42, 2026-10-07.
- **Diff under review**: `git diff 27e72c7...e7be599` — single commit; 6 files: `lib/billing/stripe.ts` (+233), `lib/billing/gateway-factory.ts` (+16), `package.json`/`package-lock.json` (`stripe@^23.0.0`), `tests/unit/billing-stripe.test.ts` (+363), `tests/unit/billing-gateway.test.ts` (1 `it` rewritten).
- **Method**: two independent fresh-context verifiers (Spec axis, Standards axis) + Tech Lead adjudication, per `code-review` + `lekhan-verification` skills. Author narrative not used as evidence.

## Deterministic gate (must all pass — all green)

| Check | Evidence | Runner |
|---|---|---|
| `npm run typecheck` | clean | watchdog @ e7be599, then spec verifier re-confirm |
| `npm run lint` | clean | watchdog @ e7be599 |
| `npm test` | 84 files / 646 tests passed | watchdog @ e7be599; spec verifier focused re-run: 36/36 (stripe 15, gateway 21) |
| `npm run build` | success (full route table emitted) | Tech Lead @ e7be599. Caveat: a bare worktree has no untracked `.env`/`.env.local`; build fails at page-data collection (`supabaseUrl is required`, `lib/supabase.ts:9`) — environmental, NOT a T6 regression. Copy `.env*` into worktrees before building. |

## 🔍 Clean-Room Review Summary (4 axes)

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs (plan T6 / spec §5 as amended by PDEC-12 / §13) | PASS | All plan-T6 bullets present and pinned: subscription-mode session, env-only `line_items` via `resolvePriceRequest`, `metadata.workspace_id`, `subscription_data.metadata.{workspace_id,is_founding}` (founding persisted at creation), `NEXT_PUBLIC_APP_URL` success/cancel, customer-reuse support, `apiVersion` pinned `"2026-09-30.endive"` = stripe@23 bundled value, portal session, `flow_data.subscription_update` deep link, `cancel_at_period_end`, read-back with `resource_missing→SubscriptionNotFoundError`. B2 invariant-rejection surface is legitimately pinned in T5 (route tests L235–291 byte-identical to base). |
| 2. Frontend & a11y | N/A | No UI in diff. |
| 3. CRDT & Storage | N/A | No storage/CRDT code in diff. |
| 4. Backend security & error seams | PASS w/ 1 finding | No client amount/price/tier path; unknown statuses never map to `canceled` (no blind-downgrade); missing env → hard throw. **Finding**: `effectiveAt: subscriptionPeriodEnd(sub) ?? ""` emits a `""` sentinel into the frozen `SchedulePlanChangeResult.effectiveAt: string` — violates the module's own "fails closed, never a fallback" doctrine (`getSubscriptionState` correctly returns `null`; same shape should fail, not lie). |

Scope discipline: **PASS** — diff is exactly the owned files; `gateway.ts`, `gateway-fake.ts`, `prices.ts`, `tier-limits.ts`, and the three route wrappers are hash-identical base↔head.

### Two-axis divergence (kept separate per method)
- **Spec axis verdict**: approve-with-notes (effectiveAt note, seam-shape note).
- **Standards axis verdict**: `ensureRegistered` is a **hard violation** of the factory's documented seam contract — the T5 header (unchanged at base) states: *"Rails register with a single line … the routing logic below is never edited when a rail is added."* T6 added a rail-specific branch inside the lookup path and inverted the doc'd push-registration seam; T7 must re-edit that branch (Shotgun Surgery / Repeated Switches). Must-fix before merge.

## Tech Lead adjudication of the 5 disclosed flags

1. **Plan naming (`stripe.ts` over dispatch's `t6-stripe.ts`)** — **ACCEPT.** Dispatch declares the plan authoritative task text; plan file-list says `lib/billing/stripe.ts`, and the branch name matches the rail. (Issue title mis-says "Razorpay"; corrected on the board.)
2. **Lazy `ensureRegistered` instead of literal one-line registration** — **PARTIALLY ACCEPT.** The import-cycle hazard is real (gateway.ts re-exports the factory; top-level rail-side registration observed to fail). But the delivered shape breaches the seam's own documented invariant. **Mandatory refactor** → data-driven loader map, see Required Changes R1.
3. **Rewritten T5 fail-closed assertion** — **ACCEPT.** Post-rail, the old USD-throws assertion is false by design; the rewrite pins `gatewayForRail('unknown')` → `GatewayNotRegisteredError` — fail-closed is genuinely tested, not weakened. The INR-unregistered pin is lost until T7; checkpoint B re-pins at merged state.
4. **`customerRef` not wired through the checkout route** — **CONFIRMED OUT OF T6 SCOPE, ESCALATED.** Routes are T5-owned and untouched (verified hash-identical); frozen `CheckoutRequest` has no customer field (verified). Adapter support + test pin exist. The end-to-end US-6 AC2 gap is a plan-level wiring decision: checkout route must pass `context.plan.gateway_customer_id` and the contract needs a customer field (or per-rail cast). → Follow-up for parent SIL-32 lead before/at T12 dispatch.
5. **Razorpay unregistered on this branch** — **EXPECTED.** `gatewayForCurrency('INR')` fails closed until T7 merges; merged tree to be re-verified by the lead (protocol rule 5).

## Verdict: REQUEST CHANGES (narrow, mechanical)

### Required Changes
- **R1 — factory seam to data-driven lazy loaders** (`lib/billing/gateway-factory.ts`): replace the rail-specific `if` inside `ensureRegistered` with a map, so T7 adds exactly one entry and routing logic is never edited again:
  ```ts
  /** Built-in rails: one line per rail (T6 stripe, T7 razorpay); routing logic below never edited. */
  const builtinRails: Partial<Record<Rail, () => PaymentGateway>> = {
  	stripe: () => getStripeGateway(),
  }
  function ensureRegistered(rail: Rail): void {
  	if (registry.has(rail)) return
  	const load = builtinRails[rail]
  	if (load) registerGateway(rail, load())
  }
  ```
  Entries **must** be arrow wrappers, not bare function references: a bare reference is read at factory module-evaluation time inside the gateway⇄factory cycle and can silently bind `undefined` (same cycle class that bit the original top-level attempt — this variant would fail *quietly*, not loudly). Keep the fake short-circuit ahead of `ensureRegistered` and the `GatewayNotRegisteredError` fallthrough untouched. Update the factory header + `stripe.ts` doc comments so the documented contract matches reality ("one map entry per rail"). Existing registration pin (`Stripe rail registration` test) and fail-closed pins must pass **unmodified**.
- **R2 — `effectiveAt` fail-closed** (`lib/billing/stripe.ts` `schedulePlanChange`): when the provider read-back lacks `current_period_end`, throw `StripeConfigError` (module doctrine: never a fallback) instead of emitting `""`. Recommended: add a small pin (stub subscription with empty items → rejects).
- **R3 — re-verify**: `npm run typecheck && npm run lint && npm test` in the worktree (with `.env*` copied), plus focused `tests/unit/billing-stripe.test.ts tests/unit/billing-gateway.test.ts`. Push to `feat/29-t6-stripe-rail`; report here. No file outside the owned set may change.

### Approved / non-blocking (no action in this cycle)
- `mapStatus` unknown→`incomplete` (honest, conservative, no blind-downgrade); `trialing`→`active`.
- Module-level `cachedClient` singleton (no reset seam): acceptable for process lifetime; revisit only if T12 needs env re-resolution.
- `getStripeGateway()` name implying a singleton but returning fresh instances: moot once R1 lands (call-site count is one).
- `StripeConfigError` reused for "no hosted URL" — name drift; fold into R2 pass if convenient, not mandatory.
- Double currency-guard (`UnsupportedCurrencyError` + `assertSellableCheckout`) — belt-and-suspenders, keep.

### Follow-ups (parent SIL-32 lead, post-merge)
- F1: checkout route → pass `gateway_customer_id` for resubscribe (US-6 AC2 end-to-end; contract decision: add optional `customerRef` to `CheckoutRequest` or per-rail cast at route).
- F2: merged-tree checkpoint B re-run incl. `gatewayForCurrency('INR')` routing pin (after T7).
- F3: worktree hygiene note — copy `.env`/`.env.local` into new worktrees before `npm run build` (page-data collection evaluates `lib/supabase.ts`).
