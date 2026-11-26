create function public.rebuild_link_key(value text)
returns text language sql immutable strict set search_path = '' as $$
  select lower(normalize(btrim(regexp_replace(value, '[[:space:]]+', ' ', 'g'))));
$$;

create index rebuild_pages_workspace_link_title
  on public.pages (workspace_id, public.rebuild_link_key(title));

-- A new link resolves in its source workspace. Preserve an indexed target so
-- that a later rename or a newly created namesake cannot redirect the link.
create function public.rebuild_resolve_page_links(source_page uuid, targets text[])
returns table (target text, page_id uuid)
language sql stable set search_path = '' as $$
  with recursive
  origin as (
    select p.id, p.workspace_id, p.parent_id from public.pages p where p.id = source_page
  ),
  requested as (
    select distinct raw, public.rebuild_link_key(raw) as key,
      regexp_split_to_array(trim(both '/' from btrim(raw)), '[[:space:]]*/[[:space:]]*') as parts
    from unnest(targets[1:4000]) raw
    where octet_length(raw) between 1 and 2048
  ),
  names as (
    select r.raw, r.key, left(btrim(r.raw), 1) = '/' or cardinality(r.parts) > 1 as explicit,
      array(select public.rebuild_link_key(part) from unnest(r.parts) with ordinality s(part, pos) order by pos) as path,
      public.rebuild_link_key(r.parts[cardinality(r.parts)]) as leaf
    from requested r
  ),
  requests as (
    select n.*, regexp_replace(n.leaf, '\.(md|markdown|mdown)$', '') as bare from names n where n.leaf <> ''
  ),
  saved as (
    select r.raw, count(distinct l.to_page_id) as total, min(l.to_page_id::text)::uuid as id
    from requests r cross join origin o
    join public.page_links l on l.from_page_id = o.id
    join public.pages p on p.id = l.to_page_id and p.workspace_id = o.workspace_id
    where public.rebuild_link_key(l.to_title) = r.key
    group by r.raw
  ),
  candidates as (
    select r.raw, r.explicit, r.path, r.bare, p.id,
      case when public.rebuild_link_key(p.title) = r.leaf then 0 else 1 end as extension_rank
    from requests r cross join origin o
    join public.pages p on p.workspace_id = o.workspace_id and public.rebuild_link_key(p.title) in (r.leaf, r.bare)
    where not exists (select 1 from saved s where s.raw = r.raw)
  ),
  seeds as (
    select c.id from candidates c union select o.id from origin o
  ),
  ancestry as (
    select p.id as seed, p.id, p.parent_id, public.rebuild_link_key(p.title) as name,
      array[p.id] as seen, 0 as depth
    from seeds s join public.pages p on p.id = s.id
    union all
    select a.seed, p.id, p.parent_id, public.rebuild_link_key(p.title), a.seen || p.id, a.depth + 1
    from ancestry a join public.pages p on p.id = a.parent_id
    join origin o on p.workspace_id = o.workspace_id
    where a.depth < 127 and not p.id = any(a.seen)
  ),
  paths as (
    select a.seed, array_agg(a.name order by a.depth desc) as parts, bool_or(a.parent_id is null) as rooted,
      max(a.depth) as depth
    from ancestry a group by a.seed
  ),
  distances as (
    select a.seed, min(a.depth + o.depth) as steps
    from ancestry a join ancestry o on o.seed = source_page and o.id = a.id group by a.seed
  ),
  ranked as (
    select c.raw, c.id, dense_rank() over (
      partition by c.raw order by c.extension_rank,
        case when c.explicit then 0 else coalesce(d.steps, p.depth + root.depth + 2) end
    ) as rank
    from candidates c join paths p on p.seed = c.id cross join paths root
    left join distances d on d.seed = c.id
    where root.seed = source_page and (
      not c.explicit or (p.rooted and (
        p.parts = c.path or (c.extension_rank = 1 and p.parts = (c.path[1:cardinality(c.path)-1] || c.bare))
      ))
    )
  ),
  chosen as (
    select r.raw, case when count(*) = 1 then min(r.id::text)::uuid end as id
    from ranked r where r.rank = 1 group by r.raw
  )
  select r.raw, case when s.total = 1 then s.id when s.total is null then c.id end
  from requests r cross join origin o
  left join saved s using (raw) left join chosen c using (raw);
$$;

-- This query runs with the caller's page policies so suggestions cannot name
-- ancestors the caller cannot see. A directly shared page still has its title.
create function public.rebuild_page_link_paths(target_pages uuid[])
returns table (id uuid, path text)
language sql stable set search_path = '' as $$
  with recursive ancestry as (
    select p.id as seed, p.parent_id, p.workspace_id, p.title,
      array[p.title] as names, array[p.id] as seen
    from public.pages p where p.id = any(target_pages[1:48])
    union all
    select a.seed, p.parent_id, a.workspace_id, a.title, p.title || a.names, a.seen || p.id
    from ancestry a join public.pages p on p.id = a.parent_id and p.workspace_id = a.workspace_id
    where cardinality(a.seen) < 128 and not p.id = any(a.seen)
  )
  select distinct on (seed) seed,
    case when parent_id is not null then title
      when cardinality(names) = 1 then '/' || title
      else array_to_string(names, '/') end
  from ancestry order by seed, cardinality(seen) desc;
$$;

revoke all on function public.rebuild_resolve_page_links(uuid, text[]) from public, anon, authenticated;
grant execute on function public.rebuild_resolve_page_links(uuid, text[]) to service_role;
revoke all on function public.rebuild_page_link_paths(uuid[]) from public, anon;
grant execute on function public.rebuild_page_link_paths(uuid[]) to authenticated, service_role;

-- Resolve links under the same lock that replaces the graph projection. Import
-- transactions can supply a known target from the vault's path manifest.
create or replace function public.sync_page_graph(
  p_page_id uuid, p_workspace_id uuid, p_searchable_text text, p_links jsonb, p_tags jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare
  resolved jsonb;
  link_count integer;
  tag_count integer;
begin
  perform 1 from public.pages p where p.id = p_page_id and p.workspace_id = p_workspace_id for update;
  if not found then return jsonb_build_object('links', 0, 'tags', 0); end if;

  with inputs as (
    select l.to_title, valid.id as to_page_id
    from jsonb_to_recordset(p_links) l(to_title text, to_page_id uuid)
    left join public.pages valid on valid.id = l.to_page_id and valid.workspace_id = p_workspace_id
  ), targets as (
    select array_agg(i.to_title) as names from inputs i where i.to_page_id is null
  ), choices as materialized (
    select choice.* from targets t cross join lateral public.rebuild_resolve_page_links(p_page_id, t.names) choice
  )
  select coalesce(jsonb_agg(jsonb_build_object('to_title', i.to_title, 'to_page_id', coalesce(i.to_page_id, choice.page_id))), '[]'::jsonb)
    into resolved
    from inputs i left join choices choice on choice.target = i.to_title;

  delete from public.page_links where from_page_id = p_page_id;
  insert into public.page_links (workspace_id, from_page_id, to_page_id, to_title)
    select p_workspace_id, p_page_id, l.to_page_id, l.to_title
    from jsonb_to_recordset(resolved) l(to_title text, to_page_id uuid);
  get diagnostics link_count = row_count;

  delete from public.page_tags where page_id = p_page_id;
  insert into public.page_tags (page_id, tag)
    select p_page_id, t.tag from jsonb_to_recordset(p_tags) t(tag text);
  get diagnostics tag_count = row_count;

  update public.pages set searchable_text = p_searchable_text, updated_at = now() where id = p_page_id;
  return jsonb_build_object('links', link_count, 'tags', tag_count);
end;
$$;

revoke all on function public.sync_page_graph(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_page_graph(uuid, uuid, text, jsonb, jsonb) to service_role;

create index rebuild_page_links_incoming on public.page_links (to_page_id, from_page_id);

-- A share on the destination does not grant access to the pages that link to it.
create function public.rebuild_page_backlinks(target_page uuid, after_page uuid)
returns table (id uuid, title text)
language sql stable set search_path = '' as $$
  select p.id, p.title from public.pages p
  where (after_page is null or p.id > after_page) and p.id <> target_page
    and (p.owner_id = auth.uid() or exists (
      select 1 from public.page_members m where m.page_id = p.id and m.user_id = auth.uid() and m.role in ('editor', 'viewer')
    ))
    and exists (
      select 1 from public.pages destination where destination.id = target_page
        and (destination.owner_id = auth.uid() or exists (
          select 1 from public.page_members m where m.page_id = target_page and m.user_id = auth.uid() and m.role in ('editor', 'viewer')
        ))
    )
    and exists (select 1 from public.page_links l where l.to_page_id = target_page and l.from_page_id = p.id)
  order by p.id limit 25;
$$;

revoke all on function public.rebuild_page_backlinks(uuid, uuid) from public, anon;
grant execute on function public.rebuild_page_backlinks(uuid, uuid) to authenticated;
