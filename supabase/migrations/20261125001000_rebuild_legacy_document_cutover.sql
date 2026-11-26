create table public.rebuild_legacy_page_cutovers (
  document_id uuid primary key,
  page_id uuid not null,
  recorded_at timestamptz not null default now()
);
alter table public.rebuild_legacy_page_cutovers enable row level security;
revoke all on public.rebuild_legacy_page_cutovers from public, anon, authenticated, service_role;

-- Record a retired mapping even when the legacy document is still present.
-- A retry must not restore the old title, publication, or access after removal.
create function public.rebuild_remember_legacy_page()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rebuild_legacy_page_cutovers(document_id, page_id) values (old.source_document_id, old.id)
    on conflict (document_id) do nothing;
  return null;
end;
$$;
revoke all on function public.rebuild_remember_legacy_page() from public, anon, authenticated;
create trigger rebuild_remember_deleted_legacy_page
  after delete on public.pages for each row when (old.source_document_id is not null)
  execute function public.rebuild_remember_legacy_page();
create trigger rebuild_remember_detached_legacy_page
  after update of source_document_id on public.pages for each row
  when (old.source_document_id is not null and old.source_document_id is distinct from new.source_document_id)
  execute function public.rebuild_remember_legacy_page();

-- Keep the old client's fallback available for documents waiting for cutover.
-- After mapping, only current page authority may expose the retained copy.
create function public.rebuild_legacy_document_visible(legacy_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when count(*) > 0
    then count(*) = 1 and bool_or(p.is_public or p.owner_id = auth.uid() or exists (
        select 1 from public.page_members m where m.page_id = p.id and m.user_id = auth.uid() and m.role in ('editor', 'viewer')
      ))
    else not exists (select 1 from public.rebuild_legacy_page_cutovers c where c.document_id = legacy_id)
    end
  from public.pages p where p.source_document_id = legacy_id;
$$;
revoke all on function public.rebuild_legacy_document_visible(uuid) from public;
grant execute on function public.rebuild_legacy_document_visible(uuid) to anon, authenticated;

create policy rebuild_legacy_document_page_authority on public.documents
  as restrictive for select to anon, authenticated using (public.rebuild_legacy_document_visible(id));
create policy rebuild_legacy_checkpoint_page_authority on public.document_versions
  as restrictive for select to anon, authenticated
  using (document_id is null or public.rebuild_legacy_document_visible(document_id));
create policy rebuild_legacy_storage_page_authority on storage.objects
  as restrictive for select to anon, authenticated using (
    case when bucket_id = 'documents' and split_part(name, '/', 1) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then public.rebuild_legacy_document_visible(split_part(name, '/', 1)::uuid)
      else true end
  );

create index rebuild_legacy_version_document on public.document_versions(document_id) where document_id is not null;
create index rebuild_pending_document_invite on public.document_invitations(document_id) where status = 'pending';
create index rebuild_pending_document_invite_token on public.document_invitations(token) where status = 'pending';
create index rebuild_page_invite_token on public.page_invitations(token);

create function public.rebuild_migrate_legacy_documents(after_document uuid, batch_limit integer, apply_changes boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  document uuid;
  legacy public.documents%rowtype;
  current_page public.pages%rowtype;
  workspace uuid;
  prior_page uuid;
  mappings integer;
  reason text;
  creating boolean;
  invitation_count integer;
  valid_invitation_count integer;
  moved integer;
  last_document uuid;
  scanned integer := 0;
  created_pages integer := 0;
  moved_checkpoints integer := 0;
  copied_invitations integer := 0;
  retained_cutovers integer := 0;
  conflicts jsonb := '[]'::jsonb;
begin
  if batch_limit is null or batch_limit not between 1 and 100 or apply_changes is null then
    raise exception 'invalid_legacy_cutover_batch';
  end if;

  for document in select d.id from public.documents d
    where after_document is null or d.id > after_document
    order by d.id limit batch_limit
  loop
    last_document := document;
    scanned := scanned + 1;
    if apply_changes then
      select d.* into legacy from public.documents d where d.id = document for update;
    else
      select d.* into legacy from public.documents d where d.id = document;
    end if;
    if not found then continue; end if;
    if apply_changes then
      select p.* into current_page from public.pages p where p.id = document for update;
    else
      select p.* into current_page from public.pages p where p.id = document;
    end if;
    creating := not found;
    select count(*) into mappings from public.pages p where p.source_document_id = legacy.id;
    select m.page_id into prior_page from public.rebuild_legacy_page_cutovers m where m.document_id = legacy.id;
    reason := case
      when creating and mappings > 0 then 'different_page_id'
      when not creating and (current_page.source_document_id is distinct from legacy.id or current_page.owner_id <> legacy.owner_id)
        then 'page_id_occupied'
      when not creating and mappings <> 1 then 'duplicate_mapping'
      when prior_page is not null and prior_page <> legacy.id then 'different_page_id'
      else null end;
    if reason is not null then
      conflicts := conflicts || jsonb_build_object('document', legacy.id, 'reason', reason);
      continue;
    end if;
    if creating and prior_page is not null then
      retained_cutovers := retained_cutovers + 1;
      continue;
    end if;

    if creating then
      if apply_changes then
        perform 1 from public.document_members m where m.document_id = legacy.id for share;
        perform 1 from public.document_invitations i where i.document_id = legacy.id for share;
      end if;
      if exists (select 1 from public.document_members m where m.document_id = legacy.id
        and m.user_id <> legacy.owner_id and m.role not in ('editor', 'viewer')) then
        conflicts := conflicts || jsonb_build_object('document', legacy.id, 'reason', 'legacy_member_role_needs_review');
        continue;
      end if;
      -- These are the only tokens that can be carried into a new page. Page
      -- authority for an existing mapping is never restored from documents.
      select count(*), count(*) filter (where i.inviter_id = legacy.owner_id
          and i.role in ('editor', 'viewer')
          and not exists (select 1 from public.page_invitations existing where existing.token = i.token)
          and not exists (select 1 from public.document_invitations other where other.token = i.token
            and other.id <> i.id and other.status = 'pending'))
        into invitation_count, valid_invitation_count
        from public.document_invitations i where i.document_id = legacy.id and i.status = 'pending';
      if invitation_count <> valid_invitation_count then
        conflicts := conflicts || jsonb_build_object('document', legacy.id, 'reason', 'legacy_invitation_needs_review');
        continue;
      end if;

      if apply_changes then
        insert into public.workspaces(owner_id) values (legacy.owner_id) on conflict (owner_id) do nothing;
        select w.id into strict workspace from public.workspaces w where w.owner_id = legacy.owner_id;
        insert into public.pages(id, workspace_id, title, owner_id, is_public, searchable_text, source_document_id, created_at, updated_at)
          values (legacy.id, workspace, legacy.title, legacy.owner_id, legacy.is_public, legacy.searchable_text,
            legacy.id, legacy.created_at, legacy.updated_at)
          on conflict (id) do nothing;
        if not found then
          conflicts := conflicts || jsonb_build_object('document', legacy.id, 'reason', 'page_id_occupied');
          continue;
        end if;
        insert into public.page_members(page_id, user_id, role, created_at)
          select legacy.id, m.user_id, m.role, m.created_at from public.document_members m
          where m.document_id = legacy.id and m.user_id <> legacy.owner_id and m.role in ('editor', 'viewer');
        insert into public.page_invitations(page_id, inviter_id, invitee_email, role, token, status, created_at)
          select legacy.id, i.inviter_id, i.invitee_email, i.role, i.token, i.status, i.created_at
          from public.document_invitations i where i.document_id = legacy.id and i.status = 'pending';
      end if;
      created_pages := created_pages + 1;
      copied_invitations := copied_invitations + valid_invitation_count;
    end if;

    if apply_changes then
      insert into public.rebuild_legacy_page_cutovers(document_id, page_id) values (legacy.id, legacy.id)
        on conflict (document_id) do nothing;
      update public.document_versions v set document_id = null, page_id = legacy.id
        where v.document_id = legacy.id;
      get diagnostics moved = row_count;
    else
      select count(*) into moved from public.document_versions v where v.document_id = legacy.id;
    end if;
    moved_checkpoints := moved_checkpoints + moved;
  end loop;

  return jsonb_build_object(
    'lastDocument', last_document, 'scanned', scanned, 'createdPages', created_pages,
    'movedCheckpoints', moved_checkpoints, 'copiedInvitations', copied_invitations,
    'retainedCutovers', retained_cutovers, 'conflicts', conflicts
  );
end;
$$;
revoke all on function public.rebuild_migrate_legacy_documents(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.rebuild_migrate_legacy_documents(uuid, integer, boolean) to service_role;
