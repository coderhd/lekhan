# SIL-140 evidence — #29 billing chain applied to hosted staging

- **Ruling:** [SIL-142](/SIL/issues/SIL-142) — apply pre-merge now (Option A), PDEC-14, `docs/ops/provisioning/29-billing-apply-ordering.md`
- **Predicate ruling:** [SIL-141](/SIL/issues/SIL-141) — ADR 0005 / PDEC-13
- **Target:** project `hftipkzqbltdkrcjynad` (staging)
- **Branch:** `plan/29-real-billing`
- **Applied by:** DevOps Engineer, 2026-10-28

## 1. Pre-apply state (read-only)

| Object | State |
|---|---|
| `public.waitlist` | present, **0 rows** (out-of-band DDL, PDEC-6) |
| `public.workspaces` | 10 rows |
| `workspace_plans`, `referral_attribution`, `referral_credit_ledger`, `gateway_events`, `plan_tiers` | absent |
| `supabase_migrations.schema_migrations` | 32 rows; max version `20261007110845` |

The earlier QA record ([29-founding-backfill-verification.md](29-founding-backfill-verification.md) §3) said the waitlist was absent. It is present and empty on this project. The founding backfill therefore ran against an empty roster.

## 2. Why the apply was done by hand, not by `supabase db push`

`supabase db push --dry-run` (CLI v2.120.0) refused to run:

```
DbPushMissingLocalError: Remote migration versions not found in local migrations directory.
```

The remote history contains versions with no local file, including `20261007000001` (`import_batches_ledger`) and `20261007110845` (`sync_hardening_ledger_missing_table_apply`), plus the 2026-08 waitlist and RLS versions. The CLI's suggested fix is `supabase migration repair`, which rewrites the history table for every listed version. That was not done: it would alter 30+ rows that this ticket does not own.

Instead, the four chain files were applied in filename order inside **one transaction** (`BEGIN … COMMIT`, rollback on any error), and only the four chain versions were inserted into `supabase_migrations.schema_migrations`. The transaction committed on the first attempt.

## 3. Apply log (migration NOTICEs)

```
policy/trigger "... does not exist, skipping"   — DROP ... IF EXISTS on first creation (expected)
founding_roster_backfill: marked 0 workspace_plans row(s) founding; 0 matched row(s) left locked (already subscribed); 0 founder account(s) have no workspace_plans row.
founding_follows_owner: inherited founding onto 0 workspace(s) whose owner already has a founding workspace.
```

Chain applied: `20261007000000`, `20261007120000`, `20261008000000`, `20261008000001`.

## 4. Post-apply verification (read-only)

| Check | Expected | Result |
|---|---|---|
| plan rows vs workspaces | one per workspace | `workspace_plans` = **10**, `workspaces` = 10 |
| workspaces without a plan row | 0 | **0** |
| `plan_tiers` seeded | 4 | **4** |
| founding plan rows | 0 (empty waitlist) | **0** |
| triggers present | 3 | `on_workspace_created_billing` (workspaces), `on_workspace_plan_created_founding_inherit` (workspace_plans), `on_auth_user_created_referral_attribution` (auth.users) — all **present** |
| chain versions in history | 4 | all four recorded |

Founding backfill **0 matched** is the expected result for an empty waitlist, not a failure.

## 5. Freeze pin

From this apply, the four files are immutable on this environment. Any follow-up goes in a new migration version.

## 6. Caveats and follow-ups

1. **This is not real-cohort evidence.** The waitlist is empty, so the founding predicate was never exercised against real spots. The production environment must repeat the chain and run the mandatory ADR 0005 Q1 reconciliation (exact `lower(email)` match → single auth user → unlocked plan rows) when it is provisioned.
2. **Migration history drift (DevOps follow-up).** `supabase db push` is blocked on this project until the repo and the remote history agree. Remote has `20261007000001` and `20261007110845` with no matching local file, and the local `20260827220000_sync_hardening_ledger.sql` has no matching remote version name. Needs a decision on whether to repair the history table or add the missing files; not done here.
3. Waitlist DDL remains out-of-band (PDEC-6) and is present on this project as noted above.
