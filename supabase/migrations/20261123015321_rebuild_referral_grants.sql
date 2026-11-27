-- Extend the existing H0 attribution and credit ledger. Grants and roster
-- eligibility are decided by verified accounts and persisted provider state.
create table public.rebuild_referral_rules (
  id boolean primary key default true check (id),
  annual_bank_cap smallint not null default 12 check (annual_bank_cap between 1 and 120)
);
insert into public.rebuild_referral_rules default values;

create table public.rebuild_founding_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text not null check (source in ('historical_grant', 'roster_attribution', 'reviewed_roster')),
  granted_at timestamptz not null default now()
);
alter table public.rebuild_referral_rules enable row level security;
alter table public.rebuild_founding_accounts enable row level security;
revoke all on public.rebuild_referral_rules, public.rebuild_founding_accounts from public, anon, authenticated;
grant select, update on public.rebuild_referral_rules to service_role;
grant select, insert on public.rebuild_founding_accounts to service_role;
grant select on public.referral_credit_ledger to service_role;

insert into public.rebuild_founding_accounts(user_id, source)
select distinct w.owner_id, 'historical_grant' from public.workspace_plans p
join public.workspaces w on w.id = p.workspace_id where p.is_founding
on conflict do nothing;

create function public.rebuild_sync_founding_account(actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rebuild_founding_accounts(user_id, source)
  select ra.user_id, 'roster_attribution'
    from public.referral_attribution ra join auth.users u on u.id = ra.user_id
    join public.waitlist w on ra.email_hash = md5(lower(w.email::text))
    where ra.user_id = actor and u.email_confirmed_at is not null
      and ra.email_hash = md5(lower(u.email::text)) and w.position <= 500
    on conflict do nothing;

  update public.workspace_plans p set is_founding = true
    from public.workspaces w
    where p.workspace_id = w.id and w.owner_id = actor and not p.is_founding
      and p.status = 'none' and p.gateway_subscription_id is null
      and exists (select 1 from public.rebuild_founding_accounts f where f.user_id = actor)
      and not exists (
        select 1 from public.rebuild_billing_checkouts c where c.workspace_id = p.workspace_id and c.status in ('creating', 'open')
      );
end;
$$;

-- Called once per reviewed roster row, never by signup or by the app.
create function public.rebuild_record_reviewed_founder(actor uuid, roster_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  address text;
begin
  select lower(w.email::text) into address from public.waitlist w where w.id = roster_id and w.position <= 500;
  if address is null or (select count(*) from auth.users u where lower(u.email::text) = address) <> 1
    or not exists (select 1 from auth.users u where u.id = actor
      and lower(u.email::text) = address and u.email_confirmed_at is not null) then
    return false;
  end if;
  if exists (select 1 from public.rebuild_founding_accounts f where f.user_id = actor) then return true; end if;

  if not exists (
    select 1 from public.workspace_plans p join public.workspaces w on w.id = p.workspace_id
      where w.owner_id = actor and p.status = 'none' and p.gateway_subscription_id is null
      and not exists (select 1 from public.rebuild_billing_checkouts c
        where c.workspace_id = p.workspace_id and c.status in ('creating', 'open'))
  ) then return false; end if;

  insert into public.rebuild_founding_accounts(user_id, source) values(actor, 'reviewed_roster')
    on conflict do nothing;
  perform public.rebuild_sync_founding_account(actor);
  return true;
end;
$$;

create or replace function public.handle_new_user_referral_attribution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  referral text;
begin
  -- Freeze the signup's direct attribution before account metadata can be edited.
  if tg_op = 'INSERT' then
    referral := btrim(new.raw_user_meta_data->>'referred_by');
    if referral ~ '^[a-zA-Z0-9_-]{1,100}$' then
      insert into public.referral_attribution(user_id, ref, email_hash)
        values (new.id, referral, md5(lower(new.email::text))) on conflict do nothing;
    end if;
  end if;

  if new.email_confirmed_at is not null then
    -- A confirmed waitlist signup can supply attribution when signup had no direct code.
    insert into public.referral_attribution(user_id, ref, email_hash)
      select new.id, w.referred_by, md5(lower(new.email::text))
        from public.waitlist w where lower(w.email::text) = lower(new.email::text)
          and w.confirmed_at is not null and w.referred_by ~ '^[a-zA-Z0-9_-]{1,100}$'
        order by w.position limit 1
      on conflict do nothing;
    perform public.rebuild_sync_founding_account(new.id);
  end if;
  return new;
end;
$$;

create trigger rebuild_confirmed_account_referral after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_user_referral_attribution();

create function public.rebuild_grant_referral_month(invitee uuid, stage text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ref text;
  referrer uuid;
  destination uuid;
  new_credit uuid;
  cap int;
begin
  if stage not in ('activation', 'conversion') then return; end if;
  select ra.ref into ref from public.referral_attribution ra
    join auth.users u on u.id = ra.user_id
    where ra.user_id = invitee and u.email_confirmed_at is not null
      and ra.email_hash = md5(lower(u.email::text));
  if ref is null or ref !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then return; end if;
  referrer := ref::uuid;
  if referrer = invitee or not exists (
    select 1 from auth.users r join public.profiles p on p.id = r.id
      join auth.users i on i.id = invitee
    where r.id = referrer and r.email_confirmed_at is not null and lower(r.email::text) <> lower(i.email::text)
  ) then return; end if;

  perform pg_advisory_xact_lock(hashtextextended('lekhan:referral:' || referrer::text, 0));
  if exists (
    select 1 from public.referral_credit_ledger l where l.referrer_user_id = referrer
      and l.invitee_ref = invitee::text and l.trigger_stage = stage
  ) then return; end if;

  select annual_bank_cap into strict cap from public.rebuild_referral_rules where id;
  if exists (
    select 1 from public.referral_credit_ledger l where l.referrer_user_id = referrer
    having coalesce(sum(l.months) filter (where l.applied_at is null), 0) >= cap
       or coalesce(sum(l.months) filter (
         where l.granted_at >= (date_trunc('year', now() at time zone 'UTC') at time zone 'UTC')
       ), 0) >= cap
  ) then return; end if;

  select w.id into destination from public.workspaces w where w.owner_id = referrer
    order by w.id limit 1;

  insert into public.referral_credit_ledger(
    workspace_id, referrer_user_id, source_ref, invitee_ref, invitee_user_id, trigger_stage, months
  ) values (destination, referrer, ref, invitee::text, invitee, stage, 1)
    on conflict do nothing returning id into new_credit;

  if new_credit is not null and destination is not null then
    insert into public.workspace_plans(workspace_id) values(destination) on conflict do nothing;
    update public.workspace_plans set credited_months = credited_months + 1 where workspace_id = destination;
  end if;
end;
$$;

create or replace function public.handle_workspace_created_billing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  attached int;
begin
  perform pg_advisory_xact_lock(hashtextextended('lekhan:referral:' || new.owner_id::text, 0));
  insert into public.workspace_plans(workspace_id) values(new.id) on conflict do nothing;
  with moved as (
    update public.referral_credit_ledger set workspace_id = new.id
      where referrer_user_id = new.owner_id and workspace_id is null and applied_at is null
      returning months
  ) select coalesce(sum(months),0)::int into attached from moved;
  if attached > 0 then
    update public.workspace_plans set credited_months = credited_months + attached where workspace_id = new.id;
  end if;
  perform public.rebuild_sync_founding_account(new.owner_id);
  perform public.rebuild_grant_referral_month(new.owner_id, 'activation');
  return new;
end;
$$;

create function public.rebuild_first_paid_referral()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  invitee uuid;
begin
  select owner_id into invitee from public.workspaces where id = new.workspace_id;
  if invitee is not null then perform public.rebuild_grant_referral_month(invitee, 'conversion'); end if;
  return new;
end;
$$;

create trigger rebuild_after_initial_provider_payment after update on public.workspace_plans
  for each row when (
    new.status = 'active' and new.gateway in ('stripe', 'razorpay')
    and new.gateway_subscription_id is not null and new.gateway_subscription_id is distinct from old.gateway_subscription_id
    and new.rebuild_billing_revision > old.rebuild_billing_revision
  ) execute function public.rebuild_first_paid_referral();

-- Catch up existing attributed owners without changing a price in flight.
insert into public.rebuild_founding_accounts(user_id, source)
select distinct ra.user_id, 'roster_attribution' from public.referral_attribution ra
join auth.users u on u.id = ra.user_id
join public.waitlist w on ra.email_hash = md5(lower(w.email::text))
where u.email_confirmed_at is not null and ra.email_hash = md5(lower(u.email::text)) and w.position <= 500
on conflict do nothing;
select public.rebuild_sync_founding_account(user_id) from public.rebuild_founding_accounts;

revoke all on function public.rebuild_sync_founding_account(uuid), public.rebuild_record_reviewed_founder(uuid,bigint),
  public.rebuild_grant_referral_month(uuid,text),
  public.rebuild_first_paid_referral(), public.handle_new_user_referral_attribution(), public.handle_workspace_created_billing()
  from public, anon, authenticated;
grant execute on function public.rebuild_sync_founding_account(uuid), public.rebuild_record_reviewed_founder(uuid,bigint) to service_role;
