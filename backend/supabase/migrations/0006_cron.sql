-- 0006_cron.sql — pg_cron job scaffolding (T012)
-- Jobs invoke Edge Functions via pg_net once those functions are deployed (US1/US2/Polish).
-- The schedules below are registered now; the invoked function URLs are wired when the
-- corresponding functions land. Until then they are created but call a no-op guard.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A helper that POSTs to an Edge Function with the service role key.
-- Configure once: select set_config('app.functions_base_url', 'https://<ref>.functions.supabase.co', false);
-- and store the service key in Vault; this template reads them at call time.
create or replace function invoke_edge_function(fn text, body jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := current_setting('app.functions_base_url', true);
begin
  if base is null then
    raise notice 'app.functions_base_url not set; skipping invocation of %', fn;
    return;
  end if;
  perform net.http_post(
    url := base || '/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := body
  );
end;
$$;

-- Schedules (cadences tuned to stay within the YouTube 10k-unit/day budget — R2).
-- ingest-youtube      : every 10 min  → T023 (gated by quota audit T006)
-- analyze-comments    : every  1 min  → T024 (drains analyze_jobs)
-- detect-narratives   : every  2 min  → T025
-- token-refresh       : daily         → T038
-- retention-purge     : daily         → T045 (LAUNCH-BLOCKING)
select cron.schedule('analyze-comments', '* * * * *',  $$ select invoke_edge_function('analyze-comments'); $$);
select cron.schedule('detect-narratives', '*/2 * * * *', $$ select invoke_edge_function('detect-narratives'); $$);
select cron.schedule('ingest-youtube',   '*/10 * * * *', $$ select invoke_edge_function('ingest-youtube'); $$);
select cron.schedule('token-refresh',    '0 3 * * *',   $$ select invoke_edge_function('token-refresh'); $$);
select cron.schedule('retention-purge',  '30 3 * * *',  $$ select invoke_edge_function('retention-purge'); $$);
