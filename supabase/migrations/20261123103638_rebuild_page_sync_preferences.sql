create table public.rebuild_page_sync_pauses (
  page_id uuid primary key references public.pages(id) on delete cascade
);
alter table public.rebuild_page_sync_pauses enable row level security;
revoke all on public.rebuild_page_sync_pauses from public, anon, authenticated, service_role;

create function public.rebuild_page_sync_preference(target_page uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(w.tier, 'free') <> 'free' then 'paid'
    when p.is_public or exists (select 1 from public.page_members m where m.page_id = p.id and m.user_id <> p.owner_id)
      or exists (select 1 from public.page_invitations i where i.page_id = p.id and i.status = 'pending') then 'shared'
    when exists (select 1 from public.rebuild_page_sync_pauses o where o.page_id = p.id) then 'paused'
    else 'personal' end
  from public.pages p left join public.workspace_plans w on w.workspace_id = p.workspace_id where p.id = target_page;
$$;

create function public.rebuild_set_page_sync(target_page uuid, actor uuid, enabled boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  workspace uuid;
  mode text;
begin
  select p.workspace_id into workspace from public.pages p where p.id = target_page and p.owner_id = actor for update;
  if not found or enabled is null then return 'denied'; end if;
  perform 1 from public.workspace_plans where workspace_id = workspace for share;
  mode := public.rebuild_page_sync_preference(target_page);
  if mode in ('shared','paid') then return mode; end if;
  if enabled then
    delete from public.rebuild_page_sync_pauses where page_id = target_page;
    return 'personal';
  end if;
  insert into public.rebuild_page_sync_pauses(page_id) values (target_page) on conflict do nothing;
  return 'paused';
end;
$$;

revoke all on function public.rebuild_page_sync_preference(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_set_page_sync(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.rebuild_page_sync_preference(uuid) to service_role;
grant execute on function public.rebuild_set_page_sync(uuid,uuid,boolean) to service_role;
