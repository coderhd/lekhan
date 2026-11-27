alter table public.import_batches add column if not exists payload_hash text;
alter table public.import_batches add column if not exists first_ordinal integer;

create table public.cloud_import_pages (
  page_id uuid primary key references public.pages(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_id uuid not null,
  path_key text not null,
  unique (workspace_id, import_id, path_key)
);
alter table public.cloud_import_pages enable row level security;
revoke all on public.cloud_import_pages from public, anon, authenticated;
grant select, insert on public.cloud_import_pages to service_role;

create function public.rebuild_import_batch(
  target_workspace uuid, actor uuid, attempt uuid, batch_number integer, first_page integer,
  digest text, rows_to_import jsonb default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  ledger public.import_batches%rowtype;
  entry jsonb;
  page uuid;
  parent uuid;
  resolved_links jsonb;
  received jsonb := '[]'::jsonb;
  new_pages uuid[] := '{}';
begin
  if digest is null or digest !~ '^[a-f0-9]{64}$' or batch_number not between 0 and 1999
    or first_page not between 0 and 1999 or batch_number = 0 and first_page <> 0 then
    raise exception 'invalid_import';
  end if;
  perform 1 from public.workspaces where id = target_workspace and owner_id = actor for update;
  if not found then raise exception 'import_workspace_not_found'; end if;

  if batch_number > 0 and not exists (select 1 from public.import_batches previous
    where previous.workspace_id = target_workspace and previous.client_import_id = attempt
      and previous.batch_index = batch_number - 1 and previous.status = 'completed'
      and previous.first_ordinal + previous.imported_count = first_page) then
    raise exception 'import_batch_out_of_order';
  end if;

  insert into public.import_batches (workspace_id, owner_id, client_import_id, batch_index, first_ordinal, payload_hash)
  values (target_workspace, actor, attempt, batch_number, first_page, digest)
  on conflict (workspace_id, client_import_id, batch_index) do nothing;

  select * into ledger from public.import_batches
    where workspace_id = target_workspace and client_import_id = attempt and batch_index = batch_number
    for update;
  if ledger.owner_id is distinct from actor or ledger.payload_hash is distinct from digest or ledger.first_ordinal is distinct from first_page then
    raise exception 'import_payload_changed';
  end if;
  if ledger.status = 'completed' then
    return jsonb_build_object('replayed', true, 'importedCount', ledger.imported_count, 'pages', ledger.pages);
  end if;
  if rows_to_import is null then return null; end if;
  if jsonb_typeof(rows_to_import) <> 'array' or jsonb_array_length(rows_to_import) not between 1 and 50 then
    raise exception 'invalid_import';
  end if;

  for entry in select value from jsonb_array_elements(rows_to_import) loop
    page := (entry->>'id')::uuid;
    parent := (entry->>'parent')::uuid;
    if parent is not null and not exists (select 1 from public.cloud_import_pages p where p.page_id = parent
      and p.workspace_id = target_workspace and p.import_id = attempt) then
      raise exception 'import_parent_missing';
    end if;
    insert into public.pages (id, workspace_id, owner_id, parent_id, title, properties)
      values (page, target_workspace, actor, parent, entry->>'title', coalesce(entry->'properties', '{}'::jsonb))
      on conflict (id) do nothing;
    if found then
      insert into public.cloud_import_pages (page_id, workspace_id, import_id, path_key)
        values (page, target_workspace, attempt, entry->>'pathKey');
      new_pages := array_append(new_pages, page);
    elsif not exists (select 1 from public.cloud_import_pages p where p.page_id = page
      and p.workspace_id = target_workspace and p.import_id = attempt and p.path_key = entry->>'pathKey') then
      raise exception 'import_payload_changed';
    end if;
    received := received || jsonb_build_object('id', page, 'title', entry->>'title');
  end loop;

  for entry in select value from jsonb_array_elements(rows_to_import) loop
    page := (entry->>'id')::uuid;
    if not page = any(new_pages) then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('to_title', link.value, 'to_page_id', coalesce(vault.page_id, existing.page_id))), '[]'::jsonb)
      into resolved_links
      from jsonb_array_elements_text(entry->'links') link
      left join public.cloud_import_pages vault on vault.workspace_id = target_workspace and vault.import_id = attempt
        and vault.path_key = lower(normalize(trim(both '/' from btrim(link.value))))
      left join lateral (
        select case when count(*) = 1 then min(p.id::text)::uuid end as page_id from public.pages p
        where p.workspace_id = target_workspace and lower(p.title) = lower(link.value)
      ) existing on vault.page_id is null and position('/' in link.value) = 0;
    perform public.sync_page_graph(page, target_workspace, entry->>'text', resolved_links, entry->'tags');
  end loop;

  update public.page_links l set to_page_id = target.page_id
    from public.cloud_import_pages source, public.cloud_import_pages target
    where target.page_id = any(new_pages) and source.page_id = l.from_page_id and l.to_page_id is null
      and source.workspace_id = target_workspace and target.workspace_id = target_workspace
      and source.import_id = attempt and target.import_id = attempt
      and lower(normalize(trim(both '/' from btrim(l.to_title)))) = target.path_key;

  update public.import_batches set status = 'completed', imported_count = jsonb_array_length(received),
    pages = received, updated_at = now() where id = ledger.id;
  update public.import_batches set updated_at = now()
    where workspace_id = target_workspace and client_import_id = attempt and id <> ledger.id;
  return jsonb_build_object('replayed', cardinality(new_pages) = 0, 'importedCount', jsonb_array_length(received), 'pages', received);
end;
$$;

revoke all on function public.rebuild_import_batch(uuid, uuid, uuid, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.rebuild_import_batch(uuid, uuid, uuid, integer, integer, text, jsonb) to service_role;
