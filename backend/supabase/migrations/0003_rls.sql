-- 0003_rls.sql — row-level security for Admin / Analyst (T009, FR-016)
-- Edge Functions write via the service role, which BYPASSES RLS. These policies govern
-- client (authenticated user) access through PostgREST. Default = deny.

-- Helper: role of the currently authenticated user.
create or replace function current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from app_user where id = auth.uid();
$$;

create or replace function is_admin() returns boolean
language sql stable as $$ select current_app_role() = 'admin'; $$;

create or replace function is_staff() returns boolean
language sql stable as $$ select current_app_role() in ('admin', 'analyst'); $$;

-- Enable RLS on every table.
alter table app_user           enable row level security;
alter table cadre              enable row level security;
alter table connected_account  enable row level security;
alter table post               enable row level security;
alter table narrative          enable row level security;
alter table comment            enable row level security;
alter table alert              enable row level security;
alter table detection_settings enable row level security;

-- app_user: a user sees their own row; admins see/manage all.
create policy app_user_self_read on app_user
  for select using (id = auth.uid() or is_admin());
create policy app_user_admin_write on app_user
  for all using (is_admin()) with check (is_admin());

-- Board + detail data: any staff may read (analysts need the board & anonymized detail).
create policy cadre_read    on cadre              for select using (is_staff());
create policy account_read  on connected_account  for select using (is_staff());
create policy post_read     on post               for select using (is_staff());
create policy narrative_read on narrative          for select using (is_staff());
create policy comment_read  on comment            for select using (is_staff());
create policy alert_read    on alert              for select using (is_staff());

-- Triage: staff may update alert lifecycle (US3, FR-013).
create policy alert_triage_update on alert
  for update using (is_staff()) with check (is_staff());

-- Detection settings: readable by staff, writable by Admin only (FR-005, clarify decision).
create policy settings_read on detection_settings
  for select using (is_staff());
create policy settings_admin_write on detection_settings
  for update using (is_admin()) with check (is_admin());
