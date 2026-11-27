-- Retain the paid predecessor until a successor pays, without retaining its payment identity.
-- NULL identifies an ordinary plan. A boolean holds the successor's checkout cohort.
alter table public.workspace_plans add column rebuild_successor_founding boolean;

create table public.rebuild_workspace_transfers (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  previous_owner uuid not null references public.profiles(id) on delete cascade,
  successor uuid not null references public.profiles(id) on delete cascade,
  token_digest text not null unique check (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  check (previous_owner <> successor)
);
alter table public.rebuild_workspace_transfers enable row level security;
revoke all on public.rebuild_workspace_transfers from public, anon, authenticated;
grant select on public.rebuild_workspace_transfers to service_role;

create function public.rebuild_invite_workspace_owner(
  target_workspace uuid, actor uuid, recipient_email text, digest text
) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  recipient uuid;
  expires timestamptz := now() + interval '7 days';
begin
  perform 1 from public.workspaces where id = target_workspace and owner_id = actor for update;
  if not found then raise exception 'transfer_workspace_not_owned'; end if;
  if exists (select 1 from public.workspace_plans where workspace_id = target_workspace
    and rebuild_billing_write_until > now()) then raise exception 'transfer_in_progress'; end if;

  select u.id into recipient from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email::text) = lower(recipient_email) and u.email_confirmed_at is not null;
  if recipient is null or recipient = actor then raise exception 'transfer_invalid_recipient'; end if;
  if exists (select 1 from public.workspaces where owner_id = recipient) then
    raise exception 'transfer_recipient_has_workspace';
  end if;

  insert into public.rebuild_workspace_transfers(workspace_id, previous_owner, successor, token_digest, expires_at)
    values(target_workspace, actor, recipient, digest, expires)
    on conflict (workspace_id) do update set previous_owner = excluded.previous_owner, successor = excluded.successor,
      token_digest = excluded.token_digest, expires_at = excluded.expires_at, accepted_at = null;
  return expires;
end;
$$;

create function public.rebuild_accept_workspace_owner(
  target_workspace uuid, actor uuid, digest text, expected_revision bigint, write_lease timestamptz,
  verified_subscription text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  transfer public.rebuild_workspace_transfers%rowtype;
  plan public.workspace_plans%rowtype;
  prior_owner uuid;
  account_id uuid;
  successor_founding boolean;
  keep_predecessor boolean;
begin
  select owner_id into prior_owner from public.workspaces where id = target_workspace for update;
  select * into transfer from public.rebuild_workspace_transfers where workspace_id = target_workspace
    and token_digest = digest and successor = actor for update;
  if not found or transfer.previous_owner is distinct from prior_owner
    or transfer.accepted_at is not null or transfer.expires_at <= now() then
    raise exception 'transfer_invalid_link';
  end if;
  if exists (select 1 from public.workspaces where owner_id = actor) then
    raise exception 'transfer_recipient_has_workspace';
  end if;

  for account_id in select unnest(array[actor, prior_owner]) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('lekhan:referral:' || account_id::text, 0));
  end loop;
  select * into strict plan from public.workspace_plans where workspace_id = target_workspace for update;
  if plan.rebuild_billing_revision <> expected_revision or plan.rebuild_billing_write_until <> write_lease
    or write_lease <= now() or plan.gateway_subscription_id is distinct from verified_subscription then
    raise exception 'transfer_plan_changed';
  end if;
  if exists (select 1 from public.rebuild_billing_checkouts where workspace_id = target_workspace
    and status in ('creating', 'open')) then raise exception 'transfer_checkout_pending'; end if;
  if exists (select 1 from public.rebuild_referral_redemptions where workspace_id = target_workspace
    and settled_at is null and abandoned_at is null) then raise exception 'transfer_referral_pending'; end if;

  successor_founding := exists (select 1 from public.rebuild_founding_accounts where user_id = actor);
  keep_predecessor := plan.gateway_subscription_id is not null;
  update public.workspaces set owner_id = actor where id = target_workspace;
  update public.referral_credit_ledger set workspace_id = null where workspace_id = target_workspace
    and referrer_user_id = prior_owner and applied_at is null and claimed_at is null;
  update public.referral_credit_ledger set workspace_id = target_workspace where workspace_id is null
    and referrer_user_id = actor and applied_at is null and claimed_at is null;

  update public.workspace_plans set
    gateway_customer_id = null,
    cancel_at_period_end = keep_predecessor and plan.status <> 'canceled',
    is_founding = case when keep_predecessor and plan.status <> 'canceled' then plan.is_founding else successor_founding end,
    rebuild_successor_founding = case when keep_predecessor then successor_founding end,
    rebuild_billing_revision = plan.rebuild_billing_revision + 1,
    credited_months = coalesce((select sum(months) from public.referral_credit_ledger where workspace_id = target_workspace
      and referrer_user_id = actor and applied_at is null and claimed_at is null), 0)
    where workspace_id = target_workspace;
  update public.rebuild_workspace_transfers set accepted_at = now() where workspace_id = target_workspace;
  return target_workspace;
exception when unique_violation then
  raise exception 'transfer_recipient_has_workspace';
end;
$$;

revoke all on function public.rebuild_invite_workspace_owner(uuid,uuid,text,text),
  public.rebuild_accept_workspace_owner(uuid,uuid,text,bigint,timestamptz,text) from public, anon, authenticated;
grant execute on function public.rebuild_invite_workspace_owner(uuid,uuid,text,text),
  public.rebuild_accept_workspace_owner(uuid,uuid,text,bigint,timestamptz,text) to service_role;

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

  if plan.rebuild_billing_write_until > now() then
    raise exception 'billing_write_in_progress';
  end if;
  if coalesce(plan.rebuild_successor_founding, plan.is_founding) <> offer_founding then
    raise exception 'billing_offer_changed';
  end if;
  if plan.gateway_subscription_id is not null and plan.status <> 'canceled'
    and (plan.rebuild_successor_founding is null or not plan.cancel_at_period_end) then
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
    if attempt.founding <> coalesce(plan.rebuild_successor_founding, plan.is_founding) or attempt.price_id <> provider_price or attempt.tier <> offer_tier
      or attempt.cycle <> offer_cycle or attempt.seats <> offer_seats
      or (provider_rail = 'razorpay' and attempt.provider_ref is not null and attempt.provider_ref <> provider_subscription) then
      raise exception 'billing_offer_mismatch';
    end if;

    if provider_status = 'canceled' then
      update public.rebuild_billing_checkouts set status = 'closed' where id = attempt.id;
    elsif provider_status = 'active' then
      if plan.gateway_subscription_id is not null and plan.status <> 'canceled'
    and (plan.rebuild_successor_founding is null or not plan.cancel_at_period_end) then
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
    gateway_customer_id = case
      when current_subscription and plan.rebuild_successor_founding is not null then null
      else coalesce(provider_customer, case when plan.gateway = provider_rail then plan.gateway_customer_id end) end,
    is_founding = case
      when not current_subscription or provider_status = 'canceled'
      then coalesce(plan.rebuild_successor_founding, plan.is_founding) else plan.is_founding end,
    rebuild_successor_founding = case when current_subscription then plan.rebuild_successor_founding end,
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
