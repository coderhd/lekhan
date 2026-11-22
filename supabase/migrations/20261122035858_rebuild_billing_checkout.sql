-- Runs after the H0 workspace_plans and gateway_events schema already used by production.
alter table public.workspace_plans
  add column if not exists rebuild_billing_revision bigint not null default 0,
  add column if not exists rebuild_billing_price_id text;

create unique index if not exists rebuild_one_workspace_per_subscription
  on public.workspace_plans(gateway, gateway_subscription_id) where gateway_subscription_id is not null;

create table if not exists public.rebuild_billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rail text not null check (rail in ('stripe', 'razorpay')),
  tier text not null check (tier in ('plus', 'pro', 'team')),
  cycle text not null check (cycle in ('monthly', 'annual')),
  seats int not null check ((tier = 'team' and rail = 'stripe' and seats >= 2) or (tier <> 'team' and seats = 1)),
  price_id text not null,
  founding boolean not null,
  provider_ref text,
  status text not null default 'creating' check (status in ('creating', 'open', 'closed', 'settled')),
  expires_at bigint not null,
  created_at timestamptz not null default now()
);

create unique index if not exists rebuild_one_pending_checkout
  on public.rebuild_billing_checkouts(workspace_id) where status in ('creating', 'open');

alter table public.rebuild_billing_checkouts enable row level security;
revoke all on public.rebuild_billing_checkouts from public, anon, authenticated;
grant select, insert, update on public.rebuild_billing_checkouts to service_role;

create or replace function public.rebuild_reserve_billing_checkout(
  target_workspace uuid, actor uuid, offer_rail text, offer_tier text, offer_cycle text, offer_seats int,
  offer_price text, offer_founding boolean, offer_expires bigint
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  result uuid;
  plan public.workspace_plans%rowtype;
begin
  perform 1 from public.workspaces where id = target_workspace and owner_id = actor for share;
  if not found then
    raise exception 'billing_workspace_not_owned';
  end if;

  insert into public.workspace_plans(workspace_id) values (target_workspace)
    on conflict (workspace_id) do nothing;
  select * into strict plan from public.workspace_plans where workspace_id = target_workspace for update;

  if plan.is_founding <> offer_founding then
    raise exception 'billing_offer_changed';
  end if;
  if plan.gateway_subscription_id is not null and plan.status <> 'canceled' then
    raise exception 'billing_subscription_exists';
  end if;

  insert into public.rebuild_billing_checkouts (workspace_id, rail, tier, cycle, seats, price_id, founding, expires_at)
    values (target_workspace, offer_rail, offer_tier, offer_cycle, offer_seats, offer_price, offer_founding, offer_expires)
    on conflict (workspace_id) where status in ('creating', 'open') do nothing
    returning id into result;
  if result is null then
    raise exception 'billing_checkout_in_progress';
  end if;
  return result;
end;
$$;

create or replace function public.rebuild_apply_billing_event(
  event_key text, target_workspace uuid, attempt_key uuid, expected_revision bigint,
  provider_rail text, provider_subscription text, provider_customer text, provider_price text,
  provider_status text, provider_period_end timestamptz, provider_cancel_at_end boolean,
  offer_tier text, offer_cycle text, offer_seats int
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  event_row public.gateway_events%rowtype;
  plan public.workspace_plans%rowtype;
  attempt public.rebuild_billing_checkouts%rowtype;
  current_subscription boolean;
begin
  select * into strict event_row from public.gateway_events where event_id = event_key and gateway = provider_rail for update;
  if event_row.processed_at is not null then return 'duplicate'; end if;

  select * into strict plan from public.workspace_plans where workspace_id = target_workspace for update;
  if plan.rebuild_billing_revision <> expected_revision then raise exception 'billing_revision_changed'; end if;
  current_subscription := coalesce(plan.gateway = provider_rail and plan.gateway_subscription_id = provider_subscription, false);

  if not current_subscription then
    if attempt_key is not null then
      select * into attempt from public.rebuild_billing_checkouts
        where id = attempt_key and workspace_id = target_workspace and rail = provider_rail for update;
    end if;
    -- Only an open checkout can introduce a subscription. Older terminal events are recorded and ignored.
    if attempt.id is null or attempt.status not in ('creating', 'open') then
      update public.gateway_events set processed_at = now() where id = event_row.id;
      return 'ignored';
    end if;
    if attempt.founding <> plan.is_founding or attempt.price_id <> provider_price or attempt.tier <> offer_tier
      or attempt.cycle <> offer_cycle or attempt.seats <> offer_seats
      or (provider_rail = 'razorpay' and attempt.provider_ref is not null and attempt.provider_ref <> provider_subscription) then
      raise exception 'billing_offer_mismatch';
    end if;

    if provider_status = 'canceled' then
      update public.rebuild_billing_checkouts set status = 'closed' where id = attempt.id;
    elsif provider_status = 'active' then
      if plan.gateway_subscription_id is not null and plan.status <> 'canceled' then
        raise exception 'billing_subscription_exists';
      end if;
      update public.rebuild_billing_checkouts set status = 'settled' where id = attempt.id;
    end if;

    if provider_status <> 'active' then
      update public.gateway_events set processed_at = now() where id = event_row.id;
      return 'pending';
    end if;
  end if;

  update public.workspace_plans set
    tier = case when provider_status = 'canceled' then 'free' else offer_tier end,
    billing_cycle = case when provider_status = 'canceled' then 'none' else offer_cycle end,
    currency = case when provider_rail = 'stripe' then 'USD' else 'INR' end,
    gateway = provider_rail,
    gateway_customer_id = coalesce(provider_customer, case when plan.gateway = provider_rail then plan.gateway_customer_id end),
    gateway_subscription_id = provider_subscription,
    seats = case when provider_status <> 'canceled' and offer_tier = 'team' then offer_seats end,
    status = provider_status,
    current_period_end = provider_period_end,
    cancel_at_period_end = provider_status <> 'canceled' and
      (provider_cancel_at_end or (current_subscription and provider_rail = 'razorpay' and plan.cancel_at_period_end)),
    past_due_since = case when provider_status = 'past_due' then
      coalesce(case when current_subscription and plan.status = 'past_due' then plan.past_due_since end, now())
    end,
    rebuild_billing_price_id = provider_price,
    rebuild_billing_revision = plan.rebuild_billing_revision + 1,
    last_checked_at = now()
    where workspace_id = target_workspace;

  update public.gateway_events set processed_at = now() where id = event_row.id;
  return 'applied';
end;
$$;

revoke all on function public.rebuild_reserve_billing_checkout(uuid,uuid,text,text,text,int,text,boolean,bigint)
  from public, anon, authenticated;
grant execute on function public.rebuild_reserve_billing_checkout(uuid,uuid,text,text,text,int,text,boolean,bigint)
  to service_role;
revoke all on function public.rebuild_apply_billing_event(text,uuid,uuid,bigint,text,text,text,text,text,timestamptz,boolean,text,text,int)
  from public, anon, authenticated;
grant execute on function public.rebuild_apply_billing_event(text,uuid,uuid,bigint,text,text,text,text,text,timestamptz,boolean,text,text,int)
  to service_role;

grant select, insert, update on public.workspace_plans, public.gateway_events to service_role;
