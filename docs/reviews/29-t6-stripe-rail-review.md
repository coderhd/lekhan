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

---

## Cycle 2 re-review — `feat/29-t6-stripe-rail` @ `c0382a9` (verdict: APPROVE)

Delta reviewed: `git diff e7be599 c0382a9` — exactly the 3 owned files (`gateway-factory.ts`, `stripe.ts`, `billing-stripe.test.ts`). Cumulative branch scope unchanged (6 files from base `27e72c7`); `gateway.ts`, fake, `prices.ts`, tier-limits and the three route wrappers remain hash-identical base↔head.

### Deterministic gate (Tech Lead's own run at `c0382a9`, `.env*` copied per F3)
- Focused `billing-stripe.test.ts` + `billing-gateway.test.ts` — **37/37 passed** (16 + 21)
- `npm run typecheck` — clean · `npm run lint` — clean
- `npm test` — **84 files / 647 tests passed** (+1 = the new R2 pin)
- `npm run build` — **passes fresh at `c0382a9`** (&&-chained completion marker observed)
- Re-confirmed by the stage-0 recovery run after the review session was interrupted: focused **37/37**, `typecheck` clean, `lint` clean, full suite **84 files / 647 tests** (94.96s), fresh `npm run build` emits the full route table — all executed at `c0382a9` in the rail worktree, reproducing every number above.

### Required changes — adjudication
- **R1 — PASS.** `builtinRails: Partial<Record<Rail, () => PaymentGateway>> = { stripe: () => getStripeGateway() }`; `ensureRegistered` is now a generic map lookup (`const load = builtinRails[rail]; if (load) registerGateway(rail, load())`) — no rail-specific branch remains in routing logic, and T7 adds exactly one map entry. Entry is an arrow wrapper (binding read deferred to loader call, safe under the `gateway` ⇄ `gateway-factory` cycle). Fake short-circuit and `GatewayNotRegisteredError` fallthrough untouched. Factory header + `stripe.ts` doc comments now describe the map-entry seam. Existing registration + fail-closed pins pass **unmodified** — `billing-gateway.test.ts` has zero delta this cycle (verified: 0-line diff).
- **R2 — PASS.** `effectiveAt ?? ""` sentinel removed. `subscriptionPeriodEnd(subscription)` is checked immediately after `subscriptions.retrieve` and throws `StripeConfigError` **before** `billingPortal.sessions.create` (no discarded side effect). New pin: subscription stub with `items.data: []` → rejects `StripeConfigError` **and** asserts `portalCreate` not called — non-vacuous (it fails under the old sentinel behavior and under a post-session throw).
- **R3 — PASS.** Re-verification bar met in-worktree as specified.

### Independent fresh-context verification (cycle-2)
- **Clean-room subagent**: dispatch #1 died on adapter infra (`getaddrinfo ENOTFOUND opencode.ai`, ~26 min, no report). Dispatch #2 completed a full fresh-context adversarial pass on the delta — author narrative withheld, evidence self-gathered, mutations executed only on a throwaway repo copy. **VERDICT: APPROVE.** R1 PASS (loader map with arrow-only reference at gateway-factory.ts:41-43; cycle confirmed both directions — factory imports `./gateway`, gateway.ts:164 re-exports the factory; zero rail conditionals; fake short-circuit + fail-closed pins green; header docs match the delivered seam). R2 PASS (sentinel gone at HEAD; retrieve→check→create ordering at stripe.ts:184/187/193; new pin non-vacuous by **executed mutation**: restoring the old `e7be599` file → `promise resolved with effectiveAt "" instead of rejecting`; relocating the guard after `sessions.create` → `portalCreate` calls: 1). R3 PASS (3-file delta; 6-file cumulative; all protected paths + `supabase/` zero-diff; `billing-gateway.test.ts` zero-delta with its genuine fail-closed pin at L110-112). Adversarial 1–5 PASS (no double-register path — `registry.has` early-return, lookup cannot fabricate entries for unknown rails; hoisted `getStripeGateway` resolves under any import order; `getSubscriptionState` doctrine unchanged incl. honest `null` period-end; pricing env-resolved server-only, client lazy; per-test stub isolation).
- Subagent findings — both **non-blocking**: 💡 [LOW] `schedulePlanChange` retrieves without `expand: ['items']`; the fail-closed throw turns any provider shape-drift into a total block of plan-change (safe direction by doctrine). Follow-up: pin the required expand params at T8 wire-level tests. 🔍 [LOW] `registerGateway` silent overwrite (pre-existing T5 behavior; already on the cycle-1 non-blocking list).
- **Watchdog** (third, independent agent): verified R1 + R2 in the pushed diff at `c0382a9` and re-ran typecheck/lint/full suite itself (comment `0042a252`, 11:02Z).
- **Tech Lead first-party falsification** (reviewer ≠ author): full reads of `gateway-factory.ts` (L41-50 map seam, L57 fake short-circuit, L60 fail-closed throw) and `stripe.ts` (L187-192 guard before L193 portal session; L240 hoisted loader; L72-80 lazy client; L214-227 read-back doctrine); scope re-derived from git — 3-file delta, 6-file cumulative, protected paths (`gateway.ts` incl. L164 re-export, fake, prices, tier-limits, 3 routes, schema) hash-identical, `billing-gateway.test.ts` zero delta this cycle.
- **Empirical non-vacuity of the R2 pin — Tech Lead mutation tests in the rail worktree** (mutate → focused run → `git checkout` restore; tree confirmed clean at `c0382a9` after each): guard disabled (`if (false && !effectiveAt)`) → new pin **FAILS** (`1 failed | 15 skipped`); portal session reordered **before** the guard → new pin **FAILS** (portalCreate called); post-restore **16/16** stripe + **37/37** focused pair green. The subagent's scratch-copy mutations reproduce both failure modes independently — 2×2 agreement.

### Disposition
**APPROVE** — R1–R3 closed; nothing else changed behavior. Stage-0 review gate passes; T6 advances under the execution flow. Merged-tree work (T6+T7 integration, checkpoints, F1–F3) stays with the parent [SIL-32](/SIL/issues/SIL-32) lead per protocol rule 5.
