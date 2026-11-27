create table public.rebuild_referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  invoice_ref text not null unique,
  subscription_ref text not null,
  customer_ref text not null,
  months int not null check (months > 0),
  amount_minor bigint not null check (amount_minor > 0),
  attempted_at timestamptz,
  provider_ref text unique,
  settled_at timestamptz,
  abandoned_at timestamptz,
  recover_after timestamptz not null default now() + interval '5 minutes'
);

create unique index rebuild_one_open_referral_redemption
  on public.rebuild_referral_redemptions(workspace_id) where settled_at is null and abandoned_at is null;
create index rebuild_due_referral_redemption
  on public.rebuild_referral_redemptions(recover_after, id) where settled_at is null and abandoned_at is null;
alter table public.referral_credit_ledger add column rebuild_redemption_id uuid
  references public.rebuild_referral_redemptions(id);
create index rebuild_referral_redemption_rows on public.referral_credit_ledger(rebuild_redemption_id)
  where rebuild_redemption_id is not null;

alter table public.rebuild_referral_redemptions enable row level security;
revoke all on public.rebuild_referral_redemptions from public, anon, authenticated;
grant select on public.rebuild_referral_redemptions to service_role;

create function public.rebuild_reserve_referral_redemption(
  target_workspace uuid, target_subscription text, target_customer text, target_invoice text,
  paid_at timestamptz, amount_per_month bigint, expected_revision bigint
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  plan public.workspace_plans%rowtype;
  existing public.rebuild_referral_redemptions%rowtype;
  credits uuid[];
  months int;
  batch uuid;
begin
  select * into plan from public.workspace_plans where workspace_id = target_workspace for update;
  if not found or plan.gateway <> 'stripe' or plan.currency is distinct from 'USD' or plan.status <> 'active'
    or plan.rebuild_billing_revision <> expected_revision or plan.tier = 'free'
    or plan.gateway_customer_id is distinct from target_customer
    or plan.gateway_subscription_id is distinct from target_subscription
    or target_invoice !~ '^in_[A-Za-z0-9]+$' or amount_per_month <= 0 or paid_at is null
    or paid_at > now() + interval '5 minutes' then
    return null;
  end if;
  if exists (select 1 from public.workspace_plans where gateway = 'stripe'
    and gateway_customer_id = target_customer and workspace_id <> target_workspace) then
    raise exception 'referral_customer_shared';
  end if;

  select * into existing from public.rebuild_referral_redemptions where invoice_ref = target_invoice;
  if found then
    if existing.workspace_id = target_workspace and existing.customer_ref = target_customer
      and existing.settled_at is null and existing.abandoned_at is null then return existing.id; end if;
    return null;
  end if;
  if exists (select 1 from public.rebuild_referral_redemptions where workspace_id = target_workspace
    and settled_at is null and abandoned_at is null) then
    return null;
  end if;

  select array_agg(l.id), sum(l.months)::int into credits, months from public.referral_credit_ledger l
    where l.workspace_id = target_workspace and l.referrer_user_id = (
      select w.owner_id from public.workspaces w where w.id = target_workspace
    ) and l.applied_at is null and l.claimed_at is null
      and l.rebuild_redemption_id is null and l.granted_at <= paid_at;
  if credits is null then return null; end if;
  if months > plan.credited_months then raise exception 'referral_balance_inconsistent'; end if;

  insert into public.rebuild_referral_redemptions(
    workspace_id, invoice_ref, subscription_ref, customer_ref, months, amount_minor
  ) values(target_workspace, target_invoice, target_subscription, target_customer, months, months * amount_per_month)
    returning id into batch;

  update public.referral_credit_ledger set rebuild_redemption_id = batch, claimed_at = now() where id = any(credits);
  return batch;
end;
$$;

create function public.rebuild_start_referral_redemption(batch uuid)
returns timestamptz
language sql security invoker set search_path = ''
as $$
  update public.rebuild_referral_redemptions r set attempted_at = coalesce(r.attempted_at, now())
    where r.id = batch and r.settled_at is null and r.abandoned_at is null and exists (
      select 1 from public.workspace_plans p where p.workspace_id = r.workspace_id
        and p.gateway = 'stripe' and p.status = 'active' and p.currency = 'USD'
        and p.gateway_customer_id = r.customer_ref and p.gateway_subscription_id = r.subscription_ref
    ) and not exists (
      select 1 from public.workspace_plans p where p.workspace_id <> r.workspace_id
        and p.gateway = 'stripe' and p.gateway_customer_id = r.customer_ref
    )
    returning attempted_at;
$$;

create function public.rebuild_release_unstarted_redemption(batch uuid)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.rebuild_referral_redemptions r set abandoned_at = now()
    where r.id = batch and r.attempted_at is null and r.abandoned_at is null and r.settled_at is null
      and not exists (
        select 1 from public.workspace_plans p where p.workspace_id = r.workspace_id
          and p.gateway = 'stripe' and p.status <> 'canceled'
          and p.gateway_customer_id = r.customer_ref and p.gateway_subscription_id = r.subscription_ref
      );
  if not found then return false; end if;
  update public.referral_credit_ledger set rebuild_redemption_id = null, claimed_at = null
    where rebuild_redemption_id = batch and applied_at is null;
  return true;
end;
$$;

create function public.rebuild_settle_referral_redemption(batch uuid, transaction_ref text)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  redemption public.rebuild_referral_redemptions%rowtype;
  destination uuid;
  applied int;
begin
  select workspace_id into destination from public.rebuild_referral_redemptions where id = batch;
  if destination is not null then
    perform 1 from public.workspace_plans where workspace_id = destination for update;
  end if;
  select * into strict redemption from public.rebuild_referral_redemptions where id = batch for update;
  if redemption.settled_at is not null then return redemption.provider_ref = transaction_ref; end if;
  if redemption.attempted_at is null or redemption.abandoned_at is not null
    or transaction_ref !~ '^cbtxn_[A-Za-z0-9]+$' then return false; end if;

  with settled as (
    update public.referral_credit_ledger set applied_at = now(), claimed_at = null
      where rebuild_redemption_id = batch and applied_at is null returning months
  ) select coalesce(sum(months), 0)::int into applied from settled;
  if redemption.workspace_id is not null then
    if applied <> redemption.months then raise exception 'referral_redemption_inconsistent'; end if;
    update public.workspace_plans set credited_months = credited_months - applied
      where workspace_id = redemption.workspace_id and credited_months >= applied;
    if not found then raise exception 'referral_balance_inconsistent'; end if;
  end if;
  update public.rebuild_referral_redemptions set provider_ref = transaction_ref, settled_at = now() where id = batch;
  return true;
end;
$$;

create function public.rebuild_claim_referral_recovery(batch_size int)
returns setof uuid
language sql security invoker set search_path = ''
as $$
  with due as (
    select id from public.rebuild_referral_redemptions where settled_at is null and abandoned_at is null and recover_after <= now()
      order by recover_after, id limit least(greatest(coalesce(batch_size, 0), 0), 32) for update skip locked
  )
  update public.rebuild_referral_redemptions r set recover_after = now() + interval '15 minutes'
    from due where r.id = due.id returning r.id;
$$;

grant insert, update on public.rebuild_referral_redemptions to service_role;
grant update on public.referral_credit_ledger to service_role;
revoke all on function public.rebuild_reserve_referral_redemption(uuid,text,text,text,timestamptz,bigint,bigint),
  public.rebuild_start_referral_redemption(uuid), public.rebuild_release_unstarted_redemption(uuid),
  public.rebuild_settle_referral_redemption(uuid,text),
  public.rebuild_claim_referral_recovery(int) from public, anon, authenticated;
grant execute on function public.rebuild_reserve_referral_redemption(uuid,text,text,text,timestamptz,bigint,bigint),
  public.rebuild_start_referral_redemption(uuid), public.rebuild_release_unstarted_redemption(uuid),
  public.rebuild_settle_referral_redemption(uuid,text),
  public.rebuild_claim_referral_recovery(int) to service_role;
