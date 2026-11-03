# Clean-room review — SIL-139 / T14 (#29 real billing, Phase 5)

- **Reviewer:** independent clean-room subagent (read-only, fresh context) — findings transcribed and dispositioned by the T14 owner
- **Date:** 2026-10-28
- **Material under review:** `supabase/migrations/20261008000000_founding_roster_backfill.sql`,
  `scripts/verify-founding-backfill.sh`, `docs/qa/29-billing-manual-qa.md`
- **Ground truth:** spec §4.4/§9/§14/§15, plan PDEC-6/PDEC-9/PDEC-11/PDEC-12, the T3 schema
  migrations, and the waitlist DDL snapshot.
- **Verdict at first pass:** **CHANGES-REQUIRED** (2 blocking, 7 major, 5 minor, 1 nit)

## Findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | blocking | The backfill flipped `is_founding` on matched rows regardless of subscription state — retro-pricing a founder who had already bought at GA, contradicting spec §15's "persisted once, at subscription creation". The header's "later roster drift cannot re-price anyone" claim was false. | **Fixed.** `UPDATE` now requires `status = 'none' AND gateway_subscription_id IS NULL`; a `NOTICE` reports matched-but-locked rows; comment rewritten to state the invariant truthfully. Harness adds active **and** canceled ex-subscriber fixtures that must stay `false`. |
| 2 | blocking | QA §1 claimed checkout/cancel/resubscribe on the fake rail, but `createCheckout()` is in-memory only (`#fake-checkout`) and never writes `workspace_plans`, so `cancel` would return `no_subscription`. | **Fixed.** §1 is now an explicit *rendering* pass over seeded `workspace_plans` states; lifecycle moved to §2/§3 (real test-mode subscriptions). The fake rail's limits are stated up front. |
| 3 | blocking | QA §5 required "a collaborator without a workspace", but `workspaces.owner_id` is UNIQUE and `initiateOwnershipTransfer` rejects a successor who owns one (`409 successor_owns_workspace`). | **Fixed.** §5 gives two executable paths: disposable-DB fixture (delete the successor's empty workspace) or assert the 409 path as the covered case. Cascade risk called out. |
| 4 | major | `stripe trigger invoice.paid` / `invoice.payment_failed` produce synthetic events with no workspace binding; the read-back processor ignores them, so referral settlement and grace would silently not run. | **Fixed.** §2 uses a Stripe test clock against the real test subscription so genuine invoice events fire. |
| 5 | major | `stripe listen` prints `whsec_…`; telling testers to paste terminal output into an issue is a secret leak. | **Fixed.** Evidence rules now forbid capturing `whsec_…`/`sk_test_…`/Razorpay keys, with a concrete command hint. |
| 6 | major | Predicate omits `confirmed_at`, while the waitlist snapshot defines the cohort as `position` **plus** double opt-in — an ambiguity that changes real rows. | **Escalated, not guessed.** Spec §4.4/PDEC-6 pin `position <= 500` only; the migration follows the spec and says so in its header. Raised as question 3 to the Tech Lead. |
| 7 | major | QA omitted spec §14 criteria it claims to gate: annual 2-months-free, founding-ID isolation, referral cap/application, zero-card-data/PII, doc-cap removal, tenant isolation. | **Fixed.** New §7 cross-check with checkboxes for each; §2 adds the GA-vs-founding price-ID check and annual amount check. |
| 8 | major | Harness overstated its PASS text; stub used `text` not `citext`; no active-subscription, no `referral_attribution`-absent, no already-true non-roster fixture. | **Fixed.** Stub is real `citext`; fixtures added; PASS text now enumerates exactly what the fixtures assert. |
| 9 | major | "Replay a signed fixture" had no signing procedure — a wrong canonicalization looks like a false 400. | **Fixed.** §3 carries the exact `node -e` HMAC-SHA256-over-raw-bytes command with `x-razorpay-signature`. |
| 10 | minor | Only `waitlist` was guarded; `referral_attribution` absent aborts; and "re-run on the target environment" is not something migration tooling does. | **Fixed.** Second `to_regclass` guard + notice, harness run 4, and the header documents the manual re-run requirement explicitly. |
| 11 | minor | `referral_attribution.email_hash` has no unique constraint; `DISTINCT ra.user_id` assumes one row per hash. | **Accepted as-is (documented).** `auth.users` email uniqueness makes duplicates unreachable in practice; changing the schema is a T3 concern, not a T14 edit. Noted for the T3 follow-up surface. |
| 12 | minor | Verification query hides founders with no `workspace_plans` row; migration emitted no notice for them. | **Fixed.** Notice reports the count; verification query 4 added. Rows are still not created (T3's backfill owns creation; inventing rows would mask a partial apply). |
| 13 | minor | Missed-webhook drill ignores `last_checked_at` freshness — the cron can return `skipped-fresh`. | **Fixed.** §4 resets the watermark with the exact SQL and explains why. |
| 14 | minor | Preconditions provided only one workspace; founding/GA badge and referral-card checks need two owners + a ledger row. | **Fixed.** §0 lists fixtures F/G/C/S and the two seed statements. |
| 15 | nit | Unpinned `postgres:16-alpine`, container only removed by the EXIT trap. | **Fixed.** Pinned to `postgres:16.15-alpine` and `docker run --rm`. |

## What the review confirms is genuinely proven

- The predicate is exactly `waitlist.position <= 500` joined through
  `referral_attribution.email_hash = md5(lower(email))`, with a `false`-only guard; `NULL` hashes
  never match.
- `is_founding` is never written back to `false`, and (after fix 1) never written on a row that
  has ever subscribed.
- `workspaces.owner_id` is UNIQUE, so one founder cannot fan out across workspaces.
- The harness cannot reach a non-disposable database: own named container, no host port, no
  volume, no mount.
- Every route path in the QA script exists on this branch (`app/api/billing/*`, both webhook
  routes, both cron routes), `vercel.json` schedules both crons, and the UI strings/controls it
  names exist.

## What remains unproven (and why that is honest)

- Anything provider-side: no test credentials or staging origin exist, so no webhook delivery,
  portal round-trip, renewal, or dashboard verification has been executed.
- The migration's behaviour against the **real** `workspace_plans`/`citext` schema in a hosted
  environment — the harness uses faithful stubs; the hosted apply is delegated (see the T14
  blocked-by issues).
- The predicate boundaries themselves (`?ref`-less, multi-workspace, unconfirmed) pending the
  Tech Lead ruling.
