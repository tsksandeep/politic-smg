-- 0006_views.sql — tenant-scoped read surfaces for the war-room (FR-013/015, Principle I/V).
-- All views run security_invoker = on, so the underlying tables' RLS scopes every row to the
-- caller's tenant automatically. Probabilistic fields ship with their confidence so the UI renders
-- them as signals, never verdicts. No raw commenter handle is ever exposed.

-- Pin search_path (the migration runner applies files with a bare search_path).
set search_path = public, extensions;

-- Primary US1 surface: the opposition's current narratives, ranked, with lifecycle + freshness.
create or replace view narrative_board as
select
  n.id, n.tenant_id, n.theme_summary, n.stance, n.volume, n.growth_rate,
  n.coordination_score, n.confidence, n.lifecycle_state, n.half_life_hours,
  (n.volume * greatest(n.growth_rate, 0))::real as performance_score,
  n.first_seen_at, n.last_updated_at,
  greatest(
    (select max(p.last_sampled_at) from post p    where p.narrative_id = n.id),
    (select max(c.ingested_at)     from comment c where c.narrative_id = n.id)
  ) as data_fresh_as_of
from narrative n;
alter view narrative_board set (security_invoker = on);

-- War-room alerts (emerging narrative / coordinated attack) with triage + freshness.
create or replace view alert_board as
select
  a.id, a.tenant_id, a.kind, a.status, a.assignee_user_id,
  a.detected_at, a.acknowledged_at, a.closed_at, a.response_latency,
  n.theme_summary, n.stance, n.volume, n.growth_rate, n.confidence, n.lifecycle_state,
  cs.signal_type as coordination_type, cs.score as coordination_score, cs.account_ids,
  greatest(
    (select max(p.last_sampled_at) from post p    where p.narrative_id = n.id),
    (select max(c.ingested_at)     from comment c where c.narrative_id = n.id)
  ) as data_fresh_as_of
from alert a
left join narrative n            on n.id  = a.narrative_id
left join coordination_signal cs on cs.id = a.coordination_signal_id;
alter view alert_board set (security_invoker = on);

-- Amplifier target list: accounts ranked by how reliably they convert a narrative into velocity.
create or replace view amplifier_targets as
select
  p.id, p.tenant_id, p.narrative_id, n.theme_summary,
  ta.id as tracked_account_id, ta.handle,
  p.post_count, p.amplification_score, p.is_origin
from account_narrative_participation p
join tracked_account ta on ta.id = p.tracked_account_id
join narrative n        on n.id  = p.narrative_id
order by p.amplification_score desc;
alter view amplifier_targets set (security_invoker = on);

-- Coordination board: recent inferred coordination events with type, score, contributing accounts.
create or replace view coordination_board as
select
  cs.id, cs.tenant_id, cs.signal_type, cs.score, cs.baseline, cs.account_ids,
  cs.evidence, cs.detected_at, cs.narrative_id, n.theme_summary
from coordination_signal cs
left join narrative n on n.id = cs.narrative_id
order by cs.detected_at desc;
alter view coordination_board set (security_invoker = on);

-- Scaling-law / coverage view (FR-015): node capacity vs target, with explicit coverage gaps.
-- Target throughput ≈ active_nodes × ~100 safe requests/node/day; gaps surface, never hide.
create or replace view node_coverage as
select
  t.id as tenant_id,
  (select count(*) from node nd where nd.tenant_id = t.id and nd.status = 'active') as active_nodes,
  (select count(*) from node nd where nd.tenant_id = t.id and nd.status = 'quarantined') as quarantined_nodes,
  (select count(*) from tracked_account ta where ta.tenant_id = t.id and not ta.is_private) as tracked_accounts,
  (select count(*) from work_assignment wa where wa.tenant_id = t.id and wa.state = 'pending') as pending_work,
  (select count(*) from work_assignment wa where wa.tenant_id = t.id and wa.state = 'leased') as leased_work,
  (select count(distinct nh.node_id) from node_heartbeat nh
     where nh.tenant_id = t.id and nh.ip_status = 'blocked' and nh.at > now() - interval '1 hour') as blocked_nodes,
  (select count(*) from node nd where nd.tenant_id = t.id and nd.status = 'active') * 100 as daily_capacity_est
from tenant t;
alter view node_coverage set (security_invoker = on);
