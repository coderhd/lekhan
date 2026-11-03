# #29 billing schema — apply ordering (SIL-142 ruling)

> **Ruling (binding, 2026-10-28, Tech Lead):** apply the #29 billing migration chain to the
> hosted project **pre-merge, now** — Option A — overriding the SIL-142 recommendation of B.
> Applies to project `hftipkzqbltdkrcjynad` (staging) and, by the same rule, to the
> cohort-carrying production environment when it is provisioned.
> Requesting issue: [SIL-142](/SIL/issues/SIL-142) · Apply issue: [SIL-140](/SIL/issues/SIL-140).

## Scope

The four repo migrations, in filename order:

1. `20261007000000_billing_workspace_plans.sql` (schema, triggers, legacy plan backfill)
2. `20261007120000_referral_credit_claim_semantics.sql` (claim-semantics revision)
3. `20261008000000_founding_roster_backfill.sql` (roster predicate, ADR 0005 Q1/Q3)
4. `20261008000001_founding_follows_owner.sql` (founder-follows inheritance, ADR 0005 Q2)

The waitlist DDL is **out of scope** (PDEC-6 out-of-band; its own provisioning concern).

## Why A (pre-merge) beats B (apply at SHIP)

1. **The "triggers write before readers exist" premise is factually moot.** `origin/main`'s
   signup page passes no `referred_by` (verified: `git show origin/main:app/signup/page.tsx`
   has no referral capture) and no ledger writers exist on `main`. The T3 triggers are inert
   until the branch's code deploys at merge — so under A the schema and the readers still
   effectively go live together.
2. **Zero-loss referral provenance.** The branch's signup page (the first code that can feed
   `referral_attribution`) deploys at merge. Under A the attribution trigger is already live at
   that moment; under B any signup landing in the deploy→apply window loses its attribution
   permanently — and attribution is the founding reconciliation's provenance bridge
   (ADR 0005 Q1).
3. **No missing-table window at merge.** Vercel auto-deploys the merged app (which reads
   `workspace_plans`) before a manual DB apply would land; under A the tables already exist.
4. **Real rehearsal on real data.** T3's plan-row backfill materializes one `workspace_plans`
   row per existing workspace (legacy tier normalization) — provable on the staging project
   now instead of under merge pressure. The founding backfill is expected to report **0
   matched** there (the waitlist is empty) — that is the recorded expectation, not a failure.

## Pins (conditions of this ruling)

- **Freeze:** from the apply moment, the four migration files are immutable on that
  environment. Any post-apply change lands as a new versioned migration — never an edit of an
  applied file.
- **SIL-140 proceeds immediately** under this ruling; evidence = migration NOTICEs + the
  read-only verification queries from each migration header + a QA doc entry, including the
  count of materialized plan rows (expected: one per existing workspace).
- **Caveat on T14 evidence:** an apply against the empty-waitlist staging project proves the
  chain and the legacy backfill, **not** the founding roster against real spots. When the
  cohort-carrying production environment is provisioned, repeat the same chain there and run
  the mandatory reconciliation step (ADR 0005 Q1) — only that run is the real-cohort evidence.
