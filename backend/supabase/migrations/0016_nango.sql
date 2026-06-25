-- 0016_nango.sql — move all cadre OAuth/token management to self-hosted Nango.
--
-- Tokens now live in Nango (encrypted, auto-refreshed). The DB only stores the Nango connection
-- handle on each account. This removes the Supabase Vault token vault, the oauth_state flow, and
-- the token-refresh cron from the app's responsibilities.

-- 1) Account now references its Nango connection instead of a Vault secret.
alter table connected_account
  add column if not exists nango_connection_id text,
  add column if not exists provider_config_key text;
-- token_ref was NOT NULL for the Vault flow; the Nango flow doesn't use it.
alter table connected_account alter column token_ref drop not null;

-- 2) Small service-role-only config table. nango-init publishes the Nango Secret Key here so the
--    Edge Functions can read it at runtime in local dev (prod sets NANGO_SECRET_KEY via env).
--    A table read is reliable under PostgREST connection pooling (unlike a GUC default).
create table if not exists app_config (
  key   text primary key,
  value text not null
);
alter table app_config enable row level security; -- no policies → service-role only

-- 3) Drop the Vault token functions — Nango owns token storage + refresh now.
drop function if exists store_account_token(uuid, text);
drop function if exists read_account_token(uuid);
drop function if exists rotate_account_token(uuid, text);

-- 4) Remove the token-refresh cron job (Nango auto-refreshes on read).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'token-refresh') then
    perform cron.unschedule('token-refresh');
  end if;
end $$;
