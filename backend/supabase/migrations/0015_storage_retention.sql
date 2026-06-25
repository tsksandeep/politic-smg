-- 0015_storage_retention.sql — provision the raw-payloads Storage bucket in code (not the dashboard).
--
-- The architecture (README §6) designates Supabase Storage as the system-of-record for raw external
-- API payloads. Until now the bucket + its retention were undocumented and left to manual dashboard
-- setup. This migration creates the bucket as part of the schema so every deployment has it,
-- governed identically across environments.
--
-- PRIVACY (constitution Principle III): raw platform payloads contain UN-hashed commenter handles.
-- The relational store only ever holds keyed-hashed IDs (shared/hash.ts), so we DELIBERATELY do not
-- auto-archive raw payloads by default — see docs/compliance.md ("Raw-payload archival"). The bucket
-- is provisioned and governed so that IF archival is later enabled, it is private (service-role only)
-- and subject to the SAME 30-day retention as comment.body. The object purge runs in the
-- retention-purge Edge Function (file deletion needs the Storage API; SQL alone can't remove blobs).

-- Guarded so the self-hosted local compose (which runs no Storage service, hence no `storage`
-- schema) skips this cleanly instead of failing the migration run. On managed Supabase and the
-- hosted deploy the `storage.buckets` table exists, so the bucket is created.
-- Insert only (id, name): on managed Supabase `storage.buckets.public` defaults to FALSE, so the
-- bucket is private without naming the column (which the minimal local stub schema lacks).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name)
    values ('raw-payloads', 'raw-payloads')
    on conflict (id) do nothing;
  else
    raise notice 'storage.buckets not present (no Storage service) — skipping raw-payloads bucket';
  end if;
end;
$$;

-- No storage.objects RLS policies are created for this bucket → it is reachable only by the
-- service role (Edge Functions). Client/anon/authenticated roles get no read or write access,
-- keeping any archived raw payloads out of reach of the dashboard SPA and PostgREST.
