-- Apply after the H0 Pages graph and page invitation migrations.
-- The application binds the actor to a verified session and resolves the plan.
-- Service role is the only caller allowed to supply either value.
create function public.rebuild_create_page_invitation(
  target_page uuid, actor uuid, email_address text, access_role text, collaborator_limit integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(email_address));
  pending_token uuid;
begin
  if normalized_email is null or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or access_role is null or access_role not in ('editor', 'viewer')
    or collaborator_limit is null or collaborator_limit < 0 then
    raise exception 'invalid_invitation';
  end if;

  perform 1 from public.pages where id = target_page and owner_id = actor for update;
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

  if (select count(*) from public.page_members where page_id = target_page)
    + (select count(*) from public.page_invitations where page_id = target_page and status = 'pending')
      >= collaborator_limit then raise exception 'collaborator_limit'; end if;

  insert into public.page_invitations (page_id, inviter_id, invitee_email, role)
    values (target_page, actor, normalized_email, access_role::public.member_role)
    returning token into pending_token;
  return pending_token;
end;
$$;

create function public.rebuild_page_invitation(
  invitation_token uuid, actor uuid, operation text, collaborator_limit integer default 0
) returns table (page_id uuid, title text, role text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.page_invitations%rowtype;
  protected_page uuid;
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
    select p.id, p.title into protected_page, page_title from public.pages p where p.id = target.page_id for update;
    if not found then return; end if;
    select i.* into target from public.page_invitations i
      join auth.users u on u.id = actor and lower(u.email) = lower(i.invitee_email)
      where i.id = target.id and i.page_id = protected_page and u.email_confirmed_at is not null for update of i;
  end if;
  if not found or target.role::text not in ('editor', 'viewer') then return; end if;

  if operation = 'accepted' and target.status = 'pending' then
    if not exists (select 1 from public.page_members m where m.page_id = target.page_id and m.user_id = actor) then
      if collaborator_limit is null or collaborator_limit < 0
        or (select count(*) from public.page_members m where m.page_id = target.page_id) >= collaborator_limit then
        raise exception 'collaborator_limit';
      end if;
      insert into public.page_members (page_id, user_id, role)
        values (target.page_id, actor, target.role)
        on conflict on constraint page_members_page_id_user_id_key do nothing;
    end if;
  end if;

  if operation in ('accepted', 'declined') and target.status = 'pending' then
    update public.page_invitations i set status = operation::public.invitation_status
      where i.id = target.id returning i.status into target.status;
  end if;

  return query select target.page_id, page_title, target.role::text, target.status::text;
end;
$$;

revoke all on function public.rebuild_create_page_invitation(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.rebuild_page_invitation(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.rebuild_create_page_invitation(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.rebuild_page_invitation(uuid, uuid, text, integer) to service_role;
