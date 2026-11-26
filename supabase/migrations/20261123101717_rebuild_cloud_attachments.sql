create table public.rebuild_cloud_attachments (
  id uuid primary key,
  page_id uuid not null,
  workspace_id uuid not null,
  uploaded_by uuid not null,
  filename text not null check (length(filename) between 1 and 180),
  byte_count integer not null check (byte_count between 1 and 50000000),
  state text not null default 'pending' check (state in ('pending', 'ready', 'cleaning')),
  created_at timestamptz not null default now(),
  clean_after timestamptz not null default now() + interval '20 minutes',
  cleanup_claim uuid
);
create index rebuild_attachment_page on public.rebuild_cloud_attachments(page_id, created_at desc) where state = 'ready';
create index rebuild_attachment_workspace on public.rebuild_cloud_attachments(workspace_id);
create index rebuild_attachment_cleanup on public.rebuild_cloud_attachments(clean_after);
alter table public.rebuild_cloud_attachments enable row level security;
revoke all on public.rebuild_cloud_attachments from public, anon, authenticated, service_role;
grant select on public.rebuild_cloud_attachments to service_role;

create function public.rebuild_attachment_upload_limit(target_page uuid, actor uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  page_owner uuid;
  workspace uuid;
  tier_name text;
  billing_status text;
  overdue_at timestamptz;
begin
  select p.owner_id, p.workspace_id into page_owner, workspace from public.pages p where p.id = target_page for share;
  if not found or actor is null then return 0; end if;
  if page_owner <> actor then
    perform 1 from public.page_members m
      where m.page_id = target_page and m.user_id = actor and m.role = 'editor' for share;
    if not found then return 0; end if;
  end if;
  select w.tier, w.status, w.past_due_since into tier_name, billing_status, overdue_at
    from public.workspace_plans w where w.workspace_id = workspace for share;
  if (billing_status = 'past_due' and (overdue_at is null or overdue_at + interval '168 hours' <= now()))
    or (billing_status = 'incomplete' and tier_name <> 'free') then return 0; end if;
  if coalesce(tier_name, 'free') = 'free' then return 2000000; end if;
  return 50000000;
end;
$$;

create function public.rebuild_reserve_attachment(target_page uuid, actor uuid, attachment uuid, name text, file_bytes integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  file_limit integer;
  allocated_bytes bigint;
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
  if file_limit > 2000000 then
    select coalesce(sum(a.byte_count), 0) into allocated_bytes from public.rebuild_cloud_attachments a
      where a.workspace_id = workspace;
    if allocated_bytes + file_bytes > 10000000000 then return 'workspace_limit'; end if;
  end if;
  insert into public.rebuild_cloud_attachments(id, page_id, workspace_id, uploaded_by, filename, byte_count)
    values (attachment, target_page, workspace, actor, name, file_bytes) on conflict do nothing;
  if not found then return 'busy'; end if;
  return 'pending';
end;
$$;

create function public.rebuild_finish_attachment(target_page uuid, actor uuid, attachment uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  file_limit integer := public.rebuild_attachment_upload_limit(target_page, actor);
begin
  update public.rebuild_cloud_attachments a set state = 'ready'
    where a.id = attachment and a.page_id = target_page and a.uploaded_by = actor and a.state = 'pending'
      and a.clean_after > now() and a.byte_count <= file_limit;
  return found;
end;
$$;

create function public.rebuild_remove_attachment(target_page uuid, actor uuid, attachment uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.pages p where p.id = target_page and p.owner_id = actor for share;
  if not found then return false; end if;
  update public.rebuild_cloud_attachments a set state = 'cleaning', clean_after = now(), cleanup_claim = null
    where a.id = attachment and a.page_id = target_page and a.state = 'ready';
  return found;
end;
$$;

create function public.rebuild_claim_attachment_cleanup(batch uuid)
returns table(id uuid, page_id uuid, byte_count integer) language sql security definer set search_path = '' as $$
  with expired as (
    select a.id from public.rebuild_cloud_attachments a
    where a.clean_after <= now() and (a.state <> 'ready' or not exists (select 1 from public.pages p where p.id = a.page_id))
    order by a.clean_after, a.id limit 20 for update skip locked
  )
  update public.rebuild_cloud_attachments a set state = 'cleaning', cleanup_claim = batch, clean_after = now() + interval '10 minutes'
    from expired e where a.id = e.id returning a.id, a.page_id, a.byte_count;
$$;

create function public.rebuild_complete_attachment_cleanup(batch uuid, removed uuid[])
returns void language sql security definer set search_path = '' as $$
  delete from public.rebuild_cloud_attachments a where a.state = 'cleaning' and a.cleanup_claim = batch and a.id = any(removed);
$$;

revoke all on function public.rebuild_attachment_upload_limit(uuid,uuid) from public, anon, authenticated;
revoke all on function public.rebuild_reserve_attachment(uuid,uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.rebuild_finish_attachment(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.rebuild_remove_attachment(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.rebuild_claim_attachment_cleanup(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_complete_attachment_cleanup(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.rebuild_reserve_attachment(uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.rebuild_finish_attachment(uuid,uuid,uuid) to service_role;
grant execute on function public.rebuild_remove_attachment(uuid,uuid,uuid) to service_role;
grant execute on function public.rebuild_claim_attachment_cleanup(uuid) to service_role;
grant execute on function public.rebuild_complete_attachment_cleanup(uuid,uuid[]) to service_role;
