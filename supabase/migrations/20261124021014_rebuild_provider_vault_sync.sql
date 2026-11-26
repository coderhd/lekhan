-- Profiles are visible to signed-in users. Keep the vault column out of those grants.
alter table public.profiles add column if not exists encrypted_ai_keys text;

do $$
declare
  visible_columns text;
  browser_role text;
  operation text;
  preserve_anon boolean;
  preserve_authenticated boolean;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into visible_columns
    from pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
      and attname <> 'encrypted_ai_keys';

  foreach operation in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
    preserve_anon := has_table_privilege('anon', 'public.profiles', operation);
    preserve_authenticated := has_table_privilege('authenticated', 'public.profiles', operation);
    execute format('revoke %s on table public.profiles from public, anon, authenticated', operation);
    execute format('revoke %s (encrypted_ai_keys) on table public.profiles from public, anon, authenticated', operation);
    if preserve_anon then
      execute format('grant %s (%s) on table public.profiles to anon', operation, visible_columns);
    end if;
    if preserve_authenticated then
      execute format('grant %s (%s) on table public.profiles to authenticated', operation, visible_columns);
    end if;
    foreach browser_role in array array['anon', 'authenticated'] loop
      if has_column_privilege(browser_role, 'public.profiles', 'encrypted_ai_keys', operation) then
        raise exception 'Browser role % still has % on the provider vault', browser_role, operation;
      end if;
    end loop;
  end loop;
end
$$;

grant select (id, encrypted_ai_keys), update (encrypted_ai_keys) on table public.profiles to service_role;

create or replace function public.rebuild_save_provider_vault(
  target_profile uuid, previous_revision text, ciphertext text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_ciphertext text;
  current_revision text;
begin
  if target_profile is null or ciphertext is null or octet_length(ciphertext) > 1000000
      or ciphertext !~ '^v1\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+={0,2}$'
      or length(split_part(ciphertext, '.', 4)) < 24
      or length(split_part(ciphertext, '.', 4)) % 4 <> 0
      or (previous_revision is not null and previous_revision !~ '^[a-f0-9]{64}$') then
    return 'invalid';
  end if;

  select encrypted_ai_keys into current_ciphertext from public.profiles where id = target_profile for update;
  if not found then
    return 'missing';
  end if;
  if current_ciphertext = ciphertext then
    return 'saved';
  end if;
  current_revision := encode(sha256(convert_to(current_ciphertext, 'UTF8')), 'hex');
  if current_revision is distinct from previous_revision then
    return 'conflict';
  end if;
  update public.profiles set encrypted_ai_keys = ciphertext where id = target_profile;
  return 'saved';
end
$$;

revoke all on function public.rebuild_save_provider_vault(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rebuild_save_provider_vault(uuid, text, text) to service_role;
