create function public.rebuild_import_automatic_local_note(
  target_workspace uuid, actor uuid, attempt uuid, batch_number int, first_page int, digest text,
  requested_image_policy text, local_note jsonb, rows_to_import jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  plan record;
begin
  perform 1 from public.workspaces where id = target_workspace and owner_id = actor for update;
  if not found then raise exception 'import_workspace_not_found'; end if;

  select tier, status, past_due_since into plan
    from public.workspace_plans where workspace_id = target_workspace for share;
  if not found or plan.tier = 'free' or plan.status = 'incomplete'
    or (plan.status = 'past_due' and (plan.past_due_since is null
      or now() >= plan.past_due_since + interval '168 hours')) then
    raise exception 'import_paid_sync_ended';
  end if;

  return public.rebuild_import_local_note(target_workspace, actor, attempt, batch_number,
    first_page, digest, requested_image_policy, local_note, rows_to_import);
end;
$$;

revoke all on function public.rebuild_import_automatic_local_note(uuid,uuid,uuid,int,int,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.rebuild_import_automatic_local_note(uuid,uuid,uuid,int,int,text,text,jsonb,jsonb) to service_role;
