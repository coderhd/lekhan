create table public.rebuild_page_media_usage (
  page_id uuid primary key,
  workspace_id uuid not null,
  image_bytes bigint not null check (image_bytes >= 0),
  reserved_bytes bigint not null check (reserved_bytes >= image_bytes),
  import_hold_until timestamptz
);
create index rebuild_page_media_workspace on public.rebuild_page_media_usage(workspace_id);
alter table public.rebuild_page_media_usage enable row level security;
revoke all on public.rebuild_page_media_usage from public, anon, authenticated, service_role;

create function public.rebuild_workspace_reserved_media(target_workspace uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(a.byte_count) from public.rebuild_cloud_attachments a where a.workspace_id = target_workspace), 0)
    + coalesce((select sum(m.reserved_bytes) from public.rebuild_page_media_usage m
      where m.workspace_id = target_workspace and (m.import_hold_until > now()
        or exists (select 1 from public.pages p where p.id = m.page_id and p.workspace_id = target_workspace))), 0);
$$;

create function public.rebuild_reserve_page_images(target_workspace uuid, requested jsonb, importing boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid := target_workspace;
  tier_name text;
  growth bigint;
begin
  if jsonb_typeof(requested) is distinct from 'array' or importing is null then raise exception 'invalid_media_request'; end if;
  if jsonb_array_length(requested) not between 1 and 50 or exists (
    select 1 from jsonb_to_recordset(requested) r(page uuid, bytes bigint)
    where r.page is null or r.bytes is null or r.bytes not between 0 and 67108864
  ) or (select count(distinct page) from jsonb_to_recordset(requested) r(page uuid, bytes bigint)) <> jsonb_array_length(requested)
    then raise exception 'invalid_media_request'; end if;
  if workspace is null and not importing then
    select p.workspace_id into workspace from public.pages p where p.id = (requested->0->>'page')::uuid;
  end if;
  if workspace is null or exists (select 1 from jsonb_to_recordset(requested) r(page uuid, bytes bigint)
    left join public.pages p on p.id = r.page where (not importing and p.id is null) or (p.id is not null and p.workspace_id <> workspace)) then
    raise exception 'invalid_media_workspace';
  end if;
  -- The file-upload reservation uses the same lock and counts these reservations.
  perform pg_advisory_xact_lock(hashtextextended(workspace::text, 983141));
  if exists (select 1 from jsonb_to_recordset(requested) r(page uuid, bytes bigint)
    join public.rebuild_page_media_usage m on m.page_id = r.page where m.workspace_id <> workspace) then
    raise exception 'invalid_media_workspace';
  end if;
  delete from public.rebuild_page_media_usage m where m.workspace_id = workspace and coalesce(m.import_hold_until, '-infinity') <= now()
    and not exists (select 1 from public.pages p where p.id = m.page_id and p.workspace_id = workspace);
  select tier into tier_name from public.workspace_plans where workspace_id = workspace for share;
  select coalesce(sum(greatest(r.bytes - coalesce(m.reserved_bytes, 0), 0)), 0) into growth
    from jsonb_to_recordset(requested) r(page uuid, bytes bigint)
    left join public.rebuild_page_media_usage m on m.page_id = r.page and m.workspace_id = workspace;
  if coalesce(tier_name, 'free') <> 'free' and growth > 0
    and public.rebuild_workspace_reserved_media(workspace) + growth > 10000000000 then return false; end if;

  insert into public.rebuild_page_media_usage(page_id, workspace_id, image_bytes, reserved_bytes, import_hold_until)
    select r.page, workspace, case when importing then r.bytes else 0 end, r.bytes,
      case when importing then now() + interval '30 minutes' else null end
    from jsonb_to_recordset(requested) r(page uuid, bytes bigint)
  on conflict (page_id) do update set
    reserved_bytes = greatest(public.rebuild_page_media_usage.reserved_bytes, excluded.reserved_bytes),
    import_hold_until = coalesce(excluded.import_hold_until, public.rebuild_page_media_usage.import_hold_until)
  where public.rebuild_page_media_usage.workspace_id = excluded.workspace_id;
  return true;
end;
$$;

create function public.rebuild_record_page_images(target_page uuid, observed_bytes bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare workspace uuid;
begin
  if observed_bytes is null or observed_bytes not between 0 and 67108864 then raise exception 'invalid_media_request'; end if;
  select p.workspace_id into workspace from public.pages p where p.id = target_page for share;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(workspace::text, 983141));
  if observed_bytes = 0 then
    delete from public.rebuild_page_media_usage m where m.page_id = target_page;
  else
    insert into public.rebuild_page_media_usage(page_id, workspace_id, image_bytes, reserved_bytes)
      values (target_page, workspace, observed_bytes, observed_bytes)
    on conflict (page_id) do update set workspace_id = excluded.workspace_id,
      image_bytes = excluded.image_bytes, reserved_bytes = excluded.reserved_bytes, import_hold_until = null;
  end if;
end;
$$;

create function public.rebuild_workspace_media_summary(target_workspace uuid, actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('image_bytes', coalesce((select sum(m.image_bytes)
    from public.rebuild_page_media_usage m join public.pages p on p.id = m.page_id and p.workspace_id = m.workspace_id
    where m.workspace_id = w.id), 0),
    'file_bytes', coalesce((select sum(a.byte_count) from public.rebuild_cloud_attachments a
      join public.pages p on p.id = a.page_id and p.workspace_id = a.workspace_id
      where a.workspace_id = w.id and a.state = 'ready'), 0))
  from public.workspaces w where w.id = target_workspace and w.owner_id = actor;
$$;

create or replace function public.rebuild_reserve_attachment(target_page uuid, actor uuid, attachment uuid, name text, file_bytes integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  file_limit integer;
begin
  if attachment is null or name is null or length(name) not between 1 and 180
    or name ~ '[[:cntrl:]/]' or position(chr(92) in name) > 0 or btrim(name) = ''
    or file_bytes is null or file_bytes < 1 then return 'invalid'; end if;
  select workspace_id into workspace from public.pages where id = target_page for share;
  if not found then return 'denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(workspace::text, 983141));
  file_limit := public.rebuild_attachment_upload_limit(target_page, actor);
  if file_limit = 0 then return 'denied'; end if;
  if file_bytes > file_limit then return 'file_limit'; end if;
  if exists (select 1 from public.rebuild_cloud_attachments a where a.id = attachment
    and a.page_id = target_page and a.uploaded_by = actor and a.state = 'ready'
    and a.filename = name and a.byte_count = file_bytes) then return 'ready'; end if;
  if file_limit > 2000000 and public.rebuild_workspace_reserved_media(workspace) + file_bytes > 10000000000 then
    return 'workspace_limit';
  end if;
  insert into public.rebuild_cloud_attachments(id, page_id, workspace_id, uploaded_by, filename, byte_count)
    values (attachment, target_page, workspace, actor, name, file_bytes) on conflict do nothing;
  if not found then return 'busy'; end if;
  return 'pending';
end;
$$;

revoke all on function public.rebuild_workspace_reserved_media(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_reserve_page_images(uuid,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.rebuild_record_page_images(uuid,bigint) from public, anon, authenticated;
revoke all on function public.rebuild_workspace_media_summary(uuid,uuid) from public, anon, authenticated;
grant execute on function public.rebuild_reserve_page_images(uuid,jsonb,boolean) to service_role;
grant execute on function public.rebuild_record_page_images(uuid,bigint) to service_role;
grant execute on function public.rebuild_workspace_media_summary(uuid,uuid) to service_role;
