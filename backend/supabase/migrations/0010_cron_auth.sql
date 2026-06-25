-- 0010_cron_auth.sql — make pg_cron → Edge Function invocations authenticate.
--
-- BUGFIX: 0006_cron.sql's invoke_edge_function() POSTed with only a Content-Type header. Edge
-- Functions run with verify_jwt = true by default, so the platform gateway rejected every cron
-- call with 401 *before* the function ran — silently killing analyze-comments, detect-narratives,
-- ingest-youtube, token-refresh, and retention-purge (the whole detection + retention pipeline).
--
-- Fix: send the service-role key as a Bearer token. The function bodies already use the
-- service-role client, so the service-role JWT both passes the gateway check and authorizes the
-- work. The key is read from Vault (preferred; constitution §Secrets) with a GUC fallback.
--
-- One-time setup on the hosted project (see docs/deploy.md):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--   select set_config('app.functions_base_url', 'https://<ref>.functions.supabase.co', false);
-- Persist the base URL across sessions with:
--   alter database postgres set app.functions_base_url = 'https://<ref>.functions.supabase.co';

create or replace function invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := current_setting('app.functions_base_url', true);
  service_key text;
begin
  if base is null then
    raise notice 'app.functions_base_url not set; skipping invocation of %', fn;
    return;
  end if;

  -- Prefer the Vault-stored secret; fall back to a GUC for environments without Vault.
  begin
    select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
  exception when others then
    service_key := null;
  end;
  if service_key is null then
    service_key := current_setting('app.service_role_key', true);
  end if;

  if service_key is null then
    raise notice 'service_role_key not found in Vault or app.service_role_key; skipping %', fn;
    return;
  end if;

  perform net.http_post(
    url := base || '/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := body
  );
end;
$$;
