-- 0009_triage.sql — alert triage support (T043, FR-014 / SC-006).
-- response_latency is derived from detection→close; both columns live on the same row.

alter table alert
  add column if not exists response_latency interval
  generated always as (closed_at - detected_at) stored;

create index if not exists idx_alert_assignee on alert (assignee_user_id);
