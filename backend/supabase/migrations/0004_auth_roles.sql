-- 0004_auth_roles.sql — Auth ↔ app_user role mapping (T010)
-- Sign-ups are disabled (config.toml); Admins provision users. When an auth user is created
-- (by an Admin via the dashboard/API), mirror a row into app_user defaulting to 'analyst'.
-- An Admin then promotes to 'admin' as needed.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_user (id, role)
  values (new.id, 'analyst')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Helper for an Admin to promote/demote a user (callable by admins; RLS on app_user enforces).
create or replace function set_user_role(target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'only admin may change roles';
  end if;
  if new_role not in ('admin', 'analyst') then
    raise exception 'invalid role: %', new_role;
  end if;
  update app_user set role = new_role where id = target;
end;
$$;
