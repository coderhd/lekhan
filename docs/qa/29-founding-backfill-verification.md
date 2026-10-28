# T14 verification record — founding backfill + full gate (SIL-139)

- **Epic:** [SIL-32](/SIL/issues/SIL-32) / coderhd/lekhan#29 H0 Real Billing
- **Plan:** `docs/superpowers/plans/2026-10-07-h0-real-billing.md` (rev 3) → Phase 5 / T14
- **Spec:** `docs/superpowers/specs/29-spec.md` rev 2 (§4.4, §9, §14, §15)
- **Branch:** `plan/29-real-billing`
- **Date:** 2026-10-28

This document is the evidence record for T14. It separates **what is proven** from **what is
still gated**, because T14's BUILD-complete bar includes provider-side execution that cannot be
substituted with docs.

## 1. Full suite — PASS

Run on the epic branch tip (`5895180`, plus the harness/doc files added by this ticket):

```
$ npm run typecheck   # tsc --noEmit                       → exit 0
$ npm run lint        # eslint .                            → exit 0
$ npm test            # vitest run                          → 99 files / 867 tests passed
$ npm run build       # next build (Turbopack)              → exit 0, 32 static pages
```

Billing routes present in the build output: `/api/billing/{checkout,portal,cancel,transfer,
summary,currency,plan-change}`, `/api/billing/webhooks/{stripe,razorpay}`,
`/api/cron/{billing-reconcile,retention-prune}`.

## 2. Founding backfill migration — semantics proven locally

Migration: `supabase/migrations/20261008000000_founding_roster_backfill.sql`
Harness: `scripts/verify-founding-backfill.sh` (disposable `postgres:16-alpine`, stub
`workspaces` / `workspace_plans` / `waitlist` / `referral_attribution` tables — never a real DB).

```
$ ./scripts/verify-founding-backfill.sh
== run 1 ==
NOTICE:  founding_roster_backfill: marked 3 workspace_plans row(s) founding.
== run 2 (idempotency) ==
NOTICE:  founding_roster_backfill: marked 0 workspace_plans row(s) founding.
== run 3 (waitlist DDL absent — PDEC-6) ==
NOTICE:  founding_roster_backfill: public.waitlist is absent on this environment; skipping (PDEC-6 out-of-band DDL).
PASS: predicate pinned, false->true only, idempotent on re-run, safe when waitlist is absent.
```

Fixtures exercise the boundary cases that matter:

| Fixture | Expectation | Result |
|---|---|---|
| spot 5, attributed, has plan | `is_founding` false → true | ✅ flipped |
| spot 500 (roster edge), attributed | false → true | ✅ flipped |
| spot 77, attributed, waitlist email `F@Example.COM` | matched via `md5(lower(email))` | ✅ flipped |
| spot 501, attributed | untouched | ✅ still false |
| spot 250, **no** `referral_attribution` row (`?ref`-less founder) | untouched (known boundary) | ✅ still false |
| attributed founder whose workspace has **no** plan row | no error, nothing written | ✅ skipped |
| row already `is_founding = true` | not re-written; `updated_at` unchanged | ✅ untouched |
| second run | 0 rows updated, byte-identical dump | ✅ idempotent |
| `waitlist` absent | NOTICE, no error, no writes | ✅ skips |

## 3. Target environment — not applied (blocked)

Read-only probes against the connected Supabase project
(`https://hftipkzqbltdkrcjynad.supabase.co`, service key) on 2026-10-28:

| Probe | Result |
|---|---|
| `GET /rest/v1/waitlist?select=*&limit=1` | **200**, `[]`; `content-range: */0` → waitlist exists, **0 rows** |
| `GET /rest/v1/workspace_plans` | **404** `PGRST205` — table absent |
| `GET /rest/v1/referral_attribution` | **404** `PGRST205` — table absent |
| `GET /rest/v1/gateway_events` | **404** `PGRST205` — table absent |
| `GET /rest/v1/workspaces` | **200** |

Two consequences:

1. **The T3 base migration is not applied to this environment.** The backfill cannot run: it
   updates `public.workspace_plans` and joins `public.referral_attribution`, both of which are
   created by `20261007000000_billing_workspace_plans.sql` (still only on the epic branch — the
   billing migrations are not on `origin/main`; `main` carries only
   `20261007000000_resolve_unresolved_page_links.sql` and `20261007000001_import_batches_ledger.sql`).
2. **There is nothing to backfill here yet.** The waitlist on the connected project is empty, so
   even after the schema lands this environment's apply is a 0-row no-op. The meaningful apply
   belongs to whichever environment carries real waitlist rows.

Applying the epic-branch DDL to the hosted project ahead of the SHIP merge — including the
`workspaces` INSERT trigger that grants referral credits and the `handle_new_user` companion
trigger — is a deploy/ordering decision for DevOps + TL, not something this ticket should do
unilaterally. Tracked as a named blocker (see §5).

## 4. Manual QA — not executed (no provider access, no staging)

`docs/qa/29-billing-manual-qa.md` is the script. It cannot be executed in this run:

- No `STRIPE_*`, `RAZORPAY_*`, `CRON_SECRET`, or `BILLING_TRANSFER_TOKEN_SECRET` values exist in
  `.env.local`, `.env`, or the agent secret store (`GET /api/agents/me/secrets` → `[]`). T1's
  dashboard checklist ([SIL-37](/SIL/issues/SIL-37)) is still unchecked for price objects, webhook
  endpoints, and Billing Portal subscription updates.
- There is no deployed staging origin to point the providers at; `NEXT_PUBLIC_APP_URL` is a local
  value, and the hosted backend lacks the billing schema (§3), so even the `LEKHAN_FAKE_PAYMENTS=1`
  walkthrough (§1 of the script) would fail on the first `/api/billing/summary` call against this
  backend.

Per spec §9/§14 this provider-side pass **gates BUILD-complete**. It is not replaced by the green
suite above.

## 5. Open decision — founding-roster predicate (TL/PO ruling required)

Pinned predicate (unchanged by this ticket):
`waitlist.position <= 500` ∩ `referral_attribution.email_hash = md5(lower(waitlist.email))`,
`is_founding` flipped `false → true` only.

Two boundary questions need a ruling before this is applied anywhere with real rows:

1. **`?ref`-less founders are never matched.** A founder who joined the waitlist but signed up
   without a referral link has no `referral_attribution` row, so the join misses them and they
   silently lose founding pricing. The migration does **not** widen to `profiles.email` (that
   would mark accounts that never joined the waitlist). Recommendation: keep the narrow predicate
   and add a **one-time manual reconciliation** of the unmatched count printed by the query in the
   migration comments, rather than widening the automated match.
2. **Multi-workspace founders.** `is_founding` lives on `workspace_plans`, so a founder who owns
   several workspaces gets founding pricing on **all** of them. The spec's roster language is
   owner-centric; if founding pricing is meant to be one-per-founder, the backfill needs a
   "first/personal workspace only" restriction. Recommendation: confirm with the founding-cohort
   launch owner whether multi-workspace founding pricing is acceptable; if not, the fix is one
   `DISTINCT ON (ws.owner_id)` clause, not a predicate widening.

Both are recorded on the dispatch issue as a blocked decision for the Tech Lead.

## 6. Reproduce

```bash
# full gate
npm run typecheck && npm run lint && npm test && npm run build

# backfill semantics + idempotency (needs docker; disposable container)
./scripts/verify-founding-backfill.sh

# target-environment probes (read-only)
set -a && . ./.env.local && set +a
for t in waitlist workspace_plans referral_attribution gateway_events workspaces; do
  curl -s -o /dev/null -w "$t %{http_code}\n" \
    -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
    "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/$t?select=*&limit=1"
done
```
