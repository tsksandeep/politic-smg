-- 0005_cron.sql — scheduled pipeline + coordinator maintenance via pg_cron → Edge Functions.
-- pg_cron fires net.http_post (pg_net) against each Edge Function with the service-role key as the
-- bearer (the functions are invoked machine-to-machine; they use the service role internally).
-- Config (functions base URL, service-role key) lives in app_config (service-role-only).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-assert search_path AFTER the extension creates (they reset it; the runner starts bare).
set search_path = public, extensions, cron, net;

-- Service-role-only key/value config (NOT tenant data). Holds the functions base URL + cron key.
create table if not exists app_config (
  key   text primary key,
  value text not null
);
alter table app_config enable row level security;  -- no policies → only service role can read/write.

-- Invoke an Edge Function by name with the configured base URL + bearer (best-effort, async).
create or replace function invoke_function(p_name text, p_body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare base text; key text;
begin
  select value into base from app_config where key = 'functions_base_url';
  select value into key  from app_config where key = 'cron_service_key';
  if base is null or key is null then
    raise notice 'invoke_function: app_config not set (functions_base_url / cron_service_key)';
    return;
  end if;
  perform net.http_post(
    url     := base || '/' || p_name,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||key),
    body    := p_body
  );
end $$;

-- Schedules. Cadences are conservative defaults; tune per deployment. Wrapped in DO so re-runs are
-- idempotent (cron.schedule errors if the job name already exists).
do $$
declare j record;
begin
  for j in select * from (values
    ('assign-work',        '*/5 * * * *'),   -- generate velocity-aware redundant assignments
    ('enrich',             '* * * * *'),     -- drain enrich_jobs every minute
    ('media-dispatch',     '*/2 * * * *'),   -- nudge media worker / requeue stuck media_jobs
    ('detect-narratives',  '*/3 * * * *'),   -- cluster + label + lifecycle + emerging early-warning
    ('coordination-detect','*/5 * * * *'),   -- temporal/content/shared-audio/author-network signals
    ('reconcile',          '*/5 * * * *'),   -- redundant submission reconciliation + node trust
    ('retention-purge',    '17 * * * *')     -- hourly: purge raw text + media_url past retention
  ) as s(fn, sched)
  loop
    if not exists (select 1 from cron.job where jobname = j.fn) then
      perform cron.schedule(j.fn, j.sched, format('select invoke_function(%L)', j.fn));
    end if;
  end loop;
end $$;
