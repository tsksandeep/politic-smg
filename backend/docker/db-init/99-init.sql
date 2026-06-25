-- Self-host bootstrap (runs once on a fresh DB via /docker-entrypoint-initdb.d).
-- The supabase/postgres image creates the supabase roles but leaves them without usable login
-- passwords and without the realtime schema — the CLI normally does this post-boot. We replicate
-- it so Auth/REST/Realtime can connect on a plain `docker compose up`.

-- 1) Give every supabase service role the same local password as POSTGRES_PASSWORD ('postgres').
do $$
declare
  r text;
begin
  foreach r in array array[
    'authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'supabase_functions_admin',
    'supabase_admin', 'supabase_replication_admin', 'supabase_read_only_user', 'pgbouncer',
    'supabase_realtime_admin'
  ] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter role %I with login password %L', r, 'postgres');
    end if;
  end loop;
end $$;

-- 2) Realtime needs its own schema (DB_AFTER_CONNECT_QUERY sets search_path to it).
create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;

-- 3) JWT secret GUC (used by some supabase SQL helpers).
alter database postgres set "app.settings.jwt_secret" to 'super-secret-jwt-token-with-at-least-32-characters-long';
alter database postgres set "app.settings.jwt_exp" to '3600';

-- 4) Realtime publication (migration 0012 extends it; create it up front).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- 5) Cron → Edge Function config (Supabase Cron / pg_cron). invoke_edge_function() reads these GUCs
-- at call time, so the SCHEDULED jobs actually drive the pipeline locally — same code as prod, only
-- the base URL differs (here the in-network Kong functions route; in prod the project functions URL,
-- set via `alter database postgres set app.functions_base_url = 'https://<ref>.functions.supabase.co'`).
-- The local Edge Functions run with verifyJWT=false, but the helper still requires a service key to
-- be present, so we set the local demo service-role key as a GUC (prod stores it in Vault).
alter database postgres set app.functions_base_url to 'http://kong:8000/functions/v1';
alter database postgres set app.service_role_key to 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
