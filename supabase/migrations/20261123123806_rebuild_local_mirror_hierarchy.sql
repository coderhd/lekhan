create table public.rebuild_local_note_mirrors (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  notebook_id uuid not null,
  local_key text not null,
  parent_key text,
  page_id uuid not null unique references public.pages(id) on delete cascade,
  placed boolean not null default false,
  primary key (workspace_id, notebook_id, local_key)
);
alter table public.rebuild_local_note_mirrors enable row level security;
revoke all on public.rebuild_local_note_mirrors from public, anon, authenticated, service_role;

create function public.rebuild_import_local_note(
  target_workspace uuid, actor uuid, attempt uuid, batch_number int, first_page int, digest text,
  requested_image_policy text, local_note jsonb, rows_to_import jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  notebook uuid := (local_note->>'notebook')::uuid;
  note_key text := local_note->>'key';
  local_parent text := local_note->>'parent';
  known_pages jsonb := local_note->'known';
  receipt jsonb;
  existing_page record;
  placement record;
begin
  if notebook is null or note_key is null or note_key !~ '^[A-Za-z0-9_-]{1,96}$' or local_parent = note_key
    or (local_parent is not null and local_parent !~ '^[A-Za-z0-9_-]{1,96}$') or batch_number <> 0 or first_page <> 0
    or jsonb_typeof(known_pages) is distinct from 'array' or jsonb_array_length(known_pages) > 2000
    or (rows_to_import is not null and (jsonb_array_length(rows_to_import) <> 1 or rows_to_import->0->>'parent' is not null)) then
    raise exception 'invalid_import';
  end if;
  perform 1 from public.workspaces where id = target_workspace and owner_id = actor for update;
  if not found then raise exception 'import_workspace_not_found'; end if;

  select p.id, p.title into existing_page
    from public.rebuild_local_note_mirrors m join public.pages p on p.id = m.page_id
    where m.workspace_id = target_workspace and m.notebook_id = notebook and m.local_key = note_key
      and p.workspace_id = target_workspace and p.owner_id = actor;
  if found then
    return jsonb_build_object('replayed', true, 'importedCount', 1,
      'pages', jsonb_build_array(jsonb_build_object('id', existing_page.id, 'title', existing_page.title)));
  end if;

  receipt := public.rebuild_import_batch(target_workspace, actor, attempt, batch_number, first_page,
    digest, rows_to_import, requested_image_policy);
  if receipt is null then return null; end if;

  insert into public.rebuild_local_note_mirrors (workspace_id, notebook_id, local_key, parent_key, page_id)
    values (target_workspace, notebook, note_key, local_parent, (receipt->'pages'->0->>'id')::uuid);

  -- Earlier clients stored only the cloud page ID locally. Adopt related pages
  -- after checking their current owner and workspace.
  insert into public.rebuild_local_note_mirrors (workspace_id, notebook_id, local_key, parent_key, page_id)
    select target_workspace, notebook, k.key, k.parent, p.id
    from jsonb_to_recordset(known_pages) k(key text, parent text, page uuid)
    join public.pages p on p.id = k.page and p.workspace_id = target_workspace and p.owner_id = actor
    where k.key ~ '^[A-Za-z0-9_-]{1,96}$' and k.key <> note_key and (k.parent is null or
      (k.parent ~ '^[A-Za-z0-9_-]{1,96}$' and k.key <> k.parent)) and (k.key = local_parent or k.parent = note_key)
    on conflict do nothing;

  for placement in
    select child.page_id as child, parent.page_id as parent
    from public.rebuild_local_note_mirrors child
    join public.rebuild_local_note_mirrors parent on parent.workspace_id = child.workspace_id
      and parent.notebook_id = child.notebook_id and parent.local_key = child.parent_key
    join public.pages cp on cp.id = child.page_id and cp.owner_id = actor and cp.workspace_id = target_workspace
    join public.pages pp on pp.id = parent.page_id and pp.owner_id = actor and pp.workspace_id = target_workspace
    where child.workspace_id = target_workspace and child.notebook_id = notebook and not child.placed
  loop
    update public.pages p set parent_id = placement.parent
      where p.id = placement.child and p.parent_id is null and not exists (
        with recursive ancestors(id, parent_id) as (
          select id, parent_id from public.pages where id = placement.parent
          union
          select p2.id, p2.parent_id from public.pages p2 join ancestors a on p2.id = a.parent_id
        )
        select 1 from ancestors where id = placement.child
      );
    update public.rebuild_local_note_mirrors set placed = true where page_id = placement.child;
  end loop;
  return receipt;
end;
$$;

revoke all on function public.rebuild_import_local_note(uuid,uuid,uuid,int,int,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.rebuild_import_local_note(uuid,uuid,uuid,int,int,text,text,jsonb,jsonb) to service_role;
