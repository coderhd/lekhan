alter table public.rebuild_cloud_attachments
  add column content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$');

create function public.rebuild_reserve_import_attachment(
  target_page uuid, actor uuid, attachment uuid, name text, file_bytes integer, file_digest text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  prior public.rebuild_cloud_attachments%rowtype;
  file_limit integer;
  decision text;
begin
  if file_digest is null or file_digest !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  select workspace_id into workspace from public.pages where id = target_page for share;
  if not found then return 'denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(workspace::text, 983141));
  file_limit := public.rebuild_attachment_upload_limit(target_page, actor);
  if file_limit = 0 then return 'denied'; end if;
  if file_bytes > file_limit then return 'file_limit'; end if;

  select * into prior from public.rebuild_cloud_attachments where id = attachment and workspace_id = workspace for update;
  if found then
    if prior.page_id is distinct from target_page or prior.uploaded_by is distinct from actor
      or prior.filename is distinct from name or prior.byte_count is distinct from file_bytes
      or prior.content_sha256 is distinct from file_digest then return 'busy'; end if;
    if prior.state = 'ready' then return 'ready'; end if;
    if prior.state <> 'pending' then return 'busy'; end if;
    update public.rebuild_cloud_attachments set clean_after = now() + interval '20 minutes' where id = attachment;
    return 'resume';
  end if;

  decision := public.rebuild_reserve_attachment(target_page, actor, attachment, name, file_bytes);
  if decision = 'ready' then return 'busy'; end if;
  if decision <> 'pending' then return decision; end if;
  update public.rebuild_cloud_attachments set content_sha256 = file_digest where id = attachment;
  return 'pending';
end;
$$;

revoke all on function public.rebuild_reserve_import_attachment(uuid,uuid,uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.rebuild_reserve_import_attachment(uuid,uuid,uuid,text,integer,text) to service_role;
