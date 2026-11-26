-- NULL identifies work reserved before cloud image optimization. Retrying
-- those batches still requires the original digest and batch boundary.
alter table public.import_batches add column image_policy text check (image_policy in ('free', 'paid'));

alter function public.rebuild_import_batch(uuid,uuid,uuid,int,int,text,jsonb) rename to rebuild_import_batch_without_image_policy;
revoke all on function public.rebuild_import_batch_without_image_policy(uuid,uuid,uuid,int,int,text,jsonb)
  from public, anon, authenticated, service_role;

create function public.rebuild_import_batch(
  target_workspace uuid, actor uuid, attempt uuid, batch_number int, first_page int,
  digest text, rows_to_import jsonb default null, requested_image_policy text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reserved public.import_batches%rowtype;
  tier text;
  current_policy text;
  already_reserved boolean;
  receipt jsonb;
begin
  perform 1 from public.workspaces where id = target_workspace and owner_id = actor for update;
  if not found then raise exception 'import_workspace_not_found'; end if;

  select * into reserved from public.import_batches
    where workspace_id = target_workspace and client_import_id = attempt and batch_index = batch_number;
  already_reserved := found;
  if already_reserved then
    if reserved.image_policy is distinct from requested_image_policy then raise exception 'import_image_policy_changed'; end if;
  else
    select p.tier into tier from public.workspace_plans p where workspace_id = target_workspace for share;
    current_policy := case when tier in ('plus', 'pro', 'team') then 'paid' else 'free' end;
    if current_policy is distinct from requested_image_policy then raise exception 'import_image_policy_changed'; end if;
  end if;

  receipt := public.rebuild_import_batch_without_image_policy(
    target_workspace, actor, attempt, batch_number, first_page, digest, rows_to_import
  );
  if not already_reserved then
    update public.import_batches set image_policy = current_policy
      where workspace_id = target_workspace and client_import_id = attempt and batch_index = batch_number;
  end if;
  return receipt;
end;
$$;

revoke all on function public.rebuild_import_batch(uuid,uuid,uuid,int,int,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.rebuild_import_batch(uuid,uuid,uuid,int,int,text,jsonb,text) to service_role;

grant select(workspace_id, owner_id, client_import_id, batch_index, image_policy) on public.import_batches to service_role;
