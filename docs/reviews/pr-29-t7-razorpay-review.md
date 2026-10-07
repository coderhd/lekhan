# Clean-Room Review Gate: SIL-43 — T7 Razorpay Rail (Epic #29 H0 Real Billing)

- **Change set**: `feat/29-t7-razorpay-rail` @ `d675f09` on base `plan/29-real-billing` @ `27e72c7` (single commit; origin == local verified three times incl. watchdog re-verify)
- **Files**: `lib/billing/razorpay.ts` (new, 394), `lib/billing/gateway-factory.ts` (+5 one-line self-registration), `tests/unit/billing-razorpay.test.ts` (new, 447 / 20 tests), `tests/unit/billing-gateway.test.ts` (6-line T5 refresh)
- **Author**: Dev Engineer (`fd5a904a`) · **Reviewer of record**: Tech Lead (`2a369db2`) — writer ≠ verifier · **Clean-room pass**: fresh-context adversarial reviewer (no author narrative) consolidated below; every blocking finding re-verified first-hand by the reviewer of record
- **Verdict**: **REQUEST CHANGES** — 3 blocking findings, all fixable inside T7-owned files

## 0. Deterministic gate (evidence, run at d675f09)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | exit 0 |
| `npm run lint` | PASS | exit 0 |
| `npm test` | PASS | 84 files / 651 tests |
| Focused re-runs | PASS | billing-razorpay 20/20 + billing-gateway 21/21 (run twice: reviewer-of-record + watchdog) |
| `npm run build` | PASS | exit 0 (Turbopack "symlink node_modules" debug lines are worktree-link noise) |
| Boundary | PASS | `git diff --stat 27e72c7..d675f09` = exactly the 4 files; no routes/types/fake/schema/tier-limits/package.json edits; **no new npm deps** (plain `fetch`, no SDK — spec §13 "Ask first" avoided by construction) |

The gate masks Finding 1: every landed test file happens to import `gateway`/`gateway-factory` before `razorpay` (import-order luck, not a pin).

## 1. Axes

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs (PDEC-1/8/11/12, plan T7) | **FAIL** | Boundaries clean; request/response shapes audit clean vs official docs; cohort-lock sound — but `retrieveScheduledChange`'s null path is provider-impossible, and the portal seam fails its end-to-end trace. |
| 2. Frontend & a11y | N/A | Server-only change; no UI/JSX touched. |
| 3. CRDT & Storage | N/A | No CRDT/storage edits; `workspace_plans` untouched. |
| 4. Backend Security & Errors | **FAIL** | Secrets/auth/traversal/error-mapping solid (lazy env reads, Basic-auth never logged, `encodeURIComponent` on refs, routes return generic 502s — no provider-detail client leak). But: empirically-demonstrated registration eval-order hazard, and no fetch timeout. |

## 2. Blocking findings (fix in rework; all within T7-owned files)

### 🚨 [BLOCKING-1] Rail self-registration silently fails under a `razorpay.ts`-first static import
- **File**: `lib/billing/gateway-factory.ts:21,46` + `lib/billing/razorpay.ts:385-394` (cycle `gateway.ts:164 ⇄ factory ⇄ razorpay`)
- **Issue**: The factory tail `registerGateway("razorpay", razorpayGateway)` dereferences `razorpayGateway` during the factory's *body evaluation*. When `razorpay.ts` is the module-graph entry (razorpay → gateway → factory), the factory body runs while razorpay's body hasn't: the binding reads `undefined` (Vite/bundler transform, empirically confirmed) or throws TDZ `ReferenceError` (native ESM). Result: `gatewayForRail("razorpay")` throws `GatewayNotRegisteredError` for **every INR call** — silently, at boot. The plan's T8 webhook-processor fetches Razorpay read-backs and plausibly imports the rail first.
- **Evidence**: scratch probe (static `import … from "@/lib/billing/razorpay"` as first import) failed at d675f09: `GatewayNotRegisteredError: No gateway registered for rail "razorpay"` at `gateway-factory.ts:36`. Alternative shapes attempted and rejected: `registerGateway("razorpay", createRazorpayGateway())` → `TypeError: createRazorpayGateway is not a function` under the same order (transform does not hoist across the cycle).
- **Recommended fix (validated green by the clean-room reviewer: probe + 20/20 + 21/21)**: keep the one-line seam but pass a call-time lazy delegate whose closures resolve after full graph evaluation:
  ```ts
  registerGateway("razorpay", {
    get rail() { return razorpayGateway.rail },
    createCheckout: (...a) => razorpayGateway.createCheckout(...a),
    portalUrl: (...a) => razorpayGateway.portalUrl(...a),
    schedulePlanChange: (...a) => razorpayGateway.schedulePlanChange(...a),
    cancelAtPeriodEnd: (...a) => razorpayGateway.cancelAtPeriodEnd(...a),
    getSubscriptionState: (...a) => razorpayGateway.getSubscriptionState(...a),
  })
  ```
- **Mandatory regression pin**: a permanent test file whose **first static import is `@/lib/billing/razorpay`**, asserting `gatewayForRail("razorpay")` resolves to the real, callable rail (fake env off). Also keep factory-first and gateway-first entry coverage. This hazard is invisible to the existing suite; the pin is the only guard.
- **Lead note for T6**: the Stripe registration must adopt the same shape (merge seam resolved at integration).

### 🚨 [BLOCKING-2] `retrieveScheduledChange`'s "no pending change → null" path cannot exist against the provider
- **File**: `lib/billing/razorpay.ts:341-346`; mis-pinned by `tests/unit/billing-razorpay.test.ts:291-322`
- **Issue**: Official docs (Fetch Details of a Pending Update, Errors accordion) define **"No Pending update for this subscription. — Code: 400"**. So `http.request` throws `RazorpayApiError(400)` before the `has_scheduled_changes !== true → null` line ever runs; the test replays a 200 with `has_scheduled_changes:false` that the provider never sends. Every "is a change pending?" query on a clean subscription becomes an error, not `null`.
- **Recommended fix**: pre-check the documented entity flag — `GET /subscriptions/:id`; return `null` when `has_scheduled_changes !== true`; only then call `retrieve_scheduled_changes` (whose success response is the top-level subscription entity — the rail's pending-case read shape IS correct: docs example shows top-level `plan_id`, `has_scheduled_changes: true`, `change_scheduled_at`, `current_end`, `short_url`). Re-pin tests to the documented behaviors (400-for-no-pending + entity-flag path), keep the pending-200 mapping test.

### 🚨 [BLOCKING-3] `portalUrl` echoes its input as a working card-update link — must fail closed
- **File**: `lib/billing/razorpay.ts:293-300`; input proven by `app/api/billing/portal/route.ts:42` (`portalUrl(plan.gateway_customer_id)`); hidden by `gateway-fake.ts:157-161` (fake ignores its argument) and `billing-gateway.test.ts` routing pins running under `LEKHAN_FAKE_PAYMENTS=1`
- **Issue**: Post-T8, a real INR owner clicking "update card" gets HTTP **200** with `{url: "cust_D00000000000006", kind: "card_update"}` — a guaranteed broken redirect. The rail currently validates only non-empty. Ownership split: the **root** fix (where the hosted `short_url` comes from — no schema column carries it today; docs prove fetched subscriptions *do* return `short_url`) is T5-route/T8/T12/lead-integration. The **rail-owned, blocking** part: refuse to fabricate.
- **Recommended fix (T7)**: validate the seam honestly and loudly:
  ```ts
  if (!/^https:\/\/\S+/.test(hostedPaymentPageUrl)) {
    throw new RazorpayConfigError("Razorpay card updates require a hosted payment-page (https) link; refusing to fabricate one.")
  }
  ```
  Add a test rejecting `"cust_..."`-style input next to the existing empty-string pin. Converts a silent broken redirect into a loud 502 (`portal_failed`) until the root source-of-truth lands. **Do not touch the route/schema** — root fix tracked as lead integration follow-up.

## 3. Non-blocking (fix in rework if cheap — reviewer-of-record recommends folding in to avoid a second loop)

- 💡 [MEDIUM] **No request timeout**: `razorpay.ts:150-154` — add `signal: AbortSignal.timeout(10_000)` to the default HTTP client (hung provider calls park route handlers).
- 💡 [MEDIUM] **`identifyPlan` first-env-match ambiguity** (`razorpay.ts:203-215`): if a FOUNDING and a GA key are misconfigured to the same plan id, insertion order decides and a founding subscription can be inferred GA — the exact PDEC-12 leak this rail exists to prevent. Collect all pattern-matching keys; refuse (`RazorpayConfigError`) on disagreement (same fail-closed as zero-match). Pin with a test.

## 4. Lead/T5/T8 integration escalations (NOT T7 blockers; tracked as epic follow-up)

1. **INR portal link source of truth** — decide: persist subscription `short_url` (schema/T8) vs. have the INR `portalUrl` seam resolve it via `GET /v1/subscriptions/:id` (docs confirm `short_url` present on fetch) with the route passing the subscription ref for the INR rail. Contract naming note: `gateway.ts:106` param `customerRef` contradicts PDEC-1 semantics — fix in T5-ownership at integration.
2. **PDEC-11 INR transfer window is inoperative at the rail layer** — docs confirm `cancel_at_cycle_end` is a *request* param, never echoed on GET. Rail's `live`-until-terminal is the only honest fail-closed answer (contract-compliant, `gateway.ts:82-97`), but `workspace_plans.cancel_at_period_end` cannot be populated from Razorpay read-back. T8 must record the cancel **action** at request time (its own POST succeeded) — reconcile transfer-window semantics at integration.
3. **T8 ref-persistence discipline**: `created → incomplete → inactive` means a persisted pre-auth subscription ref + a still-payable `short_url` could double-charge. Persist refs only from `subscription.authenticated`.
4. **Integration re-verify in a clean checkout** — the local main checkout has env drift unrelated to T7 (dirty working tree breaks `npm run build` prerender of `/about`; treat as user-WIP, do not "fix").
5. **T6 merge seam**: stripe registration must match the validated lazy-delegate shape; expect a one-region conflict on the factory tail (protocol rule 4, lead resolves).

## 5. Per-criterion falsification receipt (clean-room Q1–Q9, consolidated + independently spot-verified)

- **Q1 client-never-decides-price — PASS**: only server-derived values reach the provider body (`razorpay.ts:262-278`); Team+INR and non-INR rejected pre-env/pre-network (`:257-260`), pinned with `calls.length === 0` (`test:150-180`).
- **Q2 cohort lock — PASS w/ MEDIUM above**: `PLAN_KEY_PATTERN` mirrors `prices.ts` `razorpayEnvKey` exactly; zero-match refuses (fail-closed, pinned).
- **Q3 scheduled-change mapping — FAIL → BLOCKING-2**; pending-case read shape correct (docs-confirmed).
- **Q4 portal seam — FAIL (split ownership) → BLOCKING-3** + escalation 1.
- **Q5 cancel read-back — PASS** (fail-closed `live` is contract-compliant); escalation 2.
- **Q6 HTTP client security — PASS w/ MEDIUM**: lazy creds (`:146-147`, no eager read, pinned by zero-fetch test `:414-423`), `encodeURIComponent` pins paths, error descriptions never reach clients (generic 502s at all three routes), non-JSON 5xx → status preserved.
- **Q7 boundaries + shared-test refresh — PASS**: exactly 4 files; the `unregistered rail` rewrite preserves the no-silent-fallback property on the same code path; the 'routes USD→stripe' test registers in-test stubs (honest routing-logic pin; per-file vitest isolation verified).
- **Q8 registration eval-order — FAIL → BLOCKING-1** (empirically demonstrated on shipped code by reviewer of record).
- **Q9 test quality — strong, one defect**: exact bodies AND paths pinned; founding-vs-GA equality+inequality real; env save/restore correct; defects = the provider-impossible 200 pin (BLOCKING-2) and no permanent razorpay-first-import guard (BLOCKING-1 fix includes landing one).

**Single most likely production break**: once T8 populates `gateway_customer_id`, every real INR "update card" click returns a 200 whose `url` is a `cust_…` id — a guaranteed broken redirect no current test catches (fake ignores its argument; routing pins run under fake-payments).

## 6. Disposition

**REQUEST CHANGES** → returned to Dev Engineer (`fd5a904a`) on this issue with BLOCKING-1/2/3 + recommended MEDIUMs; re-review by Tech Lead on the new head before `done`. Epic-level escalations recorded here and as a follow-up integration issue under SIL-32 (blocked by SIL-42 + SIL-43). The reviewed branch head remains `d675f09`; worktree verified clean after review probes.
