# 0005 — Founding-roster predicate boundaries: `?ref`-less founders and multi-workspace founders

Date: 2026-10-28
Status: Accepted (binding ruling — SIL-141, Tech Lead arbitration per spec §16 precedent)

## Context

The founding-roster backfill (`supabase/migrations/20261008000000_founding_roster_backfill.sql`, T14)
is landed and proven locally (`npm run verify:founding-backfill`, evidence in
`docs/qa/29-founding-backfill-verification.md`). Its predicate is the one pinned by PDEC-6 and
spec §4.4:

```sql
waitlist."position" <= 500
  JOIN referral_attribution ra ON ra.email_hash = md5(lower(waitlist.email))
  UPDATE workspace_plans SET is_founding = true  -- false → true only
```

Before [SIL-140](/SIL/issues/SIL-140) applies it to an environment carrying the real cohort, the
boundary questions raised in the migration header need a binding ruling. None change the
predicate's shape; all change who ends up founding: Q1 (`?ref`-less founders), Q2
(multi-workspace founders), and Q3 (`confirmed_at` — whether unconfirmed waitlist rows count).

Facts that constrain both answers:

- `waitlist.email` is unverified at join time. Brevo double opt-in (`confirm_waitlist`) proves
  deliverability of a marketing email, not ownership of a Supabase auth identity
  (`docs/superpowers/specs/29-waitlist-ddl-snapshot.md`).
- `referral_attribution` is written by the signup companion trigger **only when the signup carries
  `referred_by`** (PDEC-5). It is the only waitlist→account bridge with signup-time provenance.
- `is_founding` is consumed from the persisted `workspace_plans` row only
  (`app/api/billing/checkout/route.ts:111`, `lib/billing/prices.ts` `assertFoundingEligible`), is
  persisted once at subscription creation and never re-derived (spec §15), and the backfill only
  ever flips `false → true`. A wrong grant becomes permanent the moment that workspace subscribes.
- The spot (`waitlist.position`) is allocated at join and counted toward the 500 cap regardless of
  confirmation (`services/waitlist.ts`, `join_waitlist` allocates unconditionally).

## Decision

### Q1 — founders who signed up without `?ref`: **Option A (narrow predicate + mandatory manual reconciliation). Confirmed.**

The backfill predicate stays exactly as landed; no `profiles.email` / `auth.users.email` fallback
is ever added to it. The `?ref`-less founder gap is owned by an explicit, mandatory reconciliation
step — not left to chance, and not automated into the migration.

Why not B (email fallback join):

1. **The waitlist email is unverified third-party input.** An automated email match would pin a
   lifetime price lock onto an account based on whatever someone typed into `/early` — a typo'd or
   malicious waitlist entry grants founding pricing to an account whose owner never joined the
   waitlist. That is predicate drift with a monetary blast radius, and the `false → true` +
   lock-at-subscription semantics make the mistake irreversible once the workspace subscribes.
2. **The attribution row is the only signal with signup-time provenance.** It proves the signup
   event carried the waitlist campaign's referral code end-to-end. An email string match alone
   cannot establish that the account owner is the person who joined the waitlist; automation has no
   way to add that scrutiny, a human reviewer does. That is exactly why the gap goes to a reviewed
   manual pass instead of a wider predicate.
3. **The unmatched set is small, enumerable, and auditable.** The migration already ships the
   count/list queries for it.

Pinned reconciliation mechanics (mandatory step in the [SIL-140](/SIL/issues/SIL-140) apply
runbook; re-runnable, idempotent):

- **Candidate set:** `waitlist` rows with `"position" <= 500` and no `referral_attribution` match
  (migration header query 3 gives the count; the same shape with `w.email` selected gives the list).
- **Grant criteria, reviewed per candidate:** grant only when `lower(waitlist.email)` matches
  **exactly one** `auth.users` email **and** that user owns at least one workspace whose
  `workspace_plans` row is still unlocked (`status = 'none'` AND `gateway_subscription_id IS NULL`
  — the same guards the migration uses). Flip `false → true` via service-role SQL only. Candidates
  with no account yet (they may still sign up) or any ambiguity stay unmatched and are logged.
- **Re-runs:** the backfill and this reconciliation are both idempotent; re-run before cohort
  closure so founders who signed up after the apply (with or without `?ref`) are covered — with
  `?ref` the backfill catches them, without it this pass does.
- **Evidence:** the reviewed list and the applied updates are recorded in a QA evidence doc next to
  `docs/qa/29-founding-backfill-verification.md`. The cohort stays auditable end to end.

Also pinned (pre-empting the third boundary dispute): the roster predicate deliberately does
**not** include `confirmed_at IS NOT NULL`. The spot is allocated and counted at join; confirmation
is a deliverability gate, not a cohort gate. Unconfirmed spots ≤ 500 are cohort members.

### Q2 — founders who own more than one workspace: **Option A. Ruled: founding pricing follows the founder, per workspace.**

The spot is a person's. Every workspace owned by a founding-cohort member is eligible for founding
pricing — the ones that exist at backfill time (the backfill already marks all of them; unchanged)
and any created later.

- **T6/T7 need no change.** They persist `is_founding` from the workspace's `workspace_plans` row,
  which is exactly correct once that row is authoritative under the follows-the-founder rule.
- **New-workspace inheritance is required to make A true as a rule, not an accident of backfill
  timing.** Today `handle_workspace_created_billing()` inserts the new workspace's
  `workspace_plans` row with `is_founding` defaulting to `false`, and nothing re-derives it later
  — a founding owner's post-backfill workspace would silently resolve GA prices forever. This is
  closed by a small follow-up migration (tracked on [SIL-141](/SIL/issues/SIL-141) as its child
  implementation task): extend the workspaces-insert path so a new plan row inherits
  `is_founding = true` when the owner already owns a workspace with `is_founding = true`
  (owner-level inheritance referencing **only billing tables** — no waitlist coupling, PDEC-6
  clean), plus a one-shot idempotent catch-up `UPDATE` for rows created before the trigger lands.
  Same lock guards: only `status = 'none'` AND `gateway_subscription_id IS NULL` rows are touched.
- **Why not B (one-per-founder):**
  1. "First workspace" is not a durable designation. `DISTINCT ON (ws.owner_id) ORDER BY
     ws.created_at` picks the earliest-created workspace at apply time — which may be a team
     workspace the founder considers secondary; deleting it orphans the founder's slot with no
     re-derivation path (spec §15 lock); transferring it hands founding pricing to a **non-cohort**
     owner — actual cohort leakage, the exact risk §15's mitigation guards against.
  2. B forces a migration change plus owner-level guards in T6/T7 payment paths to save discount
     dollars bounded by ≤ 500 people, while A's "excess" is generosity to the cohort itself and B's
     failure mode is a broken promise / permanently lost founder slot.
  3. The spec's roster language is owner-centric ("the `join_waitlist` founding cohort … matched to
     accounts at signup"); nothing pins one-per-founder.
- **Erosion bound under A:** founding pricing can only ever attach to workspaces **owned by** one
  of the ≤ 500 cohort members. Inheritance requires an existing founding workspace owned by the
  same owner; checkout requires the persisted flag. No non-cohort account can self-grant.

**Ownership-transfer guardrail (pins the US-8 / PDEC-11 surface):** when workspace ownership
transfer ships, `is_founding` re-evaluates from the **new** owner's roster status — inherit if the
new owner is founding, clear if not — for unlocked workspaces. A workspace already locked with a
live founding subscription keeps its locked price with the subscription (the gateway object carries
`is_founding`); US-8's plan must state this explicitly.

## Consequences

- The predicate is frozen as landed; [SIL-140](/SIL/issues/SIL-140) is unblocked. Its runbook gains
  the mandatory reconciliation step above and should apply the inheritance migration in the same
  chain (the catch-up makes ordering safe).
- Follow-up implemented: `supabase/migrations/20261008000001_founding_follows_owner.sql`
  (inheritance trigger + one-shot catch-up), proven by `npm run verify:founding-follows-owner`
  (`scripts/verify-founding-follows-owner.sh`).
- Recorded as PDEC-13 in `docs/superpowers/plans/2026-10-07-h0-real-billing.md`; spec §4.4 points
  here; the backfill migration's boundary comment references this ADR.

## Evidence

- `supabase/migrations/20261008000000_founding_roster_backfill.sql` (predicate, guards, comments)
- `docs/superpowers/specs/29-waitlist-ddl-snapshot.md` (unverified emails, spot semantics, no
  cohort table)
- `docs/superpowers/specs/29-spec.md` §4.4, §15 (roster definition, lock-at-creation mitigation)
- `docs/superpowers/plans/2026-10-07-h0-real-billing.md` PDEC-5/PDEC-6, T6/T7/T14
- `app/api/billing/checkout/route.ts:111`, `lib/billing/prices.ts` (persisted-flag-only consumption)
- `docs/qa/29-founding-backfill-verification.md` (backfill semantics proven locally)
