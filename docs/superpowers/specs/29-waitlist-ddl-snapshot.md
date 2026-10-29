# Waitlist DDL Snapshot (PDEC-6 / T1)

> **Status:** captured for [SIL-37](/SIL/issues/SIL-37) (BUILD T1) · **Ticket:** [coderhd/lekhan#29](/SIL/issues/SIL-32) parent
> **Source of truth:** the connected Supabase project (live Postgres), not this repo.
> **Consumed by:** T14 founding-roster backfill migration `20261008000000_founding_roster_backfill.sql` (plan §T14, PDEC-6).

## Why this snapshot exists

The waitlist table and RPCs are **out-of-band**: the DDL was applied directly to the connected
database and **zero of it lives in `supabase/migrations/`**. Verified two ways:

1. `grep -rin "waitlist\|join_waitlist\|referral_attribution\|spot" supabase/migrations/` → **no matches**.
2. `list_migrations` on the connected project shows six waitlist migrations whose SQL is absent
   from the repo:
   - `20260824132136_waitlist_founding_cohort`
   - `20260824132244_waitlist_race_safety`
   - `20260824132356_waitlist_rpc_returns_id`
   - `20260824133427_waitlist_stats_fn`
   - `20260824164135_waitlist_self_confirmation`
   - `20260824164246_waitlist_token_schema_fix`

The base billing migration (`20261007000000_billing_workspace_plans.sql`, T3) must reference **no
waitlist objects** (PDEC-6). The roster backfill that does touch the waitlist ships separately in
T14 only after this snapshot is verified.

## Capture method

Read-only introspection via the Supabase SQL inspector against the connected project
(`https://hftipkzqbltdkrcjynad.supabase.co`) on 2026-10-07. Objects were read with
`information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_policies`, `pg_trigger`,
`pg_attribute`/`pg_attrdef`, `pg_get_functiondef`, and `information_schema.role_*_grants`.
Reproduction queries are in the appendix. **DDL only — no row data is reproduced here.**

## Object inventory (public schema, waitlist domain)

| Object | Kind | In repo migrations? |
|---|---|---|
| `public.waitlist` | table | no |
| `public.waitlist_id_seq` | identity sequence (owned by `waitlist.id`) | no |
| `public.waitlist_position_seq` | sequence (allocates `spot`) | no |
| `public.join_waitlist(text,text,text,text)` | RPC | no |
| `public.confirm_waitlist(text)` | RPC | no |
| `public.waitlist_stats()` | RPC | no |
| `public.brevo_outbox` | table (FK → `waitlist.id`) | no |

> **There is no separate "cohort" table.** Cohort membership is derived from `waitlist.position`
> (the numbered *spot*) plus `confirmed_at`. `referral_attribution` does **not** exist yet on this
> project; it is created by T3's migration. See "Gaps / T14 fetch points".

## `public.waitlist`

### Reconstructed DDL

```sql
create table public.waitlist (
  id            bigint generated always as identity
                  constraint waitlist_pkey primary key,
  email         citext        not null
                  constraint waitlist_email_key unique,
  referred_by   text,
  utm_source    text,
  use_case      text,
  "position"    integer       not null
                  constraint waitlist_position_key unique,
  created_at    timestamptz   not null default now(),
  confirm_token text,
  confirmed_at  timestamptz
);

-- confirm_token is unique only when present (partial unique index).
create unique index waitlist_confirm_token_key
  on public.waitlist (confirm_token)
  where confirm_token is not null;
```

### Columns (live)

| Column | Type | Null | Default / identity | Notes |
|---|---|---|---|---|
| `id` | `bigint` | NO | `GENERATED ALWAYS AS IDENTITY` (`waitlist_id_seq`) | surrogate id, not the spot |
| `email` | `citext` | NO | — | case-insensitive dedup key |
| `referred_by` | `text` | YES | — | `?ref` attribution, clamped to 100 chars by the RPC |
| `utm_source` | `text` | YES | — | clamped to 100 chars |
| `use_case` | `text` | YES | — | clamped to 500 chars |
| `position` | `integer` | NO | — (RPC supplies `nextval('public.waitlist_position_seq')`) | **the numbered spot** |
| `created_at` | `timestamptz` | NO | `now()` | |
| `confirm_token` | `text` | YES | — | `hex(gen_random_bytes(24))`, single-confirm |
| `confirmed_at` | `timestamptz` | YES | — | set once by `confirm_waitlist`; NULL until double opt-in |

### Constraints & indexes (live)

- `waitlist_pkey` — `PRIMARY KEY (id)` (unique index on `id`).
- `waitlist_email_key` — `UNIQUE (email)`.
- `waitlist_position_key` — `UNIQUE INDEX ... (position)`.
- `waitlist_confirm_token_key` — `UNIQUE INDEX ... (confirm_token) WHERE (confirm_token IS NOT NULL)`.
- No foreign keys, no check constraints, no table/column comments.

### Sequences

- `public.waitlist_id_seq` — `bigint`, owned by `waitlist.id` (identity).
- `public.waitlist_position_seq` — `bigint`, `start 1`, `increment 1`, `no cycle`. This is the
  **spot allocator**. It is distinct from `id`; `join_waitlist` calls
  `nextval('public.waitlist_position_seq')`.

### Row Level Security & access

- `relrowsecurity = true`.
- Policy `"anon can join waitlist"` — `INSERT` for role `anon`, `with_check = true`.
  (No `SELECT`/`UPDATE`/`DELETE` policy: direct reads via anon/authenticated are blocked; the
  `SECURITY DEFINER` RPCs run as owner and expose only curated return values.)
- Table grants exist for `anon`, `authenticated`, `service_role`, `postgres` (Supabase default
  blanket grants); effective access is RLS-gated as above.

## RPCs (verbatim `pg_get_functiondef`)

### `public.join_waitlist`

```sql
CREATE OR REPLACE FUNCTION public.join_waitlist(
  p_email text,
  p_referred_by text DEFAULT NULL::text,
  p_utm_source text DEFAULT NULL::text,
  p_use_case text DEFAULT NULL::text
)
 RETURNS TABLE(spot integer, already_joined boolean, member_id bigint, token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing int;
  v_inserted int;
  v_inserted_id bigint;
  v_token text;
begin
  insert into public.waitlist (email, referred_by, utm_source, use_case, position, confirm_token)
  values (
    p_email,
    left(p_referred_by, 100),
    left(p_utm_source, 100),
    left(p_use_case, 500),
    nextval('public.waitlist_position_seq')::int,
    encode(extensions.gen_random_bytes(24), 'hex')
  )
  on conflict (email) do nothing
  returning waitlist.position, waitlist.id, waitlist.confirm_token
    into v_inserted, v_inserted_id, v_token;

  if v_inserted is not null then
    return query select v_inserted, false, v_inserted_id, v_token;
    return;
  end if;

  select w.position, w.id into v_existing, v_inserted_id
  from public.waitlist w
  where w.email = p_email::citext;

  return query select v_existing, true, v_inserted_id, null::text;
end $function$;
```

### `public.confirm_waitlist`

```sql
CREATE OR REPLACE FUNCTION public.confirm_waitlist(p_token text)
 RETURNS TABLE(spot integer, email text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.waitlist
  set confirmed_at = now()
  where confirm_token = p_token and confirmed_at is null
  returning waitlist.position, waitlist.email::text;
$function$;
```

### `public.waitlist_stats`

```sql
CREATE OR REPLACE FUNCTION public.waitlist_stats()
 RETURNS TABLE(claimed integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.waitlist;
$function$;
```

All three RPCs are `SECURITY DEFINER` with `search_path` pinned to `public` (the
`secure_security_definer_functions` migration, `20260823110043`). `EXECUTE` is granted to
`PUBLIC`, `anon`, `authenticated`, `service_role`, `postgres`. They depend on the `citext` and
`pgcrypto` extensions (`extensions.gen_random_bytes`).

## `spot` semantics (the wired-in contract)

`spot` is **not a column** — it is the RPC output name for `waitlist.position`. The pipeline:

1. `join_waitlist` inserts with `position = nextval('waitlist_position_seq')` and returns it as
   `spot`. Insertion is race-safe via `on conflict (email) do nothing`; a repeat email returns the
   existing `position` with `already_joined = true` and `token = NULL` (no re-email).
2. `confirm_waitlist` sets `confirmed_at` and returns `spot` (= `position`) + `email`.
3. `app/api/waitlist/route.ts` maps `spot → position` in its JSON/redirect contract;
   `services/waitlist.ts` compares `position > FOUNDING_COHORT_CAP` (`= 500`) to set `foundingFull`
   → the `?wave2=1` redirect.

Consequences for T14:

- **Founding cohort = `position <= 500`** (numbered spot, first-come via the sequence).
- **The 500 cap is soft**: the DB never rejects or truncates; members above 500 are still stored
  and emailed, flagged as wave two by the app. `waitlist_stats().claimed` counts **all** rows, not
  just the founding 500.
- **`confirmed_at IS NOT NULL`** is the double opt-in gate. For the billing founding roster
  (plan §T14: `spot <= 500 ∩ referral_attribution`) the join predicate is `position <= 500` on the
  waitlist side; the `referral_attribution` side does not exist yet (see below).
- `spot`/`position` is monotonic per insert but **not gapless** (sequence + `on conflict do
  nothing` consume values). Do not treat it as a dense index.

## `public.brevo_outbox` (related out-of-band table)

Included because `waitlist` writes to it on Brevo/SMTP failure and T14 may need to reason about it.

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | `bigint` | NO | — (PK, `brevo_outbox_pkey`; sequence-backed) |
| `waitlist_id` | `bigint` | NO | — FK → `waitlist(id)` `ON DELETE CASCADE` |
| `payload` | `jsonb` | NO | — |
| `attempts` | `integer` | NO | `0` |
| `synced_at` | `timestamptz` | YES | — |
| `last_error` | `text` | YES | — |
| `created_at` | `timestamptz` | NO | `now()` |
| `kind` | `text` | NO | `'contact_sync'` |

- Constraint `brevo_outbox_waitlist_id_fkey` — `FOREIGN KEY (waitlist_id) REFERENCES waitlist(id) ON DELETE CASCADE`.
- RLS enabled with policy `"anon can queue brevo outbox"` — `INSERT` for `anon`, `with_check = true`.

## Gaps / T14 fetch points

1. **`referral_attribution` does not exist on the connected project.** Confirmed by object
   inventory (`relation "referral_attribution" does not exist` context: absent from `pg_class`).
   It is created by T3's migration (`20261007000000_billing_workspace_plans.sql`). **T14 must pin
   the roster join predicate (email hash vs user id) once T3 lands, then build the backfill.**
2. **No separate cohort table** — do not look for one; cohort = `waitlist.position <= 500`.
3. **No `is_founding`/`founding` flag on `waitlist`** — founding is derived from `position`, and is
   locked at subscription creation on the billing side (spec §15), never re-derived from live roster
   drift.
4. The connected project's migration history stops at `20260824164246`, while the repo contains
   newer migrations (e.g. `20260827220000_sync_hardening_ledger.sql`). This snapshot documents the
   **live connected DB as-is**; T14 should re-run the appendix queries against the target
   environment before applying the backfill.

## Appendix — reproduction queries

```sql
-- columns
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='waitlist' order by ordinal_position;

-- constraints
select con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='waitlist';

-- indexes
select indexname, indexdef from pg_indexes
where schemaname='public' and tablename='waitlist';

-- functions
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('join_waitlist','confirm_waitlist','waitlist_stats');

-- policies
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='waitlist';
```
