# Clean-Room Review — #29 T8 Webhook Processor (both rails) + tests

- **Scope**: commit `25fe13e` — `services/billing/webhook-processor.ts`, thin routes `app/api/billing/webhooks/{stripe,razorpay}/route.ts`, test suites `tests/unit/billing-webhooks-{core,stripe,razorpay}.test.ts` + testkit + `tests/fixtures/billing/*` (SIL-97, plan task T8, epic #29 H0 Real Billing).
- **Method**: fresh-context adversarial subagent (not an author of the code). Read all changed files at the commit plus authority docs (plan T8 text; spec §6/§13/§14/§15; T3 migration; frozen contract files), ran the three focused suites (49/49 green), and mutation-tested the implementation four ways (all mutations reverted; two mutations confirmed the suite catches real regressions: "always duplicate" and "terminal keeps read-back tier").
- **Verdict**: **APPROVE** — zero blocking findings. Four valid non-blocking findings were fixed in the follow-up commit on the same branch; the suite grew to 52 tests.

## Axis results

1. **Spec & AC — PASS.** Hard order implemented exactly (verify → raw record → read-back → apply+mirror → referral hooks → unknown no-op) and every plan Review-Focus pin is genuinely tested. "Canceling" is encoded as `status='active' + cancel_at_period_end=true` — the only schema-valid encoding (the status CHECK has no 'canceling' value; matches PDEC-11). `past_due_since` is keyed to the read-back's past_due transition (set once, never reset while past_due, cleared on recovery/terminal) — payload-independent, D9-correct. Founding: provider metadata/notes is the record, price cohort only the fallback; terminal cancel never touches `is_founding`. Mirror output space is exactly {free, plus, pro, team} — `go`/`enterprise` unreachable.
2. **Frontend & a11y — PASS (N/A).** No UI files touched.
3. **Storage/state machine — PASS.** Insert is the idempotency gate; concurrent duplicates both fall into the repair path and every apply is idempotent (read-back-driven upsert; T9 hooks dedup-safe; `credited_months` never touched by the processor). Crash after raw-record leaves the row recorded/unprocessed; every later failure returns 502 with `processed_at` NULL so redelivery repairs. No request-reachable path can write another workspace's row (binding comes from provider-held metadata set only at checkout, or from our own stored binding).
4. **Backend security & errors — PASS.** Both rails fail closed (tampered/missing/wrong-secret ⇒ 400 with zero rows; missing secret ⇒ 500 `webhook_config`, never process). Razorpay HMAC timing-safe with a length pre-check; signature checked before any JSON parse. Payload-as-pointer discipline grep-verified: payload content reaches only the audit row and the pointer-id extraction. Response bodies are constant strings; detail is server-log only. Fixtures contain no secrets; all writes service-role.

## Findings → fixes (same branch, follow-up commit)

| # | Finding | Severity | Fix |
|---|---|---|---|
| N-3 | Stripe verify-failure logged the whole SDK error — `StripeSignatureVerificationError` embeds the raw unverified payload + signature header ⇒ PII into server logs (violates spec §14 and the file's own header) | should-fix | Log `err.message` only (`webhook-processor.ts`, stripe entry); Razorpay path already logged a constant string |
| N-1 | No subscription-generation guard: a stale terminal event for a PREVIOUS subscription (cancel → resubscribe) could transiently downgrade the live binding to free/canceled (fail-safe direction, self-healing via T10 — but cheap to prevent) | should-fix | Stale-generation guard in `applyAndFinish`: terminal read-back whose `subscriptionRef` differs from the stored LIVE binding is marked processed without downgrading (non-terminal + same-ref applies unaffected; rail-switch detaching flow preserved). Pinned by a new core test |
| N-4 | Wrong-length Razorpay signature path unpinned (mutation: removing the length pre-check left the suite green — the path would 500 instead of 400) | test gap | New razorpay test: valid-hex short signature ⇒ 400 + no row |
| N-2 | Gone-deletion fallback synthesized `customerRef: null`, erasing `gateway_customer_id` on terminal-cancel-by-fallback (resubscribe would create a new provider customer, US-6 AC2 friction) | nice-to-have | Fallback reads the stored binding row and preserves `gateway_customer_id` (pinned by a new core test) |
| N-5 | Informational, deferred: `X-Razorpay-Event-Id` is unsigned (rotated-header replays bypass event dedup — apply stays idempotent, hooks dedup-safe); routes don't bound body size before `request.text()` (platform limits apply); `gateway_events.event_id` unique across rails (signature-gated, not attacker-reachable) | deferred | Documented here; revisit with the T10 reconciliation slice |

## Post-fix verification

`npm run typecheck` ✓ · `npm run lint` ✓ · 52/52 webhook tests ✓ · full suite 752/752 ✓ · `npm run build` ✓
