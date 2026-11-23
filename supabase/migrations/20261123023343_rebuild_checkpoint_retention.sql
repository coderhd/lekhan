create table public.rebuild_checkpoint_retention_claims (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  batch_id uuid not null,
  leased_until timestamptz not null
);
alter table public.rebuild_checkpoint_retention_claims enable row level security;
revoke all on public.rebuild_checkpoint_retention_claims from public, anon, authenticated;

create index if not exists rebuild_checkpoints_by_age on public.document_versions(created_at, id);

-- Cutoffs are calculated from the same plan limits used to read history.
-- Keep checkpoints whose parent workspace cannot be resolved.
create function public.rebuild_claim_checkpoint_retention(
  batch uuid, batch_size int, free_before timestamptz, plus_before timestamptz,
  pro_before timestamptz, team_before timestamptz
) returns table(version_id uuid, entity_id uuid)
language sql security definer set search_path = '' as $$
  with expired as (
    select v.id, coalesce(v.page_id, v.document_id) as entity
    from public.document_versions v
    left join public.pages p on p.id = v.page_id
    left join public.documents d on d.id = v.document_id and v.page_id is null
    left join public.workspaces legacy on legacy.owner_id = d.owner_id
    left join public.workspace_plans plan on plan.workspace_id = coalesce(p.workspace_id, legacy.id)
    left join public.rebuild_checkpoint_retention_claims c on c.version_id = v.id
    where coalesce(p.workspace_id, legacy.id) is not null
      and v.created_at < free_before
      and v.created_at < case coalesce(plan.tier, 'free')
        when 'free' then free_before when 'plus' then plus_before
        when 'pro' then pro_before when 'team' then team_before end
      and (c.leased_until is null or c.leased_until <= now())
    order by v.created_at, v.id limit greatest(0, least(batch_size, 100))
    for update of v skip locked
  ), claims as (
    insert into public.rebuild_checkpoint_retention_claims as current(version_id, batch_id, leased_until)
      select id, batch, now() + interval '10 minutes' from expired
      on conflict (version_id) do update set batch_id = excluded.batch_id, leased_until = excluded.leased_until
        where current.leased_until <= now()
      returning current.version_id
  )
  select claims.version_id, expired.entity from claims join expired on expired.id = claims.version_id;
$$;

-- Called only after the corresponding Storage removal succeeds. Failed
-- removals leave their metadata available for the next attempt.
create function public.rebuild_complete_checkpoint_retention(batch uuid, removed_versions uuid[])
returns int language sql security definer set search_path = '' as $$
  with deleted as (
    delete from public.document_versions v using public.rebuild_checkpoint_retention_claims c
    where c.batch_id = batch and c.version_id = v.id and v.id = any(removed_versions)
    returning v.id
  )
  select count(*)::int from deleted;
$$;

revoke all on function public.rebuild_claim_checkpoint_retention(uuid,int,timestamptz,timestamptz,timestamptz,timestamptz),
  public.rebuild_complete_checkpoint_retention(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.rebuild_claim_checkpoint_retention(uuid,int,timestamptz,timestamptz,timestamptz,timestamptz),
  public.rebuild_complete_checkpoint_retention(uuid,uuid[]) to service_role;
