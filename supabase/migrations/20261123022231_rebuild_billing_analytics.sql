-- Opt-in measurement is stored separately from the payment audit. No payment
-- reference, email or account ID is part of the outbound event.
create table public.rebuild_billing_measurement (
  checkout_id uuid not null references public.rebuild_billing_checkouts(id) on delete cascade,
  destination text not null check (destination in ('ga4', 'posthog')),
  consent_digest text not null check (consent_digest ~ '^[a-f0-9]{64}$'),
  client_id text not null,
  expires_at timestamptz not null default now() + interval '365 days',
  primary key (checkout_id, destination),
  check (case destination when 'ga4' then client_id ~ '^[0-9]{1,20}[.][0-9]{1,20}$'
    else client_id ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' end)
);
create index rebuild_measurement_by_consent on public.rebuild_billing_measurement(consent_digest);
create index rebuild_measurement_by_expiry on public.rebuild_billing_measurement(expires_at);

create table public.rebuild_measurement_revocations (
  consent_digest text primary key check (consent_digest ~ '^[a-f0-9]{64}$'),
  revoked_at timestamptz not null default now()
);

create table public.rebuild_billing_measurement_events (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null,
  destination text not null,
  event text not null check (event in ('checkout_completed', 'billing_subscription_changed')),
  occurred_at timestamptz not null default now(),
  tier text not null check (tier in ('plus','pro','team')),
  cycle text not null check (cycle in ('monthly','annual')),
  currency text not null check (currency in ('USD','INR')),
  status text not null check (status in ('active','past_due','incomplete','canceled','none')),
  ends_at_renewal boolean not null,
  claimed_at timestamptz,
  outcome text check (outcome in ('sent','failed','skipped')),
  foreign key (checkout_id, destination) references public.rebuild_billing_measurement(checkout_id, destination) on delete cascade
);
create index rebuild_measurement_events_pending on public.rebuild_billing_measurement_events(destination, occurred_at, id)
  where claimed_at is null;

alter table public.rebuild_billing_measurement enable row level security;
alter table public.rebuild_measurement_revocations enable row level security;
alter table public.rebuild_billing_measurement_events enable row level security;
revoke all on public.rebuild_billing_measurement, public.rebuild_measurement_revocations,
  public.rebuild_billing_measurement_events from public, anon, authenticated;
grant select on public.rebuild_billing_measurement, public.rebuild_billing_measurement_events to service_role;
grant update(outcome) on public.rebuild_billing_measurement_events to service_role;

create function public.rebuild_bind_checkout_measurement(attempt uuid, consent text, ga_client text, posthog_client text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lekhan:measurement:' || consent, 0));
  if exists (select 1 from public.rebuild_measurement_revocations where consent_digest = consent) then return; end if;
  perform 1 from public.rebuild_billing_checkouts where id = attempt and status = 'creating' for update;
  if not found then return; end if;
  insert into public.rebuild_billing_measurement(checkout_id, destination, consent_digest, client_id)
    select attempt, destination, consent, client from (values ('ga4', ga_client), ('posthog', posthog_client)) v(destination, client)
    where client is not null on conflict do nothing;
end;
$$;

create function public.rebuild_revoke_checkout_measurement(consent text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lekhan:measurement:' || consent, 0));
  insert into public.rebuild_measurement_revocations(consent_digest) values (consent)
    on conflict (consent_digest) do nothing;
  delete from public.rebuild_billing_measurement where consent_digest = consent;
end;
$$;

create function public.rebuild_queue_billing_measurement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_type text;
  attempt public.rebuild_billing_checkouts%rowtype;
begin
  if new.gateway_subscription_id is null or new.rebuild_successor_founding is not null then return new; end if;
  if new.gateway_subscription_id is distinct from old.gateway_subscription_id
    or new.gateway is distinct from old.gateway then
    if new.status <> 'active' or new.rebuild_billing_revision <= old.rebuild_billing_revision then return new; end if;
    event_type := 'checkout_completed';
  elsif (new.tier, new.billing_cycle, new.status, new.cancel_at_period_end, new.seats)
    is distinct from (old.tier, old.billing_cycle, old.status, old.cancel_at_period_end, old.seats) then
    event_type := 'billing_subscription_changed';
  else
    return new;
  end if;

  select * into attempt from public.rebuild_billing_checkouts where workspace_id = new.workspace_id
    and status = 'settled' and rail = new.gateway order by created_at desc, id desc limit 1;
  if not found then return new; end if;
  insert into public.rebuild_billing_measurement_events
    (checkout_id, destination, event, tier, cycle, currency, status, ends_at_renewal)
    select attempt.id, destination, event_type,
      case when new.tier = 'free' then old.tier else new.tier end,
      case when new.billing_cycle = 'none' then old.billing_cycle else new.billing_cycle end,
      case when attempt.rail = 'stripe' then 'USD' else 'INR' end,
      new.status, new.cancel_at_period_end
    from public.rebuild_billing_measurement where checkout_id = attempt.id and expires_at > now()
      and (new.tier <> 'free' or old.tier <> 'free')
      and (new.billing_cycle <> 'none' or old.billing_cycle <> 'none')
    for key share;
  return new;
end;
$$;

create trigger rebuild_after_billing_measurement_transition after update on public.workspace_plans
  for each row execute function public.rebuild_queue_billing_measurement();

-- Claim before sending. An ambiguous transport result must not cause a duplicate conversion.
create function public.rebuild_claim_billing_measurement(target text, batch_size int)
returns setof uuid language sql security definer set search_path = '' as $$
  with work as (
    select e.id from public.rebuild_billing_measurement_events e
      join public.rebuild_billing_measurement m using (checkout_id, destination)
      where e.destination = target and e.claimed_at is null and m.expires_at > now()
        and e.occurred_at > now() - interval '72 hours'
      order by e.occurred_at, e.id limit greatest(0, least(batch_size, 20))
      for update of e skip locked
  )
  update public.rebuild_billing_measurement_events e set claimed_at = now()
    from work where e.id = work.id returning e.id;
$$;

create function public.rebuild_prune_billing_measurement()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rebuild_billing_measurement_events where occurred_at < now() - interval '7 days';
  delete from public.rebuild_billing_measurement where expires_at <= now();
  delete from public.rebuild_measurement_revocations where revoked_at < now() - interval '365 days';
end;
$$;

revoke all on function public.rebuild_bind_checkout_measurement(uuid,text,text,text),
  public.rebuild_revoke_checkout_measurement(text), public.rebuild_queue_billing_measurement(),
  public.rebuild_claim_billing_measurement(text,int), public.rebuild_prune_billing_measurement()
  from public, anon, authenticated;
grant execute on function public.rebuild_bind_checkout_measurement(uuid,text,text,text),
  public.rebuild_revoke_checkout_measurement(text), public.rebuild_claim_billing_measurement(text,int),
  public.rebuild_prune_billing_measurement() to service_role;
