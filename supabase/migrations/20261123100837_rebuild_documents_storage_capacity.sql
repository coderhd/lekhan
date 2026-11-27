-- Reserve growth before starting a Storage API upload. Include the rest of the
-- bucket in the measurement so legacy objects also count toward the ceiling.
create table public.rebuild_document_upload_leases (
  object_path text primary key,
  lease_id uuid not null unique,
  target_bytes bigint not null check (target_bytes > 0),
  expires_at timestamptz not null
);

alter table public.rebuild_document_upload_leases enable row level security;
revoke all on public.rebuild_document_upload_leases from public, anon, authenticated, service_role;

create function public.rebuild_reserve_document_upload(
  target_path text, proposed_lease uuid, proposed_bytes bigint, ceiling_bytes bigint, replace_existing boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actual_path_bytes bigint;
  total_bytes numeric;
  now_at timestamptz;
begin
  if target_path is null or length(target_path) > 120 or target_path !~*
      '^[0-9a-f-]{36}/(main_state[.]bin|versions/[0-9a-f-]{36}[.]bin|attachments/[0-9a-f-]{36}/[0-9]{1,3}[.]bin)$'
    or proposed_lease is null or proposed_bytes is null or proposed_bytes < 1 or proposed_bytes > 67108900
    or ceiling_bytes is null or ceiling_bytes < 1 or replace_existing is null then
    raise exception 'invalid_document_upload';
  end if;

  perform pg_advisory_xact_lock(935285, 1);
  now_at := clock_timestamp();
  delete from public.rebuild_document_upload_leases l where l.expires_at <= now_at;
  select case when (o.metadata ->> 'size') ~ '^[0-9]{1,18}$' then (o.metadata ->> 'size')::bigint else 0 end
    into actual_path_bytes
    from storage.objects o where o.bucket_id = 'documents' and o.name = target_path;
  if found and not replace_existing then return 'exists'; end if;
  actual_path_bytes := coalesce(actual_path_bytes, 0);
  if exists (select 1 from public.rebuild_document_upload_leases l where l.object_path = target_path) then
    return 'busy';
  end if;

  if proposed_bytes > actual_path_bytes then
    with sizes as materialized (
      select o.name, case when (o.metadata ->> 'size') ~ '^[0-9]{1,18}$' then (o.metadata ->> 'size')::bigint else 0 end as bytes
      from storage.objects o where o.bucket_id = 'documents'
    )
    select coalesce((select sum(s.bytes) from sizes s), 0) +
      coalesce((select sum(greatest(l.target_bytes - coalesce(s.bytes, 0), 0))
        from public.rebuild_document_upload_leases l left join sizes s on s.name = l.object_path), 0)
      into total_bytes;
    if total_bytes + proposed_bytes - actual_path_bytes > ceiling_bytes then return 'full'; end if;
  end if;

  insert into public.rebuild_document_upload_leases(object_path, lease_id, target_bytes, expires_at)
    values (target_path, proposed_lease, proposed_bytes, now_at + interval '10 minutes');
  return 'reserved';
end;
$$;

create function public.rebuild_release_document_upload(completed_lease uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.rebuild_document_upload_leases where lease_id = completed_lease;
$$;

revoke all on function public.rebuild_reserve_document_upload(text,uuid,bigint,bigint,boolean) from public, anon, authenticated;
revoke all on function public.rebuild_release_document_upload(uuid) from public, anon, authenticated;
grant execute on function public.rebuild_reserve_document_upload(text,uuid,bigint,bigint,boolean) to service_role;
grant execute on function public.rebuild_release_document_upload(uuid) to service_role;

-- The rebuild only uploads through its server routes and relay. A permissive
-- legacy policy must not let browser credentials bypass the reservation.
create policy rebuild_reserve_documents_before_insert on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'documents');

create policy rebuild_reserve_documents_before_update on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'documents') with check (bucket_id <> 'documents');
