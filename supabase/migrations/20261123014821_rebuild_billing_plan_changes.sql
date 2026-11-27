-- Serializes renewal changes and cancellations across app instances.
alter table public.workspace_plans
  add column if not exists rebuild_billing_write_until timestamptz not null default now();
