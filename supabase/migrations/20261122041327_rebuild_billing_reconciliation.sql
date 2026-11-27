alter table public.workspace_plans
  add column if not exists rebuild_poll_after timestamptz not null default now();
alter table public.rebuild_billing_checkouts
  add column if not exists rebuild_poll_after timestamptz not null default now(),
  add column if not exists rebuild_owner_check_after timestamptz not null default now();
alter table public.gateway_events
  add column if not exists rebuild_poll_after timestamptz not null default now();

create index if not exists rebuild_subscription_reconcile_due
  on public.workspace_plans(rebuild_poll_after, workspace_id)
  where gateway_subscription_id is not null and status <> 'canceled';
create index if not exists rebuild_checkout_reconcile_due
  on public.rebuild_billing_checkouts(rebuild_poll_after, id)
  where status in ('creating', 'open');
create index if not exists rebuild_webhook_retry_due
  on public.gateway_events(rebuild_poll_after, id)
  where processed_at is null and (event_id like 'stripe:%' or event_id like 'razorpay:%');

-- The short lease keeps overlapping cron runs from claiming the same work. A
-- timed-out invocation leaves its rows eligible after the lease expires.
create or replace function public.rebuild_claim_billing_work(kind text, batch_size integer)
returns setof uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  batch_limit integer := least(greatest(coalesce(batch_size, 0), 0), 64);
  lease timestamptz := now() + interval '15 minutes';
begin
  case kind
    when 'webhook' then
      return query with due as (
        select id from public.gateway_events
          where processed_at is null and (event_id like 'stripe:%' or event_id like 'razorpay:%')
            and rebuild_poll_after <= now() and created_at <= now() - interval '2 minutes'
          order by rebuild_poll_after, id limit batch_limit for update skip locked
      )
      update public.gateway_events e set rebuild_poll_after = lease from due
        where e.id = due.id returning e.id;
    when 'checkout' then
      return query with due as (
        select id from public.rebuild_billing_checkouts
          where status in ('creating', 'open') and rebuild_poll_after <= now()
            and created_at <= now() - interval '2 minutes'
          order by rebuild_poll_after, id limit batch_limit for update skip locked
      )
      update public.rebuild_billing_checkouts c set rebuild_poll_after = lease from due
        where c.id = due.id returning c.id;
    when 'subscription' then
      return query with due as (
        select workspace_id from public.workspace_plans
          where gateway in ('stripe', 'razorpay') and gateway_subscription_id is not null
            and status <> 'canceled' and rebuild_poll_after <= now()
          order by rebuild_poll_after, workspace_id limit batch_limit for update skip locked
      )
      update public.workspace_plans p set rebuild_poll_after = lease from due
        where p.workspace_id = due.workspace_id returning p.workspace_id;
    else
      raise exception 'billing_unknown_work_kind';
  end case;
end;
$$;

revoke all on function public.rebuild_claim_billing_work(text,integer) from public, anon, authenticated;
grant execute on function public.rebuild_claim_billing_work(text,integer) to service_role;
