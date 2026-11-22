-- Match the existing founding roster shape and preserve historical positions.
create sequence if not exists public.waitlist_position_seq;
create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  referred_by text,
  utm_source text,
  use_case text,
  position integer not null unique,
  created_at timestamptz not null default now(),
  confirm_token text,
  confirmed_at timestamptz
);
alter table public.waitlist add column if not exists confirm_token text;
alter table public.waitlist add column if not exists confirmation_digest text;
alter table public.waitlist add column if not exists confirmation_expires_at timestamptz;
create unique index if not exists rebuild_waitlist_confirmation_idx on public.waitlist(confirmation_digest)
  where confirmation_digest is not null;
create index if not exists rebuild_waitlist_email_lookup on public.waitlist(lower(email::text));

create table if not exists public.brevo_outbox (
  id bigint generated always as identity primary key,
  waitlist_id bigint not null references public.waitlist(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.brevo_outbox add column if not exists next_attempt_at timestamptz not null default now();
alter table public.brevo_outbox add column if not exists lease_until timestamptz;
alter table public.brevo_outbox add column if not exists lease_id uuid;
create index if not exists rebuild_waitlist_outbox_pending on public.brevo_outbox(next_attempt_at, id)
  where synced_at is null and kind in ('rebuild_contact', 'rebuild_confirmation', 'rebuild_founding');

alter table public.waitlist enable row level security;
alter table public.brevo_outbox enable row level security;
revoke all on public.waitlist, public.brevo_outbox from public, anon, authenticated;
grant select, insert, update on public.waitlist, public.brevo_outbox to service_role;
grant usage, select on sequence public.waitlist_position_seq, public.waitlist_id_seq, public.brevo_outbox_id_seq to service_role;

create function public.rebuild_join_waitlist(address text, referrer text, campaign text, purpose text, token text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  entry public.waitlist%rowtype;
  new_signup boolean;
begin
  address := lower(btrim(address));
  if address is null or length(address) > 254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or token is null or token !~ '^[a-f0-9]{48}$' then raise exception 'invalid_waitlist'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lekhan:waitlist:' || address, 0));

  select * into entry from public.waitlist w where lower(w.email::text) = address limit 1;
  new_signup := not found;
  if new_signup then
    insert into public.waitlist(email, referred_by, utm_source, use_case, position)
      values(address, nullif(left(btrim(referrer),100),''), nullif(left(btrim(campaign),100),''),
        nullif(left(btrim(purpose),500),''), nextval('public.waitlist_position_seq'))
      on conflict (email) do nothing returning * into entry;
    new_signup := found;
    if new_signup then
      insert into public.brevo_outbox(waitlist_id, kind, payload) values(entry.id, 'rebuild_contact', '{}');
    else
      select * into strict entry from public.waitlist w where lower(w.email::text) = address limit 1;
    end if;
  end if;

  if entry.confirmed_at is null and (entry.confirmation_expires_at is null or entry.confirmation_expires_at < now()) then
    update public.brevo_outbox set synced_at = now(), payload = '{}'::jsonb, lease_id = null, lease_until = null
      where waitlist_id = entry.id and kind = 'rebuild_confirmation' and synced_at is null;
    update public.waitlist set confirmation_digest = encode(sha256(convert_to(token, 'UTF8')), 'hex'),
      confirmation_expires_at = now() + interval '48 hours' where id = entry.id and confirmed_at is null;
    if found then
      insert into public.brevo_outbox(waitlist_id, kind, payload)
        values(entry.id, 'rebuild_confirmation', jsonb_build_object('token', token));
    end if;
  end if;
  return jsonb_build_object('position', entry.position, 'created', new_signup);
end;
$$;

create function public.rebuild_confirm_waitlist(token text)
returns boolean language plpgsql set search_path = '' as $$
declare
  entry public.waitlist%rowtype;
  digest text;
begin
  if token is null or token !~ '^[a-f0-9]{48}$' then return false; end if;
  digest := encode(sha256(convert_to(token, 'UTF8')), 'hex');
  select * into entry from public.waitlist
    where confirmation_digest = digest or (confirmation_digest is null and confirm_token = token) for update;
  if not found then return false; end if;
  if entry.confirmed_at is not null then return true; end if;
  if entry.confirmation_expires_at < now() then return false; end if;
  update public.waitlist set confirmed_at = now(), confirmation_digest = digest, confirm_token = null where id = entry.id;
  if entry.position <= 500 then
    insert into public.brevo_outbox(waitlist_id, kind, payload) values(entry.id, 'rebuild_founding', '{}');
  end if;
  return true;
end;
$$;

create function public.rebuild_claim_waitlist_jobs(lease uuid, batch integer default 8)
returns table(id bigint, kind text, email text, "position" integer, attempts integer, payload jsonb)
language sql set search_path = '' as $$
  with picked as (
    select o.id from public.brevo_outbox o join public.waitlist w on w.id = o.waitlist_id
    where o.kind in ('rebuild_contact', 'rebuild_confirmation', 'rebuild_founding') and o.synced_at is null
      and o.next_attempt_at <= now() and (o.lease_until is null or o.lease_until < now())
      and (o.kind <> 'rebuild_confirmation' or (w.confirmed_at is null and w.confirmation_expires_at > now()))
    order by o.next_attempt_at, o.id limit least(greatest(batch,1),20) for update of o skip locked
  ), claimed as (
    update public.brevo_outbox as o set lease_id = lease, lease_until = now() + interval '2 minutes', attempts = o.attempts + 1
    from picked where o.id = picked.id returning o.*
  )
  select c.id, c.kind, w.email::text, w.position, c.attempts, c.payload
  from claimed c join public.waitlist w on w.id = c.waitlist_id;
$$;

revoke all on function public.rebuild_join_waitlist(text,text,text,text,text), public.rebuild_confirm_waitlist(text),
  public.rebuild_claim_waitlist_jobs(uuid,integer) from public, anon, authenticated;
grant execute on function public.rebuild_join_waitlist(text,text,text,text,text), public.rebuild_confirm_waitlist(text),
  public.rebuild_claim_waitlist_jobs(uuid,integer) to service_role;
