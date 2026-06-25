-- rls_settings_test.sql (T018) — pgTAP: analysts cannot write detection_settings (FR-016).
-- Run with: pg_prove against a local supabase db (pgTAP installed).

begin;
select plan(3);

-- The admin-only write policy exists.
select isnt(
  (select count(*) from pg_policies
    where tablename = 'detection_settings' and policyname = 'settings_admin_write'),
  0::bigint,
  'admin-only write policy exists on detection_settings'
);

-- Simulate an analyst JWT.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true);
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
update app_user set role = 'analyst' where id = '00000000-0000-0000-0000-0000000000a1';
insert into app_user (id, role) values ('00000000-0000-0000-0000-0000000000a1', 'analyst')
  on conflict (id) do update set role = 'analyst';

set local role authenticated;

-- Analyst UPDATE must affect zero rows (policy denies).
with attempt as (
  update detection_settings set min_volume = 1 returning 1
)
select is((select count(*) from attempt), 0::bigint, 'analyst UPDATE on detection_settings is blocked');

-- Analyst SELECT is allowed (staff read).
select isnt((select count(*) from detection_settings), null, 'analyst can read detection_settings');

reset role;
select * from finish();
rollback;
