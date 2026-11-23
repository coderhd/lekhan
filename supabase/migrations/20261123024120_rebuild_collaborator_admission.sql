-- Page owners continue to change roles and revoke access through RLS. New
-- grants and invitation acceptance use the same serialized service boundary.
revoke insert, update on public.page_members, public.page_invitations from public, anon, authenticated;
grant update(role) on public.page_members to authenticated;
drop policy if exists update_page_members on public.page_members;
create policy update_page_members on public.page_members for update to authenticated
  using (role in ('viewer', 'editor') and exists (
    select 1 from public.pages p where p.id = page_id and p.owner_id = (select auth.uid())
  ))
  with check (role in ('viewer', 'editor') and exists (
    select 1 from public.pages p where p.id = page_id and p.owner_id = (select auth.uid())
  ));

revoke all on public.document_collaborators_ledger from public, anon, authenticated;
revoke all on function public.record_collaborator_if_capacity(uuid,text,int) from public, anon, authenticated;
grant execute on function public.record_collaborator_if_capacity(uuid,text,int) to service_role;
alter function public.record_collaborator_if_capacity(uuid,text,int) set search_path = '';

-- Preserve existing grants when the plan changes. Removed members still have
-- attendance history, but only a current membership takes up a seat.
insert into public.document_collaborators_ledger(document_id,user_id)
select m.page_id, m.user_id::text from public.page_members m
join public.pages p on p.id = m.page_id
where m.user_id <> p.owner_id and m.role in ('viewer', 'editor')
on conflict do nothing;

create function public.rebuild_check_collaborator_plan(
  target_workspace uuid, expected_tier text, expected_seats int, collaborator_limit int
) returns void language plpgsql set search_path = '' as $$
declare
  current_tier text;
  current_seats int;
begin
  select tier, seats into current_tier, current_seats from public.workspace_plans
    where workspace_id = target_workspace for share;
  if collaborator_limit is null or collaborator_limit < 0
    or coalesce(current_tier, 'free') is distinct from expected_tier
    or current_seats is distinct from expected_seats then
    raise exception 'collaborator_plan_changed';
  end if;
end;
$$;

create function public.rebuild_record_page_collaborator(
  target_page uuid, actor uuid, collaborator_limit int, expected_tier text, expected_seats int
) returns text language plpgsql security definer set search_path = '' as $$
declare
  page_owner uuid;
  workspace uuid;
  granted_role text;
  recorded boolean;
begin
  select owner_id, workspace_id into page_owner, workspace from public.pages where id = target_page for update;
  if not found then return 'denied'; end if;
  if page_owner = actor then return 'owner'; end if;
  select role::text into granted_role from public.page_members where page_id = target_page and user_id = actor
    and role in ('viewer', 'editor') for share;
  if not found then return 'denied'; end if;

  select exists (select 1 from public.document_collaborators_ledger
    where document_id = target_page and user_id = actor::text) into recorded;
  if not recorded then
    perform public.rebuild_check_collaborator_plan(workspace, expected_tier, expected_seats, collaborator_limit);
    if (select count(*) from public.page_members where page_id = target_page
      and user_id <> page_owner and role in ('viewer', 'editor')) > collaborator_limit then
      return 'limit';
    end if;
  end if;

  insert into public.document_collaborators_ledger(document_id,user_id) values (target_page,actor::text)
    on conflict (document_id,user_id) do update set last_seen_at = now();
  return granted_role;
end;
$$;

drop function public.rebuild_create_page_invitation(uuid,uuid,text,text,int);
drop function public.rebuild_page_invitation(uuid,uuid,text,int);

create function public.rebuild_create_page_invitation(
  target_page uuid, actor uuid, email_address text, access_role text, collaborator_limit integer, expected_tier text, expected_seats int
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(email_address));
  pending_token uuid;
  workspace uuid;
begin
  if normalized_email is null or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or access_role is null or access_role not in ('editor', 'viewer')
    or collaborator_limit is null or collaborator_limit < 0 then
    raise exception 'invalid_invitation';
  end if;

  select workspace_id into workspace from public.pages where id = target_page and owner_id = actor for update;
  if not found then raise exception 'page_not_found'; end if;

  if exists (
    select 1 from auth.users u where lower(u.email) = normalized_email and (
      u.id = actor or exists (
        select 1 from public.page_members m where m.page_id = target_page and m.user_id = u.id
      )
    )
  ) then raise exception 'already_has_access'; end if;

  select token into pending_token from public.page_invitations
    where page_id = target_page and lower(invitee_email) = normalized_email and status = 'pending'
    order by created_at desc, id limit 1;
  if pending_token is not null then
    if exists (select 1 from public.page_invitations where token = pending_token and role::text = access_role) then
      return pending_token;
    end if;
    raise exception 'invitation_already_pending';
  end if;

  perform public.rebuild_check_collaborator_plan(workspace, expected_tier, expected_seats, collaborator_limit);
  if (select count(*) from public.page_members where page_id = target_page
      and user_id <> actor and role in ('viewer', 'editor'))
    + (select count(distinct lower(i.invitee_email)) from public.page_invitations i
      where i.page_id = target_page and i.status = 'pending'
      and not exists (
        select 1 from auth.users u join public.page_members m on m.user_id = u.id
        where lower(u.email) = lower(i.invitee_email) and m.page_id = target_page
          and m.role in ('viewer', 'editor')
      ))
      >= collaborator_limit then raise exception 'collaborator_limit'; end if;

  insert into public.page_invitations (page_id, inviter_id, invitee_email, role)
    values (target_page, actor, normalized_email, access_role::public.member_role)
    returning token into pending_token;
  return pending_token;
end;
$$;

create function public.rebuild_page_invitation(
  invitation_token uuid, actor uuid, operation text, collaborator_limit integer default 0,
  expected_tier text default null, expected_seats int default null
) returns table (page_id uuid, title text, role text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.page_invitations%rowtype;
  protected_page uuid;
  protected_owner uuid;
  workspace uuid;
  page_title text;
begin
  if operation is null or operation not in ('inspect', 'accepted', 'declined') then
    raise exception 'invalid_invitation';
  end if;

  select i.* into target from public.page_invitations i
    join auth.users u on u.id = actor and lower(u.email) = lower(i.invitee_email)
    where i.token = invitation_token and u.email_confirmed_at is not null
    order by i.created_at, i.id limit 1;
  if not found then return; end if;

  if operation = 'inspect' then
    select p.title into page_title from public.pages p where p.id = target.page_id;
  else
    -- Lock the page before the invitation to serialize creation and acceptance.
    select p.id, p.title, p.owner_id, p.workspace_id into protected_page, page_title, protected_owner, workspace
      from public.pages p where p.id = target.page_id for update;
    if not found then return; end if;
    select i.* into target from public.page_invitations i
      join auth.users u on u.id = actor and lower(u.email) = lower(i.invitee_email)
      where i.id = target.id and i.page_id = protected_page and u.email_confirmed_at is not null for update of i;
  end if;
  if not found or target.role::text not in ('editor', 'viewer') then return; end if;

  if operation = 'accepted' and target.status = 'pending' then
    if not exists (select 1 from public.page_members m where m.page_id = target.page_id and m.user_id = actor) then
      perform public.rebuild_check_collaborator_plan(workspace, expected_tier, expected_seats, collaborator_limit);
      if actor = protected_owner or
        (select count(*) from public.page_members m where m.page_id = target.page_id
          and m.user_id <> protected_owner and m.role in ('viewer', 'editor')) >= collaborator_limit then
        raise exception 'collaborator_limit';
      end if;
      insert into public.page_members (page_id, user_id, role)
        values (target.page_id, actor, target.role)
        on conflict on constraint page_members_page_id_user_id_key do nothing;
      insert into public.document_collaborators_ledger(document_id,user_id) values (target.page_id, actor::text)
        on conflict do nothing;
    end if;
  end if;

  if operation in ('accepted', 'declined') and target.status = 'pending' then
    update public.page_invitations i set status = operation::public.invitation_status
      where i.id = target.id returning i.status into target.status;
  end if;

  return query select target.page_id, page_title, target.role::text, target.status::text;
end;
$$;

revoke all on function public.rebuild_check_collaborator_plan(uuid,text,int,int),
  public.rebuild_record_page_collaborator(uuid,uuid,int,text,int),
  public.rebuild_create_page_invitation(uuid,uuid,text,text,int,text,int),
  public.rebuild_page_invitation(uuid,uuid,text,int,text,int) from public, anon, authenticated;
grant execute on function public.rebuild_record_page_collaborator(uuid,uuid,int,text,int),
  public.rebuild_create_page_invitation(uuid,uuid,text,text,int,text,int),
  public.rebuild_page_invitation(uuid,uuid,text,int,text,int) to service_role;
