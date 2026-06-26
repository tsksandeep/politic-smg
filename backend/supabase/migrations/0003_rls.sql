-- 0003_rls.sql — row-level security: tenant isolation + Admin/Analyst least privilege (Principle I).
-- Edge Functions write via the service role, which BYPASSES RLS (the backend resolves and scopes the
-- tenant explicitly). These policies govern client (authenticated user) access through PostgREST and
-- Realtime. Default = DENY. Cross-tenant access is impossible at the DB layer (SC-001).

-- ---- Tenant + role resolution for the calling user ----
create or replace function current_tenant()
returns uuid
language sql stable security definer set search_path = public
as $$ select tenant_id from tenant_user where id = auth.uid(); $$;

create or replace function current_app_role()
returns text
language sql stable security definer set search_path = public
as $$ select role from tenant_user where id = auth.uid(); $$;

create or replace function is_tenant_admin() returns boolean
language sql stable as $$ select current_app_role() = 'admin'; $$;

create or replace function is_tenant_staff() returns boolean
language sql stable as $$ select current_app_role() in ('admin','analyst'); $$;

-- ---- Enable RLS on every table ----
alter table tenant                          enable row level security;
alter table tenant_user                     enable row level security;
alter table node                            enable row level security;
alter table node_heartbeat                  enable row level security;
alter table tracked_account                 enable row level security;
alter table work_assignment                 enable row level security;
alter table submission                      enable row level security;
alter table account_snapshot                enable row level security;
alter table post                            enable row level security;
alter table post_metric_sample              enable row level security;
alter table post_entity                     enable row level security;
alter table media_transcript                enable row level security;
alter table comment                         enable row level security;
alter table narrative                       enable row level security;
alter table narrative_observation           enable row level security;
alter table account_narrative_participation enable row level security;
alter table coordination_signal             enable row level security;
alter table alert                           enable row level security;
alter table detection_settings              enable row level security;

-- ---- tenant: a user sees only their own tenant row ----
create policy tenant_self_read on tenant
  for select using (id = current_tenant());

-- ---- tenant_user: a user sees co-tenants; Admin manages users within the tenant ----
create policy tenant_user_read on tenant_user
  for select using (tenant_id = current_tenant());
create policy tenant_user_admin_write on tenant_user
  for all using (tenant_id = current_tenant() and is_tenant_admin())
  with check (tenant_id = current_tenant() and is_tenant_admin());

-- ---- Read-only board/detail surfaces: any staff of the tenant may read its rows ----
-- (write paths go through service-role Edge Functions, except the explicit user-write policies below)
do $$
declare t text;
begin
  foreach t in array array[
    'node','node_heartbeat','work_assignment','submission','account_snapshot','post',
    'post_metric_sample','post_entity','media_transcript','comment','narrative',
    'narrative_observation','account_narrative_participation','coordination_signal'
  ] loop
    execute format(
      'create policy %1$s_tenant_read on %1$s for select using (tenant_id = current_tenant() and is_tenant_staff());',
      t);
  end loop;
end $$;

-- ---- tracked_account: staff read; Admin manages the target list ----
create policy tracked_account_read on tracked_account
  for select using (tenant_id = current_tenant() and is_tenant_staff());
create policy tracked_account_admin_write on tracked_account
  for all using (tenant_id = current_tenant() and is_tenant_admin())
  with check (tenant_id = current_tenant() and is_tenant_admin());

-- ---- node: staff read (above covers read); Admin manages nodes ----
create policy node_admin_write on node
  for all using (tenant_id = current_tenant() and is_tenant_admin())
  with check (tenant_id = current_tenant() and is_tenant_admin());

-- ---- alert: staff read + triage (acknowledge/assign/annotate/close) within the tenant (FR-019) ----
create policy alert_read on alert
  for select using (tenant_id = current_tenant() and is_tenant_staff());
create policy alert_triage_update on alert
  for update using (tenant_id = current_tenant() and is_tenant_staff())
  with check (tenant_id = current_tenant() and is_tenant_staff());

-- ---- detection_settings: staff read; Admin write (FR-011) ----
create policy settings_read on detection_settings
  for select using (tenant_id = current_tenant() and is_tenant_staff());
create policy settings_admin_write on detection_settings
  for all using (tenant_id = current_tenant() and is_tenant_admin())
  with check (tenant_id = current_tenant() and is_tenant_admin());
